//! SQL Server
//!
//! `database` here means what it means on MySQL and not what it means on PostgreSQL: a database to
//! reach into over the one pool, never a pool to pick. See `mssql_pool`.

use crate::error::AppError;
use crate::modules::db::drivers::mssql;
use crate::modules::db::models::ServerInfo;
use crate::modules::db::state::DbState;
use tauri::State;

use super::mssql_pool;

#[tauri::command]
pub async fn mssql_list_databases(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<String>, AppError> {
    retry_read!({
        let pool = mssql_pool(&state, &id).await?;
        mssql::list_databases(&pool).await
    })
}

#[tauri::command]
pub async fn mssql_server_info(
    state: State<'_, DbState>,
    id: String,
) -> Result<ServerInfo, AppError> {
    retry_read!({
        let pool = mssql_pool(&state, &id).await?;
        mssql::server_info(&pool).await
    })
}

#[tauri::command]
pub async fn mssql_list_tables(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    retry_read!({
        let pool = mssql_pool(&state, &id).await?;
        mssql::list_tables(&pool, &database).await
    })
}
