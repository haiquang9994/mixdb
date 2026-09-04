//! The statements that change a SQLite schema — the write half of the Structure tab.
//!
//! Much shorter than `postgres_ddl.rs`, and not because SQLite is simpler: it is because `ALTER
//! TABLE` here does four things and nothing else. It can rename the table, rename a column, add a
//! column and drop a column. There is no statement that changes a column's type, its nullability,
//! its default or its collation, and none that adds a primary key to a table that has none.
//!
//! The way round that is the twelve-step rebuild the SQLite documentation describes: create a new
//! table with the schema you wanted, copy the rows across, drop the old one, rename the new one and
//! put the indexes and triggers back. It is deliberately not here. It is the one operation in this
//! module that can lose data outright if it is interrupted or gets a detail wrong, and it belongs
//! in a change of its own rather than in the one that first makes the engine work — see D4 of the
//! plan this was built from.
//!
//! So a column edit that only renames goes through, and anything else is refused by name, saying
//! what it was that cannot be done. That is worse than the other two engines and better than the
//! alternative, which is a rebuild written in a hurry.

use super::sqlite::{map_error, quote_ident};
use crate::error::AppError;
use serde::Deserialize;
use sqlx::{Row, SqlitePool};

/// One column as the dialog describes it.
///
/// Three of the fields the dialog sends have no field here to land in, and serde drops them: the
/// comment (SQLite has no column comments), `onUpdateCurrentTimestamp` (a trigger here, not a
/// property of a column) and `autoIncrement` — `AUTOINCREMENT` is only legal inside a
/// `CREATE TABLE`, and only on an `INTEGER PRIMARY KEY`, so there is no way to give an existing
/// column either. Left out rather than accepted and ignored, so that nothing here reads as though
/// it might one day be honoured.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSpec {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    /// `None` writes no DEFAULT at all.
    #[serde(default)]
    pub default_value: Option<String>,
    /// Emits the default as an expression rather than as a quoted literal — `CURRENT_TIMESTAMP`
    /// rather than `'CURRENT_TIMESTAMP'`.
    #[serde(default)]
    pub default_is_expression: bool,
    #[serde(default)]
    pub collation: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumnSpec {
    pub name: String,
}

/// One index as the dialog describes it.
///
/// The comment and the access method are dropped the way `ColumnSpec`'s extras are: SQLite has no
/// index comments, and every SQLite index is a b-tree — which is also why `indexMethods` is empty
/// on the dialect and the dialog offers no choice to send.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSpec {
    /// Left empty, the index is named after the table and its columns — SQLite requires a name and
    /// has no default of its own.
    #[serde(default)]
    pub name: String,
    /// `index` or `unique`. `primary` never arrives: a primary key is part of `CREATE TABLE` here
    /// and the dialog does not offer it — see `sqliteEditing`.
    pub kind: String,
    pub columns: Vec<IndexColumnSpec>,
}

/// Wraps text as a SQL string literal, doubling the quote that would otherwise end it early.
///
/// A backslash is left alone: a SQLite string literal is not backslash-escaped, so doubling them
/// would store two where the user typed one.
pub(super) fn quote_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Splits the column/constraint list of a `CREATE TABLE` statement into its clauses (split at
/// top-level commas — depth 0 inside the outermost parens), and returns whatever table-option
/// text follows the closing paren (`WITHOUT ROWID`, `STRICT`, both, or `""`). Not a SQL parser: it
/// tracks quotes (`'`, `"`, `` ` ``, `[...]`), comments (`--`, `/* */`) and paren depth only — see
/// B3 of the design spec.
fn split_column_clauses(create_sql: &str) -> Result<(Vec<String>, String), AppError> {
    let chars: Vec<char> = create_sql.chars().collect();
    let mut i = 0;

    // The table name and any quoting around it — skipped to reach the column list's own `(`. The
    // first unquoted `(` in a `CREATE TABLE` is always this one.
    while i < chars.len() && chars[i] != '(' {
        i = match chars[i] {
            '\'' | '"' | '`' => skip_quoted(&chars, i),
            '[' => skip_bracket(&chars, i),
            _ => i + 1,
        };
    }
    if i >= chars.len() {
        return Err(err!("error.sqliteRebuildParseFailed", table = ""));
    }
    i += 1;
    let mut depth = 1u32;
    // Built up character by character rather than sliced from `chars` between two indices: a
    // comment inside a clause must be gone from its text entirely, not merely skipped over while
    // deciding where the clause boundaries are.
    let mut current = String::new();
    let mut clauses: Vec<String> = Vec::new();
    let mut body_end: Option<usize> = None;

    while i < chars.len() {
        match chars[i] {
            '\'' | '"' | '`' => {
                let start = i;
                i = skip_quoted(&chars, i);
                current.extend(chars[start..i].iter().copied());
            }
            '[' => {
                let start = i;
                i = skip_bracket(&chars, i);
                current.extend(chars[start..i].iter().copied());
            }
            '-' if chars.get(i + 1) == Some(&'-') => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            '/' if chars.get(i + 1) == Some(&'*') => {
                i += 2;
                while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                    i += 1;
                }
                i = (i + 2).min(chars.len());
            }
            '(' => {
                depth += 1;
                current.push('(');
                i += 1;
            }
            ')' => {
                depth -= 1;
                if depth == 0 {
                    clauses.push(current.trim().to_string());
                    body_end = Some(i);
                    i += 1;
                    break;
                }
                current.push(')');
                i += 1;
            }
            ',' if depth == 1 => {
                clauses.push(current.trim().to_string());
                current = String::new();
                i += 1;
            }
            c => {
                current.push(c);
                i += 1;
            }
        }
    }

    if body_end.is_none() {
        return Err(err!("error.sqliteRebuildParseFailed", table = ""));
    }
    let suffix: String = chars[i..].iter().collect::<String>().trim().to_string();
    Ok((clauses, suffix))
}

/// Skips one quoted run starting at `i` (`'`, `"` or `` ` ``), doubling the quote character to
/// escape it — the rule `quote_string` writes going out, mirrored coming in. Returns the index
/// just past the closing quote (or the end of input, for an unterminated one).
fn skip_quoted(chars: &[char], i: usize) -> usize {
    let quote = chars[i];
    let mut j = i + 1;
    while j < chars.len() {
        if chars[j] == quote {
            if chars.get(j + 1) == Some(&quote) {
                j += 2;
                continue;
            }
            return j + 1;
        }
        j += 1;
    }
    j
}

/// Skips a `[bracketed identifier]` starting at the `[`. SQLite has no escape for `]` inside one.
fn skip_bracket(chars: &[char], i: usize) -> usize {
    let mut j = i + 1;
    while j < chars.len() && chars[j] != ']' {
        j += 1;
    }
    (j + 1).min(chars.len())
}

/// Runs statements one after another in a transaction, so a change made of several either lands
/// whole or not at all.
async fn execute_all(pool: &SqlitePool, statements: Vec<String>) -> Result<(), AppError> {
    let mut tx = pool.begin().await.map_err(map_error)?;
    for sql in statements {
        if let Err(e) = sqlx::query(sqlx::AssertSqlSafe(sql)).execute(&mut *tx).await {
            tx.rollback().await.map_err(map_error)?;
            return Err(map_error(e));
        }
    }
    tx.commit().await.map_err(map_error)?;
    Ok(())
}

/// One column as it is written inside `CREATE TABLE` or after `ADD COLUMN`.
fn column_definition(spec: &ColumnSpec) -> Result<String, AppError> {
    let name = spec.name.trim();
    if name.is_empty() {
        return Err(err!("error.columnNameRequired"));
    }

    let mut sql = quote_ident(name);
    /* A type is optional in SQLite — a column declared with none takes blob affinity — so an empty
       one is written as nothing rather than refused. */
    let data_type = spec.data_type.trim();
    if !data_type.is_empty() {
        sql.push(' ');
        sql.push_str(data_type);
    }
    if let Some(collation) = spec.collation.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        sql.push_str(" COLLATE ");
        sql.push_str(&quote_ident(collation));
    }
    if !spec.nullable {
        sql.push_str(" NOT NULL");
    }
    if let Some(default) = spec.default_value.as_deref() {
        sql.push_str(" DEFAULT ");
        if spec.default_is_expression {
            /* Parenthesised, which is what SQLite requires of anything but a literal or one of the
               `CURRENT_*` keywords — and which those three tolerate. */
            if is_current_keyword(default) {
                sql.push_str(default);
            } else {
                sql.push_str(&format!("({default})"));
            }
        } else {
            sql.push_str(&quote_string(default));
        }
    }
    Ok(sql)
}

/// The three defaults SQLite spells as bare keywords rather than as expressions.
fn is_current_keyword(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_uppercase().as_str(),
        "CURRENT_TIME" | "CURRENT_DATE" | "CURRENT_TIMESTAMP"
    )
}

/// Creates a table with one column: an `INTEGER PRIMARY KEY`, which is SQLite's own rowid under a
/// name. Every other column is added from the Structure tab afterwards.
///
/// `collation` is accepted and ignored. A SQLite table carries no collation of its own — only a
/// column does — which is why `objectCollation` is off on the dialect and the dialog never offers
/// one here.
pub async fn create_table(pool: &SqlitePool, table: &str) -> Result<(), AppError> {
    let table = table.trim();
    if table.is_empty() {
        return Err(err!("error.tableNameRequired"));
    }
    execute_all(
        pool,
        vec![format!(
            "CREATE TABLE {} (\"id\" INTEGER PRIMARY KEY)",
            quote_ident(table)
        )],
    )
    .await
}

/// Renames a table. SQLite rewrites the references to it in other tables' foreign keys as it goes.
pub async fn rename_table(pool: &SqlitePool, table: &str, new_name: &str) -> Result<(), AppError> {
    let (table, new_name) = (table.trim(), new_name.trim());
    if table.is_empty() || new_name.is_empty() {
        return Err(err!("error.tableNameRequired"));
    }
    execute_all(
        pool,
        vec![format!(
            "ALTER TABLE {} RENAME TO {}",
            quote_ident(table),
            quote_ident(new_name)
        )],
    )
    .await
}

pub async fn drop_table(pool: &SqlitePool, table: &str) -> Result<(), AppError> {
    let table = table.trim();
    if table.is_empty() {
        return Err(err!("error.tableNameRequired"));
    }
    execute_all(pool, vec![format!("DROP TABLE {}", quote_ident(table))]).await
}

/// Appends a column.
///
/// Always appends: `ALTER TABLE` has no `FIRST` or `AFTER`, which is why `columnPosition` is off on
/// the dialect and the dialog offers no place to put it.
///
/// SQLite refuses a few shapes here that it would accept inside a `CREATE TABLE` — a `NOT NULL`
/// column with no default, a `UNIQUE` or `PRIMARY KEY` one — and those refusals are passed through
/// as the engine words them rather than pre-empted: it states the rule better than a second copy of
/// it here would.
pub async fn add_column(
    pool: &SqlitePool,
    table: &str,
    spec: &ColumnSpec,
) -> Result<(), AppError> {
    let definition = column_definition(spec)?;
    execute_all(
        pool,
        vec![format!(
            "ALTER TABLE {} ADD COLUMN {definition}",
            quote_ident(table)
        )],
    )
    .await
}

/// What a column is now, for the comparison [`modify_column`] makes before it refuses.
struct CurrentColumn {
    data_type: String,
    nullable: bool,
    default_value: Option<String>,
}

async fn current_column(
    pool: &SqlitePool,
    table: &str,
    column: &str,
) -> Result<CurrentColumn, AppError> {
    let row = sqlx::query(
        "select type, \"notnull\", dflt_value from pragma_table_xinfo(?) where name = ?",
    )
    .bind(table)
    .bind(column)
    .fetch_optional(pool)
    .await
    .map_err(map_error)?
    .ok_or_else(|| err!("error.unknownColumn", table = table, name = column))?;

    Ok(CurrentColumn {
        data_type: row.get::<String, _>("type"),
        nullable: row.get::<i64, _>("notnull") == 0,
        default_value: super::sqlite::split_default(row.get::<Option<String>, _>("dflt_value")).0,
    })
}

/// Renames a column — and refuses anything else, saying so.
///
/// This is the one place SQLite is meaningfully behind the other two engines. `ALTER TABLE` can
/// rename a column and nothing more: a type, a `NOT NULL`, a default or a collation can only be
/// changed by rebuilding the whole table around the new definition. Rather than do that quietly,
/// the change is refused and named — see the note at the top of this file.
pub async fn modify_column(
    pool: &SqlitePool,
    table: &str,
    name: &str,
    spec: &ColumnSpec,
) -> Result<(), AppError> {
    let new_name = spec.name.trim();
    if new_name.is_empty() {
        return Err(err!("error.columnNameRequired"));
    }
    let current = current_column(pool, table, name).await?;

    /* Compared rather than assumed unchanged: the dialog sends the whole column back whether or not
       anything but the name was touched, so "did anything else change?" is a question about the
       values, not about which fields arrived. The type is compared case-insensitively — SQLite
       stores the declaration verbatim, so `text` and `TEXT` come back different and mean the
       same. */
    if !current.data_type.eq_ignore_ascii_case(spec.data_type.trim()) {
        return Err(err!("error.sqliteColumnTypeUnchangeable", column = name));
    }
    if current.nullable != spec.nullable {
        return Err(err!("error.sqliteColumnNullUnchangeable", column = name));
    }
    if current.default_value.as_deref() != spec.default_value.as_deref() {
        return Err(err!("error.sqliteColumnDefaultUnchangeable", column = name));
    }

    if new_name == name {
        return Ok(());
    }
    execute_all(
        pool,
        vec![format!(
            "ALTER TABLE {} RENAME COLUMN {} TO {}",
            quote_ident(table),
            quote_ident(name),
            quote_ident(new_name)
        )],
    )
    .await
}

/// Drops a column.
///
/// SQLite refuses to drop one that anything depends on — a primary key, a column an index or a
/// generated column is built from — and says which. Passed through as it words it.
pub async fn drop_column(pool: &SqlitePool, table: &str, column: &str) -> Result<(), AppError> {
    execute_all(
        pool,
        vec![format!(
            "ALTER TABLE {} DROP COLUMN {}",
            quote_ident(table),
            quote_ident(column)
        )],
    )
    .await
}

/// The `CREATE INDEX` one spec describes.
fn create_index(table: &str, spec: &IndexSpec) -> Result<String, AppError> {
    if spec.kind == "primary" {
        /* Never reached from the dialog, which does not offer the kind — but a primary key in
           SQLite is part of `CREATE TABLE` and there is no statement that adds one afterwards, so
           it is refused here rather than sent and failed on. */
        return Err(err!("error.sqliteNoPrimaryKeyAfterwards"));
    }
    let columns: Vec<&str> = spec
        .columns
        .iter()
        .map(|c| c.name.trim())
        .filter(|c| !c.is_empty())
        .collect();
    if columns.is_empty() {
        return Err(err!("error.indexNeedsColumn"));
    }

    // SQLite requires a name and has none of its own to fall back on, unlike MySQL.
    let name = if spec.name.trim().is_empty() {
        format!("{table}_{}", columns.join("_"))
    } else {
        spec.name.trim().to_string()
    };
    let unique = if spec.kind == "unique" { "UNIQUE " } else { "" };
    Ok(format!(
        "CREATE {unique}INDEX {} ON {} ({})",
        quote_ident(&name),
        quote_ident(table),
        columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ")
    ))
}

pub async fn add_index(pool: &SqlitePool, table: &str, spec: &IndexSpec) -> Result<(), AppError> {
    execute_all(pool, vec![create_index(table, spec)?]).await
}

/// Replaces an index: the old one dropped and the new one created in one transaction, so the table
/// is never seen without it.
pub async fn modify_index(
    pool: &SqlitePool,
    table: &str,
    name: &str,
    spec: &IndexSpec,
) -> Result<(), AppError> {
    let created = create_index(table, spec)?;
    execute_all(
        pool,
        vec![drop_index_sql(pool, name).await?, created],
    )
    .await
}

pub async fn drop_index(pool: &SqlitePool, _table: &str, name: &str) -> Result<(), AppError> {
    let sql = drop_index_sql(pool, name).await?;
    execute_all(pool, vec![sql]).await
}

/// The `DROP INDEX` for one index, having first made sure it is one that can be dropped.
///
/// Two cannot. An index SQLite built for a `PRIMARY KEY` or a `UNIQUE` constraint belongs to the
/// constraint rather than to the schema — `DROP INDEX` on it fails — and the primary key of a rowid
/// table has no index at all, only the row it is shown under. Both are refused here, where the
/// reason can be given, rather than sent for SQLite to reject as a name it does not know.
async fn drop_index_sql(pool: &SqlitePool, name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(err!("error.indexNameRequired"));
    }
    let origin: Option<String> = sqlx::query_scalar(
        "select il.origin from sqlite_master m \
         join pragma_index_list(m.tbl_name) il on il.name = m.name \
         where m.type = 'index' and m.name = ?",
    )
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(map_error)?;

    match origin.as_deref() {
        // `c` — someone wrote a CREATE INDEX for it, so it can be dropped.
        Some("c") => {}
        // `pk`/`u` — the index behind a constraint, which owns it.
        Some(_) => return Err(err!("error.sqliteIndexBelongsToConstraint", index = name)),
        // Not in `sqlite_master` at all: the synthesised primary key of a rowid table.
        None => return Err(err!("error.sqliteIndexBelongsToConstraint", index = name)),
    }

    Ok(format!("DROP INDEX {}", quote_ident(name)))
}

#[cfg(test)]
mod tests {
    use super::super::sqlite::tests::Fixture;
    use super::super::sqlite_structure::table_structure;
    use super::*;

    fn column(name: &str, data_type: &str) -> ColumnSpec {
        ColumnSpec {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable: true,
            default_value: None,
            default_is_expression: false,
            collation: None,
        }
    }

    fn index(name: &str, kind: &str, columns: &[&str]) -> IndexSpec {
        IndexSpec {
            name: name.to_string(),
            kind: kind.to_string(),
            columns: columns
                .iter()
                .map(|c| IndexColumnSpec { name: (*c).to_string() })
                .collect(),
        }
    }

    #[tokio::test]
    async fn a_new_table_has_the_one_column_the_rest_are_added_to() {
        let (_fixture, pool) = Fixture::open().await;
        create_table(&pool, "note").await.unwrap();
        let structure = table_structure(&pool, "note").await.unwrap();
        assert_eq!(structure.columns.len(), 1);
        assert_eq!(structure.columns[0].name, "id");
        // The rowid under a name, which is what makes it fill itself in.
        assert!(structure.columns[0].auto_increment);
    }

    #[tokio::test]
    async fn a_column_is_added_with_its_default_and_its_collation() {
        let (_fixture, pool) = Fixture::open().await;
        let mut spec = column("nickname", "TEXT");
        spec.default_value = Some("nobody".to_string());
        spec.collation = Some("NOCASE".to_string());
        add_column(&pool, "author", &spec).await.unwrap();

        let structure = table_structure(&pool, "author").await.unwrap();
        let added = structure.columns.iter().find(|c| c.name == "nickname").unwrap();
        // Quoted going in and unquoted coming back — see `split_default`.
        assert_eq!(added.default_value.as_deref(), Some("nobody"));
        assert!(!added.default_is_expression);
    }

    #[tokio::test]
    async fn an_expression_default_cannot_be_added_and_sqlite_says_so() {
        let (_fixture, pool) = Fixture::open().await;
        let mut spec = column("seen_at", "TEXT");
        spec.default_value = Some("CURRENT_TIMESTAMP".to_string());
        spec.default_is_expression = true;

        /* A rule of `ADD COLUMN` rather than of the column: SQLite will not add one whose default
           is not a constant, though a `CREATE TABLE` may declare exactly that. The definition
           written here is right, and the engine's own refusal is what reaches the user — it states
           the rule better than a second copy of it here would. */
        let error = add_column(&pool, "author", &spec).await.expect_err("should refuse");
        assert_eq!(error.code, "error.sqlite");
        assert!(
            error.params["message"].contains("non-constant default"),
            "unexpected message: {}",
            error.params["message"]
        );
    }

    #[tokio::test]
    async fn renaming_a_column_is_the_one_edit_that_goes_through() {
        let (_fixture, pool) = Fixture::open().await;
        let mut spec = column("biography", "TEXT");
        spec.default_value = Some("anonymous".to_string());
        modify_column(&pool, "author", "bio", &spec).await.unwrap();

        let structure = table_structure(&pool, "author").await.unwrap();
        assert!(structure.columns.iter().any(|c| c.name == "biography"));
        assert!(!structure.columns.iter().any(|c| c.name == "bio"));
    }

    #[tokio::test]
    async fn every_other_column_edit_is_refused_by_name() {
        let (_fixture, pool) = Fixture::open().await;

        /* SQLite has no statement for any of these — they need the whole table rebuilt around the
           new definition, which is deliberately not in this module. Each says which one it is,
           rather than all three saying "cannot alter column". */
        let mut retyped = column("bio", "INTEGER");
        retyped.default_value = Some("anonymous".to_string());
        assert_eq!(
            modify_column(&pool, "author", "bio", &retyped).await.expect_err("type").code,
            "error.sqliteColumnTypeUnchangeable"
        );

        let mut required = column("bio", "TEXT");
        required.default_value = Some("anonymous".to_string());
        required.nullable = false;
        assert_eq!(
            modify_column(&pool, "author", "bio", &required).await.expect_err("null").code,
            "error.sqliteColumnNullUnchangeable"
        );

        let mut redefaulted = column("bio", "TEXT");
        redefaulted.default_value = Some("someone".to_string());
        assert_eq!(
            modify_column(&pool, "author", "bio", &redefaulted).await.expect_err("default").code,
            "error.sqliteColumnDefaultUnchangeable"
        );
    }

    #[tokio::test]
    async fn a_type_that_differs_only_in_case_is_the_same_type() {
        let (_fixture, pool) = Fixture::open().await;
        // SQLite stores the declaration verbatim, so `text` and `TEXT` come back different and
        // mean the same — comparing them as written would refuse a plain rename.
        let mut spec = column("biography", "text");
        spec.default_value = Some("anonymous".to_string());
        modify_column(&pool, "author", "bio", &spec).await.unwrap();
    }

    #[tokio::test]
    async fn an_index_left_unnamed_is_named_after_what_it_covers() {
        let (_fixture, pool) = Fixture::open().await;
        // MySQL names one after its first column; SQLite requires a name and offers none.
        add_index(&pool, "post", &index("", "index", &["views"])).await.unwrap();
        let structure = table_structure(&pool, "post").await.unwrap();
        assert!(structure.indexes.iter().any(|i| i.name == "post_views"));
    }

    #[tokio::test]
    async fn a_unique_index_is_created_unique() {
        let (_fixture, pool) = Fixture::open().await;
        add_index(&pool, "author", &index("author_name", "unique", &["name"]))
            .await
            .unwrap();
        let structure = table_structure(&pool, "author").await.unwrap();
        let added = structure.indexes.iter().find(|i| i.name == "author_name").unwrap();
        assert!(added.unique && !added.primary);
    }

    #[tokio::test]
    async fn a_primary_key_cannot_be_added_afterwards() {
        let (_fixture, pool) = Fixture::open().await;
        // Refused here rather than sent: there is no statement that would do it.
        assert_eq!(
            add_index(&pool, "loose", &index("", "primary", &["label"]))
                .await
                .expect_err("should refuse")
                .code,
            "error.sqliteNoPrimaryKeyAfterwards"
        );
    }

    #[tokio::test]
    async fn replacing_an_index_leaves_the_table_with_the_new_one() {
        let (_fixture, pool) = Fixture::open().await;
        modify_index(&pool, "post", "post_author", &index("post_author", "index", &["views"]))
            .await
            .unwrap();
        let structure = table_structure(&pool, "post").await.unwrap();
        let replaced = structure.indexes.iter().find(|i| i.name == "post_author").unwrap();
        assert_eq!(replaced.columns[0].name.as_deref(), Some("views"));
    }

    #[tokio::test]
    async fn an_index_a_constraint_owns_cannot_be_dropped_on_its_own() {
        let (_fixture, pool) = Fixture::open().await;

        // `tag`'s key is two columns, so SQLite built an index for it — one that belongs to the
        // constraint, and that `DROP INDEX` refuses.
        let structure = table_structure(&pool, "tag").await.unwrap();
        let owned = structure.indexes[0].name.clone();
        assert_eq!(
            drop_index(&pool, "tag", &owned).await.expect_err("owned").code,
            "error.sqliteIndexBelongsToConstraint"
        );

        // And the primary key of a rowid table, which is not an index at all — it is the row the
        // Structure tab synthesises.
        assert_eq!(
            drop_index(&pool, "post", "PRIMARY").await.expect_err("implicit").code,
            "error.sqliteIndexBelongsToConstraint"
        );
    }

    #[tokio::test]
    async fn a_created_index_can_be_dropped() {
        let (_fixture, pool) = Fixture::open().await;
        drop_index(&pool, "post", "post_author").await.unwrap();
        let structure = table_structure(&pool, "post").await.unwrap();
        assert!(!structure.indexes.iter().any(|i| i.name == "post_author"));
    }

    #[tokio::test]
    async fn a_table_is_renamed_and_dropped() {
        let (_fixture, pool) = Fixture::open().await;
        rename_table(&pool, "tag", "label").await.unwrap();
        assert!(table_structure(&pool, "label").await.unwrap().columns.len() == 2);
        drop_table(&pool, "label").await.unwrap();
        assert!(table_structure(&pool, "label").await.unwrap().columns.is_empty());
    }

    #[tokio::test]
    async fn a_column_is_dropped() {
        let (_fixture, pool) = Fixture::open().await;
        drop_column(&pool, "author", "bio").await.unwrap();
        let structure = table_structure(&pool, "author").await.unwrap();
        assert!(!structure.columns.iter().any(|c| c.name == "bio"));
    }

    #[test]
    fn splits_simple_columns() {
        let (clauses, suffix) =
            split_column_clauses("CREATE TABLE t (a INTEGER, b TEXT)").unwrap();
        assert_eq!(clauses, vec!["a INTEGER", "b TEXT"]);
        assert_eq!(suffix, "");
    }

    #[test]
    fn does_not_split_a_comma_inside_a_type_arg() {
        let (clauses, _) =
            split_column_clauses("CREATE TABLE t (price DECIMAL(10,2), b TEXT)").unwrap();
        assert_eq!(clauses, vec!["price DECIMAL(10,2)", "b TEXT"]);
    }

    #[test]
    fn does_not_split_a_comma_inside_a_default_expression() {
        let (clauses, _) =
            split_column_clauses("CREATE TABLE t (a INTEGER DEFAULT (max(0, 1)))").unwrap();
        assert_eq!(clauses, vec!["a INTEGER DEFAULT (max(0, 1))"]);
    }

    #[test]
    fn does_not_split_a_comma_inside_a_line_comment() {
        let (clauses, _) = split_column_clauses(
            "CREATE TABLE t (a INTEGER, -- note, with a comma\n  b TEXT)",
        )
        .unwrap();
        assert_eq!(clauses.len(), 2);
        assert!(clauses[0].starts_with("a INTEGER"));
        assert_eq!(clauses[1], "b TEXT");
    }

    #[test]
    fn does_not_split_a_comma_inside_a_block_comment() {
        let (clauses, _) =
            split_column_clauses("CREATE TABLE t (a INTEGER /* x, y */, b TEXT)").unwrap();
        assert_eq!(clauses.len(), 2);
    }

    #[test]
    fn reads_a_quoted_column_name_with_a_space_in_it() {
        let (clauses, _) =
            split_column_clauses("CREATE TABLE t (\"full name\" TEXT, b TEXT)").unwrap();
        assert_eq!(clauses[0], "\"full name\" TEXT");
    }

    #[test]
    fn captures_the_table_constraint_clause() {
        let (clauses, _) = split_column_clauses(
            "CREATE TABLE t (id INTEGER, label TEXT, PRIMARY KEY (id, label))",
        )
        .unwrap();
        assert_eq!(clauses[2], "PRIMARY KEY (id, label)");
    }

    #[test]
    fn captures_the_table_options_suffix() {
        let (_, suffix) =
            split_column_clauses("CREATE TABLE t (a INTEGER PRIMARY KEY) WITHOUT ROWID").unwrap();
        assert_eq!(suffix, "WITHOUT ROWID");
    }

    #[test]
    fn no_suffix_is_an_empty_string() {
        let (_, suffix) = split_column_clauses("CREATE TABLE t (a INTEGER)").unwrap();
        assert_eq!(suffix, "");
    }

    #[test]
    fn an_unbalanced_statement_is_a_parse_failure() {
        assert!(split_column_clauses("CREATE TABLE t (a INTEGER").is_err());
    }
}
