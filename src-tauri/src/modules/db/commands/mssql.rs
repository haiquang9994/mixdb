//! SQL Server
//!
//! `database` here means what it means on MySQL and not what it means on PostgreSQL: a database to
//! reach into over the one pool, never a pool to pick. See `mssql_pool`.

use crate::error::AppError;
use crate::modules::db::drivers::{mssql, mssql_structure};
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

#[tauri::command]
pub async fn mssql_table_data(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    query: mssql::PageQuery,
) -> Result<mssql::TablePage, AppError> {
    retry_read!({
        let pool = mssql_pool(&state, &id).await?;
        mssql::table_data(&pool, &database, &table, &query).await
    })
}

#[tauri::command]
pub async fn mssql_table_structure(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
) -> Result<mssql_structure::TableStructure, AppError> {
    retry_read!({
        let pool = mssql_pool(&state, &id).await?;
        mssql_structure::table_structure(&pool, &database, &table).await
    })
}

#[tauri::command]
pub async fn mssql_table_stats(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<mssql_structure::TableStats>, AppError> {
    retry_read!({
        let pool = mssql_pool(&state, &id).await?;
        mssql_structure::table_stats(&pool, &database).await
    })
}

#[tauri::command]
pub async fn mssql_collations(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<mssql_structure::Collation>, AppError> {
    retry_read!({
        let pool = mssql_pool(&state, &id).await?;
        mssql_structure::collations(&pool).await
    })
}

#[tauri::command]
pub async fn mssql_schema_outline(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<mssql_structure::SchemaOutline, AppError> {
    retry_read!({
        let pool = mssql_pool(&state, &id).await?;
        mssql_structure::schema_outline(&pool, &database).await
    })
}
