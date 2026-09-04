//! Writing a SQLite schema out as SQL, and replaying one back in.
//!
//! The only dump here that is not a child process. `dump.rs` runs `mysqldump`, `pg_dump` or
//! `mongodump` — tools MixDB has to find on the machine and offer to download when they are not
//! there — and SQLite has no equivalent worth carrying: the `sqlite3` shell is the only thing that
//! dumps one, it is not shipped on Windows, and what it writes for the schema is already sitting in
//! `sqlite_master` as text.
//!
//! **Structure only.** A data dump is a SQL generator rather than a query: every value has to come
//! back out as a literal, which means quoting text, writing blobs as `x'…'` hex, keeping NULL apart
//! from the empty string, and skipping the generated columns that must not be inserted. That is its
//! own change — see D3 of the plan this was built from — so `SqlDumpMode::Data` and `All` are
//! refused here by name rather than silently writing a structure-only file under a name that
//! promised rows.
//!
//! Restore, by contrast, is complete: the file is replayed statement by statement, so a dump
//! written elsewhere — by `sqlite3 .dump`, rows and all — restores in full.

use super::sqlite::map_error;
use super::sqlite_ddl::quote_string;
use super::sqlite_script;
use crate::error::AppError;
use sqlx::{Row, SqlitePool, TypeInfo, ValueRef};
use std::path::Path;

/// Writes the schema of the database to `path` as SQL.
///
/// Every `CREATE` is taken from `sqlite_master`, which holds the statement as it was originally
/// written — comments, formatting and all. Nothing is regenerated, so what comes out is what went
/// in.
///
/// Tables first, then everything built on them: an index or a trigger replayed before its table
/// fails. Within each of those, the order `sqlite_master` gives, which is the order they were
/// created in — so a view over another view still comes after it.
pub async fn dump_structure(pool: &SqlitePool, path: &Path) -> Result<(), AppError> {
    let statements: Vec<String> = sqlx::query_scalar(
        r"select sql from sqlite_master
          where sql is not null and name not like 'sqlite\_%' escape '\'
          order by case type when 'table' then 0 when 'view' then 1 else 2 end, rowid",
    )
    .fetch_all(pool)
    .await
    .map_err(map_error)?;

    let mut out = String::new();
    /* No `CREATE DATABASE` and no `USE`, matching what the other engines' dumps carry: the file
       restores into whichever database it is pointed at rather than insisting on the one it came
       from. For SQLite that is the file the connection is open on. */
    out.push_str("-- MixDB structure dump\n\n");
    for sql in statements {
        out.push_str(sql.trim());
        out.push_str(";\n\n");
    }

    std::fs::write(path, out).map_err(|e| {
        err!(
            "error.cannotWriteFile",
            path = path.display(),
            message = e
        )
    })
}

/// Replays a SQL file into the open database.
///
/// Split with the Query tab's own splitter rather than by semicolons, so a statement carrying one
/// inside a string or a quoted name survives — which a `CREATE TRIGGER` reliably does.
///
/// Not wrapped in one transaction. A dump of any size would hold a write lock on the file for the
/// whole replay, and a failure halfway through leaves a partly restored database either way: the
/// statements that ran are reported, which is what the other two engines' restores do as well.
pub async fn restore(pool: &SqlitePool, path: &Path) -> Result<(), AppError> {
    let sql = std::fs::read_to_string(path).map_err(|e| {
        err!("error.cannotReadFile", path = path.display(), message = e)
    })?;

    let results = sqlite_script::run(pool, &sql).await?;
    if let Some(failed) = results.iter().find(|result| result.error.is_some()) {
        return Err(err!(
            "error.sqliteRestoreFailed",
            statement = failed.statement.chars().take(200).collect::<String>(),
            message = failed.error.clone().unwrap_or_default()
        ));
    }
    Ok(())
}

/// Every table that can hold rows — `sqlite_master`'s tables, views and the engine's own
/// bookkeeping (`sqlite_sequence`) left out — in creation order (A2/A6 of the design spec).
pub(super) async fn data_tables(pool: &SqlitePool) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar(
        r"select name from sqlite_master
          where type = 'table' and name not like 'sqlite\_%' escape '\'
          order by rowid",
    )
    .fetch_all(pool)
    .await
    .map_err(map_error)
}

/// A table's columns that a plain `INSERT`/`SELECT` can carry — every `hidden = 0` column of
/// `pragma_table_xinfo`, in table order. Leaves out both the virtual-table-only hidden columns
/// (`hidden = 1`) and generated ones (`hidden` 2/3, `VIRTUAL`/`STORED`) — SQLite recomputes those
/// on its own once the table (with its generated expression) exists (A2 of the design spec).
pub(super) async fn data_columns(pool: &SqlitePool, table: &str) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query("select name, hidden from pragma_table_xinfo(?)")
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(map_error)?;
    Ok(rows
        .into_iter()
        .filter(|r| r.get::<i64, _>("hidden") == 0)
        .map(|r| r.get::<String, _>("name"))
        .collect())
}

/// One value read off its real storage class (`NULL`/`INTEGER`/`REAL`/`TEXT`/`BLOB`, from
/// `raw.type_info().name()` — never the column's declared type, which SQLite does not enforce),
/// as the SQL literal `dump_data` writes into an `INSERT` — see A1 of the design spec.
fn sql_literal(row: &sqlx::sqlite::SqliteRow, i: usize) -> String {
    let Ok(raw) = row.try_get_raw(i) else {
        return "NULL".to_string();
    };
    if raw.is_null() {
        return "NULL".to_string();
    }
    match raw.type_info().name() {
        "INTEGER" => row
            .try_get::<i64, _>(i)
            .map(|v| v.to_string())
            .unwrap_or_else(|_| "NULL".to_string()),
        // Non-finite values (NaN/Infinity) have no SQL literal — dumped as NULL, see A1/Rủi ro.
        "REAL" => row
            .try_get::<f64, _>(i)
            .ok()
            .filter(|v| v.is_finite())
            .map(|v| v.to_string())
            .unwrap_or_else(|| "NULL".to_string()),
        "BLOB" => row
            .try_get::<Vec<u8>, _>(i)
            .map(|bytes| {
                let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
                format!("x'{hex}'")
            })
            .unwrap_or_else(|_| "NULL".to_string()),
        _ => row
            .try_get::<String, _>(i)
            .map(|s| quote_string(&s))
            .unwrap_or_else(|_| "NULL".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::super::sqlite::tests::Fixture;
    use super::*;

    /// A path in the temp directory that nothing else is using, removed when the test ends.
    struct Scratch {
        path: std::path::PathBuf,
    }

    impl Scratch {
        fn new() -> Self {
            Self {
                path: std::env::temp_dir().join(format!("mixdb-dump-{}.sql", uuid::Uuid::new_v4())),
            }
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    #[tokio::test]
    async fn the_dump_carries_every_create_and_nothing_of_sqlites_own() {
        let (_fixture, pool) = Fixture::open().await;
        let out = Scratch::new();
        dump_structure(&pool, &out.path).await.unwrap();
        let sql = std::fs::read_to_string(&out.path).unwrap();

        assert!(sql.contains("CREATE TABLE author"));
        assert!(sql.contains("CREATE UNIQUE INDEX post_title"));
        assert!(sql.contains("CREATE VIEW recent"));
        // `sqlite_sequence` is the engine's own bookkeeping and has no place in a schema dump.
        assert!(!sql.contains("sqlite_sequence"));
    }

    #[tokio::test]
    async fn the_dump_puts_the_tables_before_what_is_built_on_them() {
        let (_fixture, pool) = Fixture::open().await;
        let out = Scratch::new();
        dump_structure(&pool, &out.path).await.unwrap();
        let sql = std::fs::read_to_string(&out.path).unwrap();

        // An index or a view replayed before its table fails, so the order is the whole point.
        let table = sql.find("CREATE TABLE post").expect("the table");
        assert!(table < sql.find("CREATE INDEX post_author").expect("the index"));
        assert!(table < sql.find("CREATE VIEW recent").expect("the view"));
    }

    #[tokio::test]
    async fn what_is_dumped_restores_into_an_empty_database() {
        let (_source_fixture, source) = Fixture::open().await;
        let out = Scratch::new();
        dump_structure(&source, &out.path).await.unwrap();

        let (_target_fixture, target) = Fixture::open().await;
        // Emptied first: the fixture opens with the same schema, and a restore over it would
        // report "table already exists" rather than testing anything.
        for statement in ["drop view recent", "drop table post", "drop table tag", "drop table loose", "drop table author"] {
            sqlx::raw_sql(statement).execute(&target).await.unwrap();
        }

        restore(&target, &out.path).await.unwrap();

        let tables: Vec<String> = sqlx::query_scalar(
            "select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\' order by name",
        )
        .fetch_all(&target)
        .await
        .unwrap();
        assert_eq!(tables, vec!["author", "loose", "post", "tag"]);
    }

    #[tokio::test]
    async fn a_restore_that_fails_says_where_it_stopped() {
        let (_fixture, pool) = Fixture::open().await;
        let out = Scratch::new();
        std::fs::write(&out.path, "create table ok_one (a);\nnot sql at all;\n").unwrap();

        let error = restore(&pool, &out.path).await.expect_err("should fail");
        assert_eq!(error.code, "error.sqliteRestoreFailed");
        // The statements before it ran, which is what the message is for: the database is now
        // part-way restored and the user has to be told where it stopped.
        assert!(error.params["statement"].contains("not sql at all"));
    }

    #[tokio::test]
    async fn a_missing_file_to_restore_from_is_reported_as_one() {
        let (_fixture, pool) = Fixture::open().await;
        let absent = std::env::temp_dir().join(format!("mixdb-absent-{}.sql", uuid::Uuid::new_v4()));
        assert_eq!(
            restore(&pool, &absent).await.expect_err("should fail").code,
            "error.cannotReadFile"
        );
    }

    #[tokio::test]
    async fn sql_literal_covers_every_storage_class() {
        let (_fixture, pool) = Fixture::open().await;
        let row = sqlx::query(
            "select 1 as a, 3.5 as b, 'it''s' as c, x'00ff10' as d, NULL as e",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(sql_literal(&row, 0), "1");
        assert_eq!(sql_literal(&row, 1), "3.5");
        assert_eq!(sql_literal(&row, 2), "'it''s'");
        assert_eq!(sql_literal(&row, 3), "x'00ff10'");
        assert_eq!(sql_literal(&row, 4), "NULL");
    }

    #[tokio::test]
    async fn sql_literal_escapes_a_lone_single_quote() {
        let (_fixture, pool) = Fixture::open().await;
        let row = sqlx::query("select 'O''Brien' as name").fetch_one(&pool).await.unwrap();
        assert_eq!(sql_literal(&row, 0), "'O''Brien'");
    }

    #[tokio::test]
    async fn data_tables_lists_tables_only_no_views_no_system_tables() {
        let (_fixture, pool) = Fixture::open().await;
        let tables = data_tables(&pool).await.unwrap();
        // `recent` is a view and `sqlite_sequence` is AUTOINCREMENT's own bookkeeping — neither belongs here.
        assert_eq!(tables, vec!["author", "post", "tag", "loose"]);
    }

    #[tokio::test]
    async fn data_columns_leaves_out_the_generated_column() {
        let (_fixture, pool) = Fixture::open().await;
        let columns = data_columns(&pool, "post").await.unwrap();
        assert_eq!(columns, vec!["id", "author_id", "title", "body", "views", "created_at"]);
        assert!(!columns.contains(&"slug".to_string()));
    }

    #[tokio::test]
    async fn data_columns_keeps_every_column_when_none_is_generated() {
        let (_fixture, pool) = Fixture::open().await;
        let columns = data_columns(&pool, "author").await.unwrap();
        assert_eq!(columns, vec!["id", "name", "bio"]);
    }
}
