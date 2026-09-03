//! SQLite
//!
//! Every one of these takes a `database` argument the way the MySQL and PostgreSQL commands do, and
//! for the same reason — the workspace above hands one down — but there is only ever one value it
//! can hold: `drivers::sqlite::MAIN_DATABASE`. It is accepted and ignored rather than removed, so
//! that the shared `SqlApi` on the frontend keeps one shape across all three engines.
//!
//! `retry_read!` is not used here. It exists for a pooled connection that died between two
//! statements; a file that has gone away is not something a second attempt fixes.

use crate::error::AppError;
use crate::modules::db::drivers::{sqlite, sqlite_ddl, sqlite_structure};
use crate::modules::db::models::ServerInfo;
use serde_json::{Map, Value};
use crate::modules::db::state::DbState;
use tauri::State;

use super::sqlite_pool;

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

#[tauri::command]
pub async fn sqlite_list_tables(
    state: State<'_, DbState>,
    id: String,
    _database: String,
) -> Result<Vec<String>, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::list_tables(&pool).await
}

#[tauri::command]
pub async fn sqlite_table_data(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    query: sqlite::PageQuery,
) -> Result<sqlite::TablePage, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::table_data(&pool, &table, &query).await
}

#[tauri::command]
pub async fn sqlite_table_structure(
    state: State<'_, DbState>,
    id: String,
    _database: String,
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

#[tauri::command]
pub async fn sqlite_table_stats(
    state: State<'_, DbState>,
    id: String,
    _database: String,
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

#[tauri::command]
pub async fn sqlite_update_row(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    updates: Map<String, Value>,
    key: Map<String, Value>,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::update_row(&pool, &table, &updates, &key).await
}

#[tauri::command]
pub async fn sqlite_insert_rows(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    rows: Vec<Map<String, Value>>,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::insert_rows(&pool, &table, &rows).await
}

#[tauri::command]
pub async fn sqlite_delete_rows(
    state: State<'_, DbState>,
    id: String,
    _database: String,
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
#[tauri::command]
pub async fn sqlite_create_table(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    _collation: Option<String>,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::create_table(&pool, &table).await
}

#[tauri::command]
pub async fn sqlite_rename_table(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    new_name: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::rename_table(&pool, &table, &new_name).await
}

#[tauri::command]
pub async fn sqlite_drop_table(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::drop_table(&pool, &table).await
}

#[tauri::command]
pub async fn sqlite_add_column(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    spec: sqlite_ddl::ColumnSpec,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::add_column(&pool, &table, &spec).await
}

#[tauri::command]
pub async fn sqlite_modify_column(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    name: String,
    spec: sqlite_ddl::ColumnSpec,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::modify_column(&pool, &table, &name, &spec).await
}

#[tauri::command]
pub async fn sqlite_drop_column(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    name: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::drop_column(&pool, &table, &name).await
}

#[tauri::command]
pub async fn sqlite_add_index(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    spec: sqlite_ddl::IndexSpec,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::add_index(&pool, &table, &spec).await
}

#[tauri::command]
pub async fn sqlite_modify_index(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    name: String,
    spec: sqlite_ddl::IndexSpec,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::modify_index(&pool, &table, &name, &spec).await
}

#[tauri::command]
pub async fn sqlite_drop_index(
    state: State<'_, DbState>,
    id: String,
    _database: String,
    table: String,
    name: String,
) -> Result<(), AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite_ddl::drop_index(&pool, &table, &name).await
}
