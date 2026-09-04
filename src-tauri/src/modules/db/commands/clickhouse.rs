use super::clickhouse_connection;
use crate::error::AppError;
use crate::modules::db::drivers::{clickhouse, clickhouse_script};
use crate::modules::db::models::{ServerInfo, SqlProblem, StatementResult};
use crate::modules::db::state::DbState;
use serde_json::{Map, Value};
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

#[tauri::command]
pub async fn clickhouse_table_structure(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
) -> Result<clickhouse::TableStructure, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::table_structure(&conn, &database, &table).await
}

#[tauri::command]
pub async fn clickhouse_table_stats(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<clickhouse::TableStats>, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::table_stats(&conn, &database).await
}

#[tauri::command]
pub async fn clickhouse_schema_outline(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<clickhouse::SchemaOutline, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::schema_outline(&conn, &database).await
}

/// `run_id` is taken, like the other three engines', but never stored: there is no
/// `clickhouse_cancel_query` to look it up for, since `cancellable: false` on the dialect closes
/// the button that would call one. Kept in the signature so the frontend has one shape to call
/// through whichever engine it is talking to.
#[tauri::command]
#[allow(unused_variables)]
pub async fn clickhouse_run_script(
    state: State<'_, DbState>,
    id: String,
    run_id: String,
    sql: String,
    database: Option<String>,
) -> Result<Vec<StatementResult>, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse_script::run(&conn, &sql, database.as_deref()).await
}

#[tauri::command]
pub async fn clickhouse_validate_sql(
    state: State<'_, DbState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Option<SqlProblem>, AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse_script::validate(&conn, &sql, database.as_deref()).await
}

#[tauri::command]
pub async fn clickhouse_update_row(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    updates: Map<String, Value>,
    key: Map<String, Value>,
) -> Result<(), AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::update_row(&conn, &database, &table, &updates, &key).await
}

#[tauri::command]
pub async fn clickhouse_delete_rows(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    keys: Vec<Map<String, Value>>,
    all: bool,
    reset_auto_increment: bool,
) -> Result<(), AppError> {
    let conn = clickhouse_connection(&state, &id).await?;
    clickhouse::delete_rows(&conn, &database, &table, &keys, all, reset_auto_increment).await
}
