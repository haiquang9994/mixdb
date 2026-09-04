use super::clickhouse_connection;
use crate::error::AppError;
use crate::modules::db::drivers::clickhouse;
use crate::modules::db::models::ServerInfo;
use crate::modules::db::state::DbState;
use tauri::State;

#[tauri::command]
pub async fn clickhouse_server_info(
    state: State<'_, DbState>,
    id: String,
) -> Result<ServerInfo, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::server_info(&conn).await
}

#[tauri::command]
pub async fn clickhouse_list_databases(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<String>, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::list_databases(&conn).await
}

#[tauri::command]
pub async fn clickhouse_list_tables(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::list_tables(&conn, &database).await
}

#[tauri::command]
pub async fn clickhouse_table_data(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    query: clickhouse::PageQuery,
) -> Result<clickhouse::TablePage, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::table_data(&conn, &database, &table, &query).await
}
