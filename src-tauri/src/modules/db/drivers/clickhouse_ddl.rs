//! Creating and changing schema on ClickHouse: databases, tables, columns.
//!
//! A module of its own rather than more of `clickhouse.rs`, the same way `postgres_ddl.rs` sits
//! beside `postgres.rs`: that file is what reads, and DDL is a large enough job to stand apart.
//!
//! Every statement is built by a pure function and only then sent, so what to *write* is decided
//! where a test can read it and sending is left as `execute_check`. There is no transaction here —
//! ClickHouse has none — so a run of statements that fails partway leaves exactly what already ran.

use super::clickhouse::{execute_check, qualified, quote_ident, Connection};
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
}
