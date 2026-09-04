//! SQLite
//!
//! Every one of these takes a `database` argument the way the MySQL and PostgreSQL commands do, and
//! for the same reason — the workspace above hands one down — but there is only ever one value it
//! can hold: `drivers::sqlite::MAIN_DATABASE`. It is accepted and ignored rather than removed, so
//! that the shared `SqlApi` on the frontend keeps one shape across all three engines.
//!
//! `retry_read!` is not used here. It exists for a pooled connection that died between two
//! statements; a file that has gone away is not something a second attempt fixes.
//!
//! The unused arguments carry `#[allow(unused_variables)]` rather than a leading underscore. The
//! name of a command's argument is what the frontend's `invoke` has to send, and whether Tauri's
//! macro strips a `_` on the way to camelCase is a detail nothing in this repo depended on before
//! — a wrong guess there is a call that fails at runtime with "invalid args" and at build time not
//! at all. The attribute keeps the name exactly as it is sent.

use crate::error::AppError;
use crate::modules::db::drivers::{dump, sqlite, sqlite_ddl, sqlite_dump, sqlite_script, sqlite_structure};
use crate::modules::db::models::{ServerInfo, SqlProblem, StatementResult};
use serde_json::{Map, Value};
use crate::modules::db::state::DbState;
use tauri::State;

use super::sqlite_pool;

/// Creates an empty database file, for the New button on the connection form.
///
/// Takes no connection id: there is nothing open yet, which is the whole point — the form calls
/// this and then puts the path in its own box for the user to connect with.
#[tauri::command]
pub async fn sqlite_create_file(path: String) -> Result<(), AppError> {
    sqlite::create_file(&path).await
}

#[tauri::command]
pub async fn sqlite_server_info(
    state: State<'_, DbState>,
    id: String,
) -> Result<ServerInfo, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::server_info(&pool).await
}

/// The one database a file holds. Answered without touching it — see `sqlite::list_databases`.
#[tauri::command]
pub async fn sqlite_list_databases(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<String>, AppError> {
    // Still asks for the pool, so that a connection that has been closed reports itself here the
    // way it would for any other read rather than answering with a list.
    sqlite_pool(&state, &id).await?;
    Ok(sqlite::list_databases())
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_list_tables(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::list_tables(&pool).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_table_data(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    query: sqlite::PageQuery,
) -> Result<sqlite::TablePage, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::table_data(&pool, &table, &query).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_table_structure(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
) -> Result<sqlite_structure::TableStructure, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_structure::table_structure(&pool, &table).await
}

#[tauri::command]
pub async fn sqlite_schema_outline(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<sqlite_structure::SchemaOutline, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_structure::schema_outline(&pool, &database).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_table_stats(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<sqlite_structure::TableStats>, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_structure::table_stats(&pool).await
}

#[tauri::command]
pub async fn sqlite_collations(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<sqlite_structure::Collation>, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_structure::collations(&pool).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_update_row(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    updates: Map<String, Value>,
    key: Map<String, Value>,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::update_row(&pool, &table, &updates, &key).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_insert_rows(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    rows: Vec<Map<String, Value>>,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::insert_rows(&pool, &table, &rows).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_delete_rows(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    keys: Vec<Map<String, Value>>,
    all: bool,
    reset_auto_increment: bool,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::delete_rows(&pool, &table, &keys, all, reset_auto_increment).await
}

/// `collation` is accepted and ignored: a SQLite table carries none of its own — see
/// `sqlite_ddl::create_table`.
#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_create_table(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    collation: Option<String>,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::create_table(&pool, &table).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_rename_table(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    new_name: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::rename_table(&pool, &table, &new_name).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_drop_table(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::drop_table(&pool, &table).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_add_column(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    spec: sqlite_ddl::ColumnSpec,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::add_column(&pool, &table, &spec).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_modify_column(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    name: String,
    spec: sqlite_ddl::ColumnSpec,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::modify_column(&pool, &table, &name, &spec).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_drop_column(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    name: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::drop_column(&pool, &table, &name).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_add_index(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    spec: sqlite_ddl::IndexSpec,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::add_index(&pool, &table, &spec).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_modify_index(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    name: String,
    spec: sqlite_ddl::IndexSpec,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::modify_index(&pool, &table, &name, &spec).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_drop_index(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    name: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::drop_index(&pool, &table, &name).await
}

/// Runs the user's script.
///
/// `run_id` is accepted for the shape the other two engines have and is not remembered anywhere:
/// nothing here can be cancelled from outside, so there is no pid to file under it — see
/// `sqlite_script`.
#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_run_script(
    state: State<'_, DbState>,
    id: String,
    run_id: String,
    sql: String,
    database: Option<String>,
) -> Result<Vec<StatementResult>, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_script::run(&pool, &sql).await
}

/// Asks SQLite to prepare one statement without running it, for the editor's error checking.
#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_validate_sql(
    state: State<'_, DbState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Option<SqlProblem>, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_script::validate(&pool, &sql).await
}

/// Writes the schema to `path`.
///
/// `mode` is checked rather than ignored: MixDB does not write a SQLite data dump yet, and a file
/// asked for as `all` that arrived holding only `CREATE` statements would be a backup someone
/// found out about at restore time.
#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_dump(
    state: State<'_, DbState>,
    id: String,
    database: String,
    mode: String,
    path: String,
) -> Result<(), AppError> {
    // TODO(Task 6): wire mode dispatch, Transfer/reporter — see the design spec's A-decisions.
    if mode != "structure" {
        return Err(err!("error.sqliteDataDumpUnsupported"));
    }
    let pool = sqlite_pool(&state, &id).await?;
    let watch = dump::Watch { report: &|_| {}, cancel: &|| false };
    sqlite_dump::dump_structure(&pool, std::path::Path::new(&path), &watch).await
}

#[allow(unused_variables)]
#[tauri::command]
pub async fn sqlite_restore(
    state: State<'_, DbState>,
    id: String,
    database: String,
    path: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_dump::restore(&pool, std::path::Path::new(&path)).await
}
