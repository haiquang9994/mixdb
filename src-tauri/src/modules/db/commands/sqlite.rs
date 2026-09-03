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
use crate::modules::db::drivers::{sqlite, sqlite_structure};
use crate::modules::db::models::ServerInfo;
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
