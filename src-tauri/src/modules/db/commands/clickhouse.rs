use super::clickhouse_connection;
use crate::error::AppError;
use crate::modules::db::models::ServerInfo;
use crate::modules::db::state::DbState;
use tauri::State;

#[tauri::command]
pub async fn clickhouse_server_info(
    state: State<'_, DbState>,
    id: String,
) -> Result<ServerInfo, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    crate::modules::db::drivers::clickhouse::server_info(&conn).await
}
