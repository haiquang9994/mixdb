//! What a SQL Server table is made of, and what every table in a database weighs — the Structure
//! and Statistics tabs, plus the Query tab's schema outline.
//!
//! The shapes reported here are the ones `postgres_structure.rs` reports, because one grid draws
//! either. Where SQL Server has nothing to put in a field it is left at its empty value rather than
//! dropped: `on_update_current_timestamp` is a MySQL clause with no counterpart here, and
//! `prefix_length` an index feature SQL Server does not have.

use super::mssql::{
    display_type, extra_tokens, is_rowversion_type, map_error, quote_ident, read_uncommitted,
    resolve, strip_default_parens, Pool,
};
use crate::error::AppError;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureColumn {
    pub name: String,
    /// The full declared type: `nvarchar(255)`, `decimal(10,2)`.
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    /// Whether the default is an expression rather than a literal. SQL Server stores both the same
    /// way — `((0))` and `(getdate())` — so this is read off the shape of what is left after
    /// `strip_default_parens`: see [`is_expression_default`].
    pub default_is_expression: bool,
    pub auto_increment: bool,
    /// Always false. `ON UPDATE CURRENT_TIMESTAMP` is MySQL's; the same effect here is a trigger,
    /// which is not a property of the column.
    pub on_update_current_timestamp: bool,
    pub generated: bool,
    pub collation: Option<String>,
    pub comment: String,
    /// `PRI`, `UNI`, `MUL` or empty, as MySQL spells it — which kind of key this column leads.
    pub key: String,
    /// The tokens described on `mssql::extra_tokens`.
    pub extra: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumn {
    pub name: Option<String>,
    /// Always `None`: SQL Server indexes a whole value and has no counterpart to MySQL's
    /// index-the-first-n-characters.
    pub prefix_length: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndex {
    pub name: String,
    pub unique: bool,
    pub primary: bool,
    /// `clustered` or `nonclustered` — SQL Server's own two, lower-cased the way PostgreSQL's
    /// access methods arrive.
    pub index_type: String,
    pub columns: Vec<IndexColumn>,
    pub comment: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStructure {
    /// In table order, which is the order a `SELECT *` returns them in.
    pub columns: Vec<StructureColumn>,
    /// The primary key first, then the rest by name.
    pub indexes: Vec<TableIndex>,
    /// Always empty: data skipping indices are a ClickHouse-only concept.
    pub skip_indexes: Vec<super::clickhouse::SkipIndex>,
    /// Always `None` — the engine guard in the Structure tab only reads this for ClickHouse.
    pub engine: Option<String>,
}

/// Which kind of key a column leads, as MySQL's `Key` column spells it.
///
/// Only the **leading** column of an index is marked, which is what the callers pass: a column in
/// the middle of a composite index is not usable as a lookup on its own, and marking it would
/// promise the grid something the server will not do.
pub(super) fn key_marker(is_primary: bool, is_unique: bool, is_indexed: bool) -> &'static str {
    if is_primary {
        "PRI"
    } else if is_unique {
        "UNI"
    } else if is_indexed {
        "MUL"
    } else {
        ""
    }
}

/// Whether a default is an expression rather than a literal.
///
/// SQL Server stores both as text in `sys.default_constraints.definition`, so the two are told
/// apart by shape once the wrapping parentheses are off: a quoted string or a number is a literal,
/// and anything else — `getdate()`, `newid()`, `next value for s` — is an expression. The mark is
/// what the column grid puts beside a default so `newid()` and the text `newid()` do not read
/// alike.
fn is_expression_default(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    // A quoted string is a literal, `N'...'` — the Unicode spelling — included.
    if trimmed.starts_with('\'') || trimmed.starts_with("N'") {
        return false;
    }
    // So is a number, with or without a sign or a decimal point.
    let digits = trimmed.trim_start_matches(['-', '+']);
    !(!digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit() || c == '.'))
}

/// Everything the Structure tab shows about one table: its columns in table order, and its indexes
/// with the primary key first.
pub async fn table_structure(
    pool: &Pool,
    database: &str,
    table: &str,
) -> Result<TableStructure, AppError> {
    let (schema, name) = resolve(table);
    Ok(TableStructure {
        columns: structure_columns(pool, database, &schema, &name).await?,
        indexes: table_indexes(pool, database, &schema, &name).await?,
        skip_indexes: Vec::new(),
        engine: None,
    })
}

/// The columns of one table with everything the Structure tab shows about them.
///
/// A second read rather than `mssql::table_columns` reused: the grid needs three things that one
/// does not carry — the collation, the description, and which kind of key the column leads — and
/// asking for them in the same statement is one round trip instead of two.
///
/// The description is `sys.extended_properties`' `MS_Description`, which is where SSMS puts what it
/// calls a column's Description and the nearest thing SQL Server has to MySQL's column comment.
async fn structure_columns(
    pool: &Pool,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<StructureColumn>, AppError> {
    let db = quote_ident(database);
    let sql = read_uncommitted(&format!(
        "SELECT c.name, t.name AS type_name, c.max_length, c.precision, c.scale,
                c.is_nullable, c.is_identity, c.is_computed, c.collation_name,
                d.definition,
                COALESCE(CAST(ep.value AS nvarchar(max)), '') AS comment,
                COALESCE(k.is_primary, 0) AS is_primary,
                COALESCE(k.is_unique, 0) AS is_unique,
                COALESCE(k.is_indexed, 0) AS is_indexed
         FROM {db}.sys.columns c
         JOIN {db}.sys.objects o ON o.object_id = c.object_id
         JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         JOIN {db}.sys.types t ON t.user_type_id = c.user_type_id
         LEFT JOIN {db}.sys.default_constraints d ON d.object_id = c.default_object_id
         LEFT JOIN {db}.sys.extended_properties ep
             ON ep.major_id = c.object_id AND ep.minor_id = c.column_id
             AND ep.class = 1 AND ep.name = 'MS_Description'
         OUTER APPLY (
             SELECT MAX(CASE WHEN i.is_primary_key = 1 THEN 1 ELSE 0 END) AS is_primary,
                    MAX(CASE WHEN i.is_unique = 1 THEN 1 ELSE 0 END) AS is_unique,
                    MAX(1) AS is_indexed
             FROM {db}.sys.indexes i
             JOIN {db}.sys.index_columns ic
                 ON ic.object_id = i.object_id AND ic.index_id = i.index_id
             WHERE i.object_id = c.object_id AND ic.column_id = c.column_id
               AND ic.key_ordinal = 1
         ) k
         WHERE s.name = @P1 AND o.name = @P2
         ORDER BY c.column_id"
    ));

    let mut client = pool
        .get()
        .await
        .map_err(|e| err!("error.mssql", message = e))?;
    let rows = client
        .query(sql, &[&schema, &table])
        .await
        .map_err(map_error)?
        .into_first_result()
        .await
        .map_err(map_error)?;

    Ok(rows
        .iter()
        .filter_map(|row| {
            let name: &str = row.get("name")?;
            let type_name: &str = row.get("type_name")?;
            let default_value = row.get::<&str, _>("definition").map(strip_default_parens);
            let is_identity = row.get("is_identity").unwrap_or(false);
            let is_computed = row.get("is_computed").unwrap_or(false);
            Some(StructureColumn {
                name: name.to_string(),
                data_type: display_type(
                    type_name,
                    row.get("max_length").unwrap_or(0),
                    row.get("precision").unwrap_or(0),
                    row.get("scale").unwrap_or(0),
                ),
                nullable: row.get("is_nullable").unwrap_or(true),
                default_is_expression: default_value
                    .as_deref()
                    .map(is_expression_default)
                    .unwrap_or(false),
                default_value,
                auto_increment: is_identity,
                on_update_current_timestamp: false,
                generated: is_computed,
                collation: row.get::<&str, _>("collation_name").map(str::to_string),
                comment: row.get::<&str, _>("comment").unwrap_or("").to_string(),
                key: key_marker(
                    row.get::<i32, _>("is_primary").unwrap_or(0) == 1,
                    row.get::<i32, _>("is_unique").unwrap_or(0) == 1,
                    row.get::<i32, _>("is_indexed").unwrap_or(0) == 1,
                )
                .to_string(),
                extra: extra_tokens(is_identity, is_computed, is_rowversion_type(type_name)),
            })
        })
        .collect())
}

/// The table's indexes, the primary key first.
///
/// Only key columns are listed, in key order. An index's *included* columns (`INCLUDE (a, b)`) are
/// left out: they are payload rather than key, nothing can be looked up by them, and the shared
/// grid has one list of columns to show. The heap — `index_id = 0`, which is what a table with no
/// clustered index has — is not an index and is filtered out.
async fn table_indexes(
    pool: &Pool,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<TableIndex>, AppError> {
    let db = quote_ident(database);
    let sql = read_uncommitted(&format!(
        "SELECT i.name, i.is_unique, i.is_primary_key, LOWER(i.type_desc) AS index_type,
                c.name AS column_name, ic.key_ordinal
         FROM {db}.sys.indexes i
         JOIN {db}.sys.objects o ON o.object_id = i.object_id
         JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         JOIN {db}.sys.index_columns ic
             ON ic.object_id = i.object_id AND ic.index_id = i.index_id
             AND ic.is_included_column = 0
         JOIN {db}.sys.columns c
             ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         WHERE s.name = @P1 AND o.name = @P2 AND i.index_id > 0 AND i.is_hypothetical = 0
         ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal"
    ));

    let mut client = pool
        .get()
        .await
        .map_err(|e| err!("error.mssql", message = e))?;
    let rows = client
        .query(sql, &[&schema, &table])
        .await
        .map_err(map_error)?
        .into_first_result()
        .await
        .map_err(map_error)?;

    let mut indexes: Vec<TableIndex> = Vec::new();
    for row in &rows {
        let Some(name) = row.get::<&str, _>("name") else {
            continue;
        };
        if indexes.last().map(|last| last.name != name).unwrap_or(true) {
            indexes.push(TableIndex {
                name: name.to_string(),
                unique: row.get("is_unique").unwrap_or(false),
                primary: row.get("is_primary_key").unwrap_or(false),
                index_type: row.get::<&str, _>("index_type").unwrap_or("").to_string(),
                columns: Vec::new(),
                // SQL Server keeps no comment on an index. An extended property could hold one, but
                // nothing writes one and SSMS does not show one either.
                comment: String::new(),
            });
        }
        if let Some(index) = indexes.last_mut() {
            index.columns.push(IndexColumn {
                name: row.get::<&str, _>("column_name").map(str::to_string),
                prefix_length: None,
            });
        }
    }
    Ok(indexes)
}

#[cfg(test)]
mod tests {
    use super::{is_expression_default, key_marker};

    /// The three markers in the order they win: a primary key column is `PRI` even though it is
    /// also unique and also indexed, which is what keeps one column from carrying two claims.
    #[test]
    fn the_strongest_key_a_column_leads_is_the_one_marked() {
        assert_eq!(key_marker(true, true, true), "PRI");
        assert_eq!(key_marker(false, true, true), "UNI");
        assert_eq!(key_marker(false, false, true), "MUL");
        assert_eq!(key_marker(false, false, false), "");
    }

    /// SQL Server stores a literal default and an expression one the same way, so the grid's mark
    /// is read off the shape of the text — a quoted string or a number is a literal, a call is not.
    #[test]
    fn a_call_is_an_expression_and_a_written_out_value_is_not() {
        assert!(is_expression_default("getdate()"));
        assert!(is_expression_default("newid()"));
        assert!(!is_expression_default("0"));
        assert!(!is_expression_default("-1.5"));
        assert!(!is_expression_default("'new'"));
        assert!(!is_expression_default("N'mới'"));
        assert!(!is_expression_default(""));
    }
}
