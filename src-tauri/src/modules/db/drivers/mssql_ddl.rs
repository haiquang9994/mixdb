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

/// The `COLLATE ...` of a column, empty when none was asked for. Bracket-quoted like any other
/// identifier here — a collation name has no space or special character SQL Server itself allows,
/// but quoting costs nothing and keeps this file's one rule ("every identifier goes through
/// `quote_ident`") without an exception.
fn collate_clause(collation: Option<&str>) -> String {
    match collation.map(str::trim).filter(|c| !c.is_empty()) {
        Some(collation) => format!(" COLLATE {}", quote_ident(collation)),
        None => String::new(),
    }
}

/// How a DEFAULT reaches the DDL. An expression goes in as written; anything else is a literal and
/// is quoted, except `NULL` typed on its own, meant as SQL NULL rather than the four characters — the
/// same rule `postgres_ddl::default_clause` follows.
fn default_clause(value: &str, is_expression: bool) -> String {
    let trimmed = value.trim();
    if is_expression {
        return trimmed.to_string();
    }
    if trimmed.eq_ignore_ascii_case("NULL") {
        return "NULL".to_string();
    }
    quote_string(value)
}

/// The `name type ...` of a column, as `CREATE TABLE`/`ADD` spells it. The comment is not here — it
/// is a separate statement, see [`comment_statement`].
fn column_definition(spec: &ColumnSpec) -> Result<String, AppError> {
    let name = spec.name.trim();
    if name.is_empty() {
        return Err(err!("error.columnNameRequired"));
    }
    let data_type = spec.data_type.trim();
    if data_type.is_empty() {
        return Err(err!("error.columnTypeRequired"));
    }

    let mut sql = format!("{} {data_type}", quote_ident(name));
    sql.push_str(&collate_clause(spec.collation.as_deref()));
    if spec.auto_increment {
        // IDENTITY is NOT NULL by definition (D7) and carries no DEFAULT of its own.
        sql.push_str(" IDENTITY(1,1) NOT NULL");
        return Ok(sql);
    }
    sql.push_str(if spec.nullable { " NULL" } else { " NOT NULL" });
    if let Some(default) = &spec.default_value {
        sql.push_str(&format!(
            " DEFAULT {}",
            default_clause(default, spec.default_is_expression)
        ));
    }
    Ok(sql)
}

/// Sets, replaces or clears a column's `MS_Description` extended property — the nearest thing SQL
/// Server has to an inline column comment, and what `mssql_structure::structure_columns` already
/// reads back as `comment`. `exists` is whether the column already carries one, since the three
/// stored procedures below are not interchangeable: asking `sp_addextendedproperty` to add a second
/// one, or `sp_updateextendedproperty` to update one that is not there, is an error rather than a
/// no-op.
fn comment_statement(
    schema: &str,
    table: &str,
    column: &str,
    comment: &str,
    exists: bool,
) -> Option<String> {
    let comment = comment.trim();
    if comment.is_empty() && !exists {
        return None;
    }
    let proc = if comment.is_empty() {
        "sp_dropextendedproperty"
    } else if exists {
        "sp_updateextendedproperty"
    } else {
        "sp_addextendedproperty"
    };
    let mut sql = format!("EXEC {proc} @name = N'MS_Description'");
    if !comment.is_empty() {
        sql.push_str(&format!(", @value = {}", quote_nstring(comment)));
    }
    sql.push_str(&format!(
        ", @level0type = N'SCHEMA', @level0name = {}, \
         @level1type = N'TABLE', @level1name = {}, \
         @level2type = N'COLUMN', @level2name = {}",
        quote_nstring(schema),
        quote_nstring(table),
        quote_nstring(column)
    ));
    Some(sql)
}

/// What a column is now, as far as [`modify_column`] (Task 5) and [`drop_column`] need to know.
struct CurrentColumn {
    object_id: i32,
    column_id: i32,
    /// Already through `display_type` — `nvarchar(255)`, not `nvarchar` and a byte count (D11).
    data_type: String,
    nullable: bool,
    /// The default constraint's own name, which SQL Server usually generates
    /// (`DF__t__col__1A2B3C4D`) — needed to `DROP CONSTRAINT` it, since nothing about `ALTER COLUMN`
    /// takes a default along for the ride (D15).
    default_name: Option<String>,
    /// The default's definition, already through `strip_default_parens`.
    default_value: Option<String>,
    identity: bool,
    collation: Option<String>,
    /// `''` when the column has no `MS_Description` — `comment_statement`'s `exists` is
    /// `!comment.is_empty()`, so a column deliberately commented with nothing and a column never
    /// commented at all are (rarely, harmlessly) treated alike.
    comment: String,
}

/// Reads one column's full declaration and its default constraint's name — a second, per-column read
/// beside `mssql_structure::structure_columns`'s per-table one, because [`modify_column`] and
/// [`drop_column`] need the default constraint's *name* (to drop it), which the Structure tab's own
/// read has no reason to carry.
async fn current_column(
    pool: &Pool,
    database: &str,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<CurrentColumn, AppError> {
    let db = quote_ident(database);
    let sql = format!(
        "SELECT c.object_id, c.column_id, t.name AS type_name, c.max_length, c.precision, c.scale,
                c.is_nullable, c.is_identity, c.collation_name, d.name AS default_name, d.definition,
                COALESCE(CAST(ep.value AS nvarchar(max)), '') AS comment
         FROM {db}.sys.columns c
         JOIN {db}.sys.objects o ON o.object_id = c.object_id
         JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         JOIN {db}.sys.types t ON t.user_type_id = c.user_type_id
         LEFT JOIN {db}.sys.default_constraints d ON d.object_id = c.default_object_id
         LEFT JOIN {db}.sys.extended_properties ep
             ON ep.major_id = c.object_id AND ep.minor_id = c.column_id
             AND ep.class = 1 AND ep.name = 'MS_Description'
         WHERE s.name = @P1 AND o.name = @P2 AND c.name = @P3"
    );

    let mut client = pool.get().await.map_err(|e| err!("error.mssql", message = e))?;
    let row = client
        .query(sql, &[&schema, &table, &column])
        .await
        .map_err(map_error)?
        .into_row()
        .await
        .map_err(map_error)?
        .ok_or_else(|| err!("error.unknownColumn", table = table, name = column))?;

    let type_name: &str = row.get("type_name").unwrap_or("");
    Ok(CurrentColumn {
        object_id: row.get("object_id").unwrap_or(0),
        column_id: row.get("column_id").unwrap_or(0),
        data_type: display_type(
            type_name,
            row.get("max_length").unwrap_or(0),
            row.get("precision").unwrap_or(0),
            row.get("scale").unwrap_or(0),
        ),
        nullable: row.get("is_nullable").unwrap_or(true),
        default_name: row.get::<&str, _>("default_name").map(str::to_string),
        default_value: row.get::<&str, _>("definition").map(strip_default_parens),
        identity: row.get("is_identity").unwrap_or(false),
        collation: row.get::<&str, _>("collation_name").map(str::to_string),
        comment: row.get::<&str, _>("comment").unwrap_or("").to_string(),
    })
}

/// Every index — plain, unique, or the primary key — that covers `column_id`, full column list
/// included (not just the one column asked about): dropping and recreating half of a composite index
/// would silently narrow it. Mirrors `mssql_structure::table_indexes`'s query almost exactly, with an
/// added `EXISTS` to filter to indexes that reach the one column [`modify_column`]/[`drop_column`]
/// care about.
async fn dependent_indexes(
    pool: &Pool,
    database: &str,
    object_id: i32,
    column_id: i32,
) -> Result<Vec<TableIndex>, AppError> {
    let db = quote_ident(database);
    let sql = format!(
        "SELECT i.name, i.is_unique, i.is_primary_key, LOWER(i.type_desc) AS index_type,
                c.name AS column_name, ic.key_ordinal
         FROM {db}.sys.indexes i
         JOIN {db}.sys.index_columns ic
             ON ic.object_id = i.object_id AND ic.index_id = i.index_id
             AND ic.is_included_column = 0
         JOIN {db}.sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         WHERE i.object_id = @P1 AND i.index_id > 0 AND i.is_hypothetical = 0
           AND EXISTS (
               SELECT 1 FROM {db}.sys.index_columns ic2
               WHERE ic2.object_id = i.object_id AND ic2.index_id = i.index_id
                 AND ic2.column_id = @P2
           )
         ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal"
    );

    let mut client = pool.get().await.map_err(|e| err!("error.mssql", message = e))?;
    let rows = client
        .query(sql, &[&object_id, &column_id])
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

pub async fn add_column(pool: &Pool, database: &str, table: &str, spec: &ColumnSpec) -> Result<(), AppError> {
    let (schema, table_name) = resolve(table);
    let qualified = three_part(database, &schema, &table_name);
    let definition = column_definition(spec)?;

    let mut statements = vec![format!("ALTER TABLE {qualified} ADD {definition}")];
    if let Some(sql) = comment_statement(&schema, &table_name, spec.name.trim(), &spec.comment, false) {
        statements.push(sql);
    }
    execute_all(pool, database, statements).await
}

/// Drops a column — its default constraint and every index covering it first: both block `DROP
/// COLUMN` exactly as they block `ALTER COLUMN` (D15), and neither is rebuilt afterwards, since the
/// column they covered no longer exists to cover. A comment needs no cleanup of its own: SQL Server
/// drops a column's extended properties along with the column.
pub async fn drop_column(pool: &Pool, database: &str, table: &str, name: &str) -> Result<(), AppError> {
    let column = name.trim();
    if column.is_empty() {
        return Err(err!("error.columnNameRequired"));
    }
    let (schema, table_name) = resolve(table);
    let qualified = three_part(database, &schema, &table_name);
    let current = current_column(pool, database, &schema, &table_name, column).await?;

    let mut statements = Vec::new();
    for index in dependent_indexes(pool, database, current.object_id, current.column_id).await? {
        statements.push(
            drop_index_statement(pool, database, &schema, &table_name, &index.name).await?,
        );
    }
    if let Some(default_name) = &current.default_name {
        statements.push(format!(
            "ALTER TABLE {qualified} DROP CONSTRAINT {}",
            quote_ident(default_name)
        ));
    }
    statements.push(format!(
        "ALTER TABLE {qualified} DROP COLUMN {}",
        quote_ident(column)
    ));
    execute_all(pool, database, statements).await
}

/// Forward-declared here, defined in Task 6 alongside `add_index`/`modify_index`/`drop_index` — this
/// file grows in the order the plan's tasks land, and `drop_column`/`modify_column` (Task 5) both
/// need it before that section exists.
#[allow(unused_variables)]
async fn drop_index_statement(
    pool: &Pool,
    database: &str,
    schema: &str,
    table: &str,
    name: &str,
) -> Result<String, AppError> {
    unimplemented!("added in Task 6")
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

    fn spec(name: &str, data_type: &str) -> ColumnSpec {
        ColumnSpec {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable: true,
            default_value: None,
            default_is_expression: false,
            auto_increment: false,
            collation: None,
            comment: String::new(),
        }
    }

    #[test]
    fn a_plain_column_is_named_typed_and_nullable() {
        assert_eq!(column_definition(&spec("title", "nvarchar(255)")).unwrap(), "[title] nvarchar(255) NULL");
    }

    #[test]
    fn an_identity_column_takes_neither_null_nor_default() {
        let mut spec = spec("id", "int");
        spec.auto_increment = true;
        spec.default_value = Some("7".to_string());
        assert_eq!(column_definition(&spec).unwrap(), "[id] int IDENTITY(1,1) NOT NULL");
    }

    #[test]
    fn a_collation_is_bracket_quoted() {
        let mut spec = spec("name", "nvarchar(50)");
        spec.collation = Some("Latin1_General_CI_AS".to_string());
        assert_eq!(
            column_definition(&spec).unwrap(),
            "[name] nvarchar(50) COLLATE [Latin1_General_CI_AS] NULL"
        );
    }

    #[test]
    fn a_literal_default_is_quoted_and_an_expression_is_not() {
        assert_eq!(default_clause("new", false), "'new'");
        assert_eq!(default_clause("it's", false), "'it''s'");
        assert_eq!(default_clause("getdate()", true), "getdate()");
        assert_eq!(default_clause("NULL", false), "NULL");
    }

    #[test]
    fn a_new_column_with_a_comment_only_ever_adds_one() {
        assert_eq!(
            comment_statement("dbo", "t", "c", "hello", false),
            Some(
                "EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'hello', \
                 @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', \
                 @level1name = N't', @level2type = N'COLUMN', @level2name = N'c'"
                    .to_string()
            )
        );
    }

    #[test]
    fn clearing_an_existing_comment_drops_the_property_rather_than_setting_it_empty() {
        assert_eq!(
            comment_statement("dbo", "t", "c", "", true),
            Some(
                "EXEC sp_dropextendedproperty @name = N'MS_Description', @level0type = N'SCHEMA', \
                 @level0name = N'dbo', @level1type = N'TABLE', @level1name = N't', \
                 @level2type = N'COLUMN', @level2name = N'c'"
                    .to_string()
            )
        );
    }

    #[test]
    fn no_comment_and_none_before_writes_nothing() {
        assert_eq!(comment_statement("dbo", "t", "c", "", false), None);
    }
}
