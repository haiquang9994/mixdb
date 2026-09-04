//! Creating and changing schema on ClickHouse: databases, tables, columns.
//!
//! A module of its own rather than more of `clickhouse.rs`, the same way `postgres_ddl.rs` sits
//! beside `postgres.rs`: that file is what reads, and DDL is a large enough job to stand apart.
//!
//! Every statement is built by a pure function and only then sent, so what to *write* is decided
//! where a test can read it and sending is left as `execute_check`. There is no transaction here —
//! ClickHouse has none — so a run of statements that fails partway leaves exactly what already ran.

use super::clickhouse::{execute_check, qualified, quote_ident, quote_literal, Connection};
use serde::Deserialize;
use crate::error::AppError;

/// The body of a ClickHouse string literal, or `None` for text that is not one whole literal.
///
/// "Whole" is what matters: `'a' || 'b'` also opens and closes with a quote but is an expression,
/// so the closing quote has to be the last character before this counts. Backslash escapes, the
/// same convention `clickhouse::quote_literal` writes them back out with.
pub(super) fn literal_body(text: &str) -> Option<String> {
    let mut chars = text.char_indices();
    if chars.next()?.1 != '\'' {
        return None;
    }
    let mut body = String::new();
    while let Some((index, ch)) = chars.next() {
        match ch {
            '\\' => body.push(chars.next()?.1),
            '\'' => {
                return if index + 1 == text.len() { Some(body) } else { None };
            }
            _ => body.push(ch),
        }
    }
    None
}

/// What `system.columns.default_expression` reports, split into the value to show and whether it
/// is an expression rather than a literal: `'active'` is the literal `active`, `now()` is an
/// expression, and so is `42` — writing it back out verbatim is right either way, and ClickHouse
/// gives nothing to tell a bare number from a function call with no arguments.
///
/// The inverse is `default_clause`, which writes the same value back into SQL.
pub(super) fn read_default(expression: &str) -> Option<(String, bool)> {
    let text = expression.trim();
    if text.is_empty() {
        return None;
    }
    match literal_body(text) {
        Some(body) => Some((body, false)),
        None => Some((text.to_string(), true)),
    }
}

/// The engines the "create table" dialog offers, in the order they are shown.
///
/// Four, not six: `CollapsingMergeTree` and `VersionedCollapsingMergeTree` require a parameter
/// each — a `sign` column, and a `version` one — naming a column that does not exist yet when the
/// table is created, and the server refuses them outright (`Code: 42 ... requires 1 parameter`,
/// checked against the test server). Choosing an engine cannot be undone once the table exists, so
/// the list holds only the ones certain to work.
pub const ENGINES: [&str; 4] = [
    "MergeTree",
    "ReplacingMergeTree",
    "SummingMergeTree",
    "AggregatingMergeTree",
];

/// The `CREATE TABLE` for a new table.
///
/// The table arrives nearly empty — one `id UInt64` column — and grows its real columns in the
/// Structure tab, exactly as on the other three engines. `ORDER BY tuple()` is an empty sorting
/// key: only `id` exists at this point, so any other choice would be guessing on the user's
/// behalf, and setting a real sorting key belongs to the index design.
///
/// The engine name goes into the SQL bare — there is no way to quote one — so the only safe thing
/// to do with it is refuse anything not in [`ENGINES`], the same posture
/// `mysql_structure::validated_collation` takes for a collation.
pub fn create_table_statement(
    database: &str,
    table: &str,
    engine: &str,
) -> Result<String, AppError> {
    let table = table.trim();
    if table.is_empty() {
        return Err(err!("error.tableNameRequired"));
    }
    let engine = ENGINES
        .iter()
        .find(|known| **known == engine.trim())
        .ok_or_else(|| err!("error.clickhouseUnknownEngine", engine = engine))?;
    Ok(format!(
        "CREATE TABLE {} (`id` UInt64) ENGINE = {engine} ORDER BY tuple()",
        qualified(database, table)
    ))
}

pub async fn create_table(
    conn: &Connection,
    database: &str,
    table: &str,
    engine: &str,
) -> Result<(), AppError> {
    execute_check(conn, &create_table_statement(database, table, engine)?, None).await
}

/// Renames a table within its database. ClickHouse's `RENAME TABLE` is a metadata change and
/// touches no part on disk.
pub async fn rename_table(
    conn: &Connection,
    database: &str,
    table: &str,
    new_name: &str,
) -> Result<(), AppError> {
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err(err!("error.tableNameRequired"));
    }
    let sql = format!(
        "RENAME TABLE {} TO {}",
        qualified(database, table),
        qualified(database, new_name)
    );
    execute_check(conn, &sql, None).await
}

pub async fn drop_table(conn: &Connection, database: &str, table: &str) -> Result<(), AppError> {
    let sql = format!("DROP TABLE {}", qualified(database, table));
    execute_check(conn, &sql, None).await
}

/// Creates a database. No collation: ClickHouse has no such thing, so the argument
/// `SqlApi.createDatabase` carries for the other three engines is dropped at the command layer.
pub async fn create_database(conn: &Connection, name: &str) -> Result<(), AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(err!("error.databaseNameRequired"));
    }
    let sql = format!("CREATE DATABASE {}", quote_ident(name));
    execute_check(conn, &sql, None).await
}

pub async fn drop_database(conn: &Connection, name: &str) -> Result<(), AppError> {
    let sql = format!("DROP DATABASE {}", quote_ident(name));
    execute_check(conn, &sql, None).await
}

/// A `DEFAULT` clause ready to be appended to a column definition — the leading space is part of
/// it, so a caller only has to `push_str`. The inverse of [`read_default`]: a literal goes back out
/// quoted exactly the way it was unquoted coming in.
pub(super) fn default_clause(value: &str, is_expression: bool) -> String {
    if is_expression {
        format!(" DEFAULT {}", value.trim())
    } else {
        format!(" DEFAULT {}", quote_literal(value))
    }
}

/// What a column is to be declared as — the write-side counterpart of
/// `clickhouse::StructureColumn`.
///
/// Narrower than the other three engines' `ColumnSpec` because ClickHouse has less: `nullable`
/// lives inside `data_type` (`Nullable(T)`, wrapped by the dialog before it is sent), there is no
/// `AUTO_INCREMENT`, no `ON UPDATE CURRENT_TIMESTAMP`, no per-column collation, and `after` is of
/// no use since `MODIFY COLUMN` cannot move a column (`SqlEditing.columnPosition: false`). Those
/// fields are still sent from the frontend through the shared `SqlColumnSpec` shape; serde drops a
/// field the struct has not got rather than refusing the payload.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSpec {
    pub name: String,
    pub data_type: String,
    /// `None` writes no `DEFAULT` at all — and, on an existing column, drops the one it has.
    #[serde(default)]
    pub default_value: Option<String>,
    #[serde(default)]
    pub default_is_expression: bool,
    #[serde(default)]
    pub comment: String,
}

/// A column declared whole — what follows `ADD COLUMN` and equally what follows `MODIFY COLUMN`,
/// ClickHouse taking the same syntax in both places. PostgreSQL cannot: there each property is an
/// `ALTER COLUMN SET ...` of its own.
///
/// No `NULL`/`NOT NULL`: nullability is part of how the type is spelled here, and the dialog has
/// already wrapped `Nullable(...)` around `data_type` where it belongs.
pub fn column_definition(spec: &ColumnSpec) -> Result<String, AppError> {
    let name = spec.name.trim();
    if name.is_empty() {
        return Err(err!("error.columnNameRequired"));
    }
    let data_type = spec.data_type.trim();
    if data_type.is_empty() {
        return Err(err!("error.columnTypeRequired"));
    }
    let mut sql = format!("{} {data_type}", quote_ident(name));
    if let Some(value) = spec.default_value.as_deref() {
        sql.push_str(&default_clause(value, spec.default_is_expression));
    }
    if !spec.comment.is_empty() {
        sql.push_str(&format!(" COMMENT {}", quote_literal(&spec.comment)));
    }
    Ok(sql)
}

/// Adds a column, always at the end of the table.
///
/// `ADD COLUMN ... AFTER` does exist, but `MODIFY COLUMN` cannot move a column afterwards and
/// `SqlEditing.columnPosition` is one flag covering both — so no position is offered at all, the
/// same as on PostgreSQL and SQLite.
pub async fn add_column(
    conn: &Connection,
    database: &str,
    table: &str,
    spec: &ColumnSpec,
) -> Result<(), AppError> {
    let sql = format!(
        "ALTER TABLE {} ADD COLUMN {}",
        qualified(database, table),
        column_definition(spec)?
    );
    execute_check(conn, &sql, None).await
}

pub async fn drop_column(
    conn: &Connection,
    database: &str,
    table: &str,
    name: &str,
) -> Result<(), AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(err!("error.columnNameRequired"));
    }
    let sql = format!(
        "ALTER TABLE {} DROP COLUMN {}",
        qualified(database, table),
        quote_ident(name)
    );
    execute_check(conn, &sql, None).await
}

/// What is decided here, rather than by a server's answer.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quoted_string_is_a_literal_and_loses_its_quotes() {
        assert_eq!(read_default("'active'"), Some(("active".to_string(), false)));
    }

    #[test]
    fn a_function_call_is_an_expression_kept_verbatim() {
        assert_eq!(read_default("now()"), Some(("now()".to_string(), true)));
    }

    #[test]
    fn a_number_is_an_expression_there_being_nothing_to_tell_it_from_one() {
        assert_eq!(read_default("42"), Some(("42".to_string(), true)));
    }

    #[test]
    fn nothing_at_all_is_no_default() {
        assert_eq!(read_default(""), None);
        assert_eq!(read_default("   "), None);
    }

    #[test]
    fn a_concatenation_that_merely_starts_and_ends_with_a_quote_is_not_a_literal() {
        assert_eq!(read_default("'a' || 'b'"), Some(("'a' || 'b'".to_string(), true)));
    }

    #[test]
    fn an_escaped_quote_inside_a_literal_is_unescaped() {
        assert_eq!(read_default("'it\\'s'"), Some(("it's".to_string(), false)));
    }

    #[test]
    fn a_new_table_gets_one_placeholder_column_and_no_sorting_key() {
        assert_eq!(
            create_table_statement("shop", "orders", "MergeTree").unwrap(),
            "CREATE TABLE `shop`.`orders` (`id` UInt64) ENGINE = MergeTree ORDER BY tuple()"
        );
    }

    #[test]
    fn an_engine_outside_the_list_is_refused_rather_than_interpolated() {
        assert_eq!(
            create_table_statement("shop", "orders", "Kafka").unwrap_err(),
            err!("error.clickhouseUnknownEngine", engine = "Kafka")
        );
        assert_eq!(
            create_table_statement("shop", "orders", "MergeTree ORDER BY x; DROP TABLE y")
                .unwrap_err()
                .code,
            "error.clickhouseUnknownEngine"
        );
    }

    #[test]
    fn a_table_with_no_name_is_refused_before_any_sql_is_built() {
        assert_eq!(
            create_table_statement("shop", "  ", "MergeTree").unwrap_err(),
            err!("error.tableNameRequired")
        );
    }

    fn spec(name: &str, data_type: &str) -> ColumnSpec {
        ColumnSpec {
            name: name.to_string(),
            data_type: data_type.to_string(),
            default_value: None,
            default_is_expression: false,
            comment: String::new(),
        }
    }

    #[test]
    fn an_escaped_quote_survives_the_default_round_trip() {
        let (value, is_expression) = read_default("'it\'s'").unwrap();
        assert_eq!(default_clause(&value, is_expression), " DEFAULT 'it\'s'");
    }

    #[test]
    fn an_expression_default_goes_back_out_unquoted() {
        assert_eq!(default_clause("now()", true), " DEFAULT now()");
    }

    #[test]
    fn a_plain_column_is_just_a_name_and_a_type() {
        assert_eq!(column_definition(&spec("title", "String")).unwrap(), "`title` String");
    }

    #[test]
    fn nullability_travels_inside_the_type_rather_than_as_a_clause_of_its_own() {
        assert_eq!(
            column_definition(&spec("title", "Nullable(String)")).unwrap(),
            "`title` Nullable(String)"
        );
    }

    #[test]
    fn a_literal_default_is_quoted_and_an_expression_is_not() {
        let mut literal = spec("state", "String");
        literal.default_value = Some("active".to_string());
        assert_eq!(column_definition(&literal).unwrap(), "`state` String DEFAULT 'active'");

        let mut expression = spec("made", "DateTime");
        expression.default_value = Some("now()".to_string());
        expression.default_is_expression = true;
        assert_eq!(column_definition(&expression).unwrap(), "`made` DateTime DEFAULT now()");
    }

    #[test]
    fn a_comment_is_written_only_when_there_is_one() {
        let mut commented = spec("title", "String");
        commented.comment = "the heading".to_string();
        assert_eq!(
            column_definition(&commented).unwrap(),
            "`title` String COMMENT 'the heading'"
        );
    }

    #[test]
    fn a_column_needs_both_a_name_and_a_type() {
        assert_eq!(
            column_definition(&spec("  ", "String")).unwrap_err(),
            err!("error.columnNameRequired")
        );
        assert_eq!(
            column_definition(&spec("title", " ")).unwrap_err(),
            err!("error.columnTypeRequired")
        );
    }
}
