//! Changing the shape of a SQL Server database: its databases, tables, columns and indexes.
//!
//! Closest to `postgres_ddl.rs` in shape — one dialog fills either `ColumnSpec` or `IndexSpec`, and
//! most statements run inside a transaction the way PostgreSQL's DDL does (unlike MySQL's, which
//! auto-commits each one). What differs is the grammar of nearly every statement, and one structural
//! difference reaches further than any single statement: `ALTER COLUMN` cannot carry a default, an
//! index, or the identity property, so [`modify_column`] reads what is in the column's way first and
//! clears it, rather than restating the column whole the way MySQL's `CHANGE COLUMN` or building one
//! `ALTER COLUMN TYPE ... USING ...` the way PostgreSQL's does — see D15 and this plan's Task 5.

use super::mssql::{
    display_type, end_transaction, map_error, quote_ident, resolve, strip_default_parens,
    three_part, Connection, Pool,
};
use super::mssql_structure::{IndexColumn, TableIndex};
use crate::error::AppError;
use serde::Deserialize;

/// What a column is to be declared as — the write-side counterpart of `mssql_structure::StructureColumn`.
///
/// `after`/`onUpdateCurrentTimestamp`, the two fields MySQL's dialog sends that mean nothing here,
/// are simply not declared: serde drops a field a struct has no place for, the way
/// `postgres_ddl::ColumnSpec` already relies on for the same two fields.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSpec {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    /// `None` writes no DEFAULT at all — and, on an existing column, drops the one it has.
    #[serde(default)]
    pub default_value: Option<String>,
    #[serde(default)]
    pub default_is_expression: bool,
    /// An `IDENTITY` column: one the server numbers itself (D7). Cannot be turned on or off on an
    /// existing column — see [`modify_column`] and D15.
    #[serde(default)]
    pub auto_increment: bool,
    #[serde(default)]
    pub collation: Option<String>,
    #[serde(default)]
    pub comment: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumnSpec {
    pub name: String,
}

/// What an index is to be created as.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSpec {
    /// Left empty on a plain or unique index, one is generated — see `generated_index_name`. A
    /// primary key needs no name at all: `ADD CONSTRAINT` may drop its `CONSTRAINT name` clause and
    /// let the server pick one, the same as PostgreSQL's unnamed primary key.
    #[serde(default)]
    pub name: String,
    /// `index`, `unique` or `primary`.
    pub kind: String,
    /// `CLUSTERED` or `NONCLUSTERED`, or `None` to let the server decide.
    #[serde(default)]
    pub index_type: Option<String>,
    pub columns: Vec<IndexColumnSpec>,
    /// Accepted and ignored: SQL Server keeps no comment on an index — see
    /// `mssql_structure::TableIndex.comment`.
    #[serde(default)]
    pub comment: String,
}

/// Wraps text as a SQL string literal, doubling the quote that would otherwise end it early. T-SQL
/// does not backslash-escape a plain literal, so a backslash is left alone — the same rule
/// `postgres_ddl::quote_string` follows and for the same reason.
fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// A Unicode string literal — the extended-property stored procedures (`comment_statement`, Task 4)
/// take `sql_variant` parameters, and every value passed here is text.
fn quote_nstring(value: &str) -> String {
    format!("N'{}'", value.replace('\'', "''"))
}

/// Runs one statement on its own connection, outside any transaction. `CREATE DATABASE` and
/// `ALTER`/`DROP DATABASE` are the only statements this file sends that T-SQL refuses inside a
/// transaction at all (error 226) — every other statement goes through [`execute_all`] instead.
async fn execute_single(pool: &Pool, sql: String) -> Result<(), AppError> {
    let mut client = pool.get().await.map_err(|e| err!("error.mssql", message = e))?;
    client.simple_query(sql).await.map_err(map_error)?;
    Ok(())
}

/// Runs statements in order, inside one transaction — `USE database` first, then `BEGIN
/// TRANSACTION`, then every statement, then [`end_transaction`] commits or rolls back.
///
/// `USE` runs unconditionally rather than only where a statement needs it, because two things this
/// file sends cannot be told apart from the SQL text alone: `sp_rename` and the extended-property
/// procedures behind column comments (Task 4) take no database-qualified form at all (unlike a plain
/// `ALTER TABLE`, which this file always three-part-qualifies through `mssql::three_part` and so
/// would work without it) — they act on whatever database the connection is currently sitting in. A
/// pooled connection may be sitting in any database when it is checked out, so `USE` is not optional
/// here the way it would be if every statement carried its own qualification.
async fn execute_all(pool: &Pool, database: &str, statements: Vec<String>) -> Result<(), AppError> {
    if statements.is_empty() {
        return Ok(());
    }
    let mut client = pool.get().await.map_err(|e| err!("error.mssql", message = e))?;
    client
        .simple_query(format!("USE {}", quote_ident(database)))
        .await
        .map_err(map_error)?;
    client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(map_error)?;

    let result = execute_all_body(&mut client, statements).await;
    end_transaction(&mut client, result).await
}

async fn execute_all_body(client: &mut Connection, statements: Vec<String>) -> Result<(), AppError> {
    for sql in statements {
        client.simple_query(sql).await.map_err(map_error)?;
    }
    Ok(())
}

/// Creates a database, `COLLATE`d when `collation` is given (D14) — the one place SQL Server's
/// collation dialog has anything to write to, since a table has none of its own (`tableCollation:
/// false`).
pub async fn create_database(pool: &Pool, name: &str, collation: Option<&str>) -> Result<(), AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(err!("error.databaseNameRequired"));
    }
    let mut sql = format!("CREATE DATABASE {}", quote_ident(name));
    if let Some(collation) = collation.map(str::trim).filter(|c| !c.is_empty()) {
        sql.push_str(&format!(" COLLATE {}", quote_ident(collation)));
    }
    execute_single(pool, sql).await
}

/// Drops a database and every table in it.
///
/// `USE master` first, on the very connection issuing the drop — a pooled connection may still be
/// sitting inside the database being dropped from an earlier command on it, and `DROP DATABASE`
/// refuses a database its own issuing session is using. `ALTER DATABASE ... SET SINGLE_USER WITH
/// ROLLBACK IMMEDIATE` then takes care of every *other* connection in the way, pooled ones included:
/// it forcibly disconnects them, which is not something `Manager::recycle`'s `SELECT 1` needs help
/// noticing — a connection the server has already closed simply fails that check the next time it is
/// checked out, and deadpool replaces it then, the same as any other connection that went bad.
pub async fn drop_database(pool: &Pool, name: &str) -> Result<(), AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(err!("error.databaseNameRequired"));
    }
    let quoted = quote_ident(name);
    let mut client = pool.get().await.map_err(|e| err!("error.mssql", message = e))?;
    client.simple_query("USE master").await.map_err(map_error)?;
    client
        .simple_query(format!(
            "ALTER DATABASE {quoted} SET SINGLE_USER WITH ROLLBACK IMMEDIATE"
        ))
        .await
        .map_err(map_error)?;
    client
        .simple_query(format!("DROP DATABASE {quoted}"))
        .await
        .map_err(map_error)?;
    Ok(())
}

/// Creates an empty table with one column: an `int` `id` the server numbers itself, primary key —
/// the same shape MySQL and PostgreSQL create theirs with. The rest is added from the Structure tab.
///
/// The name may carry a schema, exactly as the sidebar writes one — `sales.orders` creates the table
/// in `sales`, and a bare name creates it in `dbo` (D3). The schema itself is not created if it does
/// not exist; neither does PostgreSQL's `create_table` attempt that for `public`'s siblings.
pub async fn create_table(pool: &Pool, database: &str, table: &str) -> Result<(), AppError> {
    if table.trim().is_empty() {
        return Err(err!("error.tableNameRequired"));
    }
    let (schema, name) = resolve(table.trim());
    let qualified = three_part(database, &schema, &name);
    let sql = format!(
        "CREATE TABLE {qualified} ({} int IDENTITY(1,1) PRIMARY KEY)",
        quote_ident("id")
    );
    execute_all(pool, database, vec![sql]).await
}

/// Renames a table within its schema.
///
/// `sp_rename` is the only way SQL Server renames a table — there is no ANSI `RENAME TO`. Its object
/// name is a **string**, not an identifier (the same stored-procedure convention `mssql::reset_identity`
/// already relies on for `DBCC CHECKIDENT`), and it cannot move a table to a different schema: unlike
/// PostgreSQL's two-statement rename-then-`SET SCHEMA`, T-SQL has no schema-moving DDL for a table at
/// all short of dropping and recreating it. A `new_name` that names a different schema is refused
/// outright rather than silently kept in the old one — that would be the one outcome a rename can
/// produce that looks like success and is not.
pub async fn rename_table(
    pool: &Pool,
    database: &str,
    table: &str,
    new_name: &str,
) -> Result<(), AppError> {
    let old = table.trim();
    let new_name = new_name.trim();
    if old.is_empty() || new_name.is_empty() {
        return Err(err!("error.tableNameRequired"));
    }
    let (schema, name) = resolve(old);
    let (new_schema, new_bare) = resolve(new_name);
    if new_schema != schema {
        return Err(err!("error.mssqlRenameCannotChangeSchema"));
    }
    let sql = format!(
        "EXEC sp_rename {}, {}",
        quote_string(&format!("{schema}.{name}")),
        quote_string(&new_bare)
    );
    execute_all(pool, database, vec![sql]).await
}

/// Drops a table and everything in it. Plain `DROP TABLE`, not `IF EXISTS` — the same choice
/// `postgres_ddl::drop_table` makes, for the same reason: asking to drop something not there is worth
/// being told about.
pub async fn drop_table(pool: &Pool, database: &str, table: &str) -> Result<(), AppError> {
    if table.trim().is_empty() {
        return Err(err!("error.tableNameRequired"));
    }
    let (schema, name) = resolve(table.trim());
    let qualified = three_part(database, &schema, &name);
    execute_all(pool, database, vec![format!("DROP TABLE {qualified}")]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quote_inside_a_string_literal_is_doubled() {
        assert_eq!(quote_string("it's"), "'it''s'");
        assert_eq!(quote_string("a\\b"), "'a\\b'");
    }

    #[test]
    fn an_nstring_carries_the_unicode_prefix() {
        assert_eq!(quote_nstring("mới"), "N'mới'");
        assert_eq!(quote_nstring("it's"), "N'it''s'");
    }
}
