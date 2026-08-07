use serde_json::{Map, Value};
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

use crate::db::{mongo, mysql, redis as redis_db};
use crate::models::{ConnectionConfig, DbKind, SshConfig};
use crate::ssh_tunnel;
use crate::state::{ActiveConnection, AppState, DbHandle};

const DB_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

async fn with_timeout<T>(
    fut: impl std::future::Future<Output = Result<T, String>>,
    what: &str,
) -> Result<T, String> {
    match tokio::time::timeout(DB_CONNECT_TIMEOUT, fut).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "{what} timed out after {}s — check host/port/firewall",
            DB_CONNECT_TIMEOUT.as_secs()
        )),
    }
}

#[tauri::command]
pub async fn test_ssh_tunnel(ssh: SshConfig) -> Result<(), String> {
    ssh_tunnel::test_connection(&ssh).await
}

async fn resolve_endpoint(config: &ConnectionConfig) -> Result<(String, u16, Option<tokio::task::JoinHandle<()>>), String> {
    match &config.ssh {
        Some(ssh) => {
            let (local_port, task) = ssh_tunnel::open_tunnel(ssh, &config.host, config.port).await?;
            Ok(("127.0.0.1".to_string(), local_port, Some(task)))
        }
        None => Ok((config.host.clone(), config.port, None)),
    }
}

#[tauri::command]
pub async fn connect_db(state: State<'_, AppState>, config: ConnectionConfig) -> Result<String, String> {
    let (host, port, tunnel) = resolve_endpoint(&config).await?;

    let handle = match config.kind {
        DbKind::Mysql => {
            let username = config.username.clone().unwrap_or_default();
            let password = config.password.clone().unwrap_or_default();
            let pool = with_timeout(
                mysql::connect(
                    &host,
                    port,
                    &username,
                    &password,
                    config.database.as_deref(),
                    config.use_ssl,
                ),
                "MySQL connection",
            )
            .await?;
            DbHandle::Mysql(pool)
        }
        DbKind::Mongo => {
            let uri = build_mongo_uri(&config, &host, port);
            let client = with_timeout(mongo::connect(&uri), "MongoDB connection").await?;
            DbHandle::Mongo(client)
        }
        DbKind::Redis => {
            let db_index = config.database.as_deref().and_then(|d| d.parse().ok()).unwrap_or(0);
            let conn = with_timeout(
                redis_db::connect(&host, port, config.password.as_deref(), db_index),
                "Redis connection",
            )
            .await?;
            DbHandle::Redis(conn)
        }
    };

    let id = Uuid::new_v4().to_string();
    state
        .connections
        .lock()
        .await
        .insert(id.clone(), ActiveConnection { handle, tunnel });
    Ok(id)
}

fn build_mongo_uri(config: &ConnectionConfig, host: &str, port: u16) -> String {
    match (&config.username, &config.password) {
        (Some(u), Some(p)) if !u.is_empty() => {
            format!("mongodb://{u}:{p}@{host}:{port}/?directConnection=true")
        }
        _ => format!("mongodb://{host}:{port}/?directConnection=true"),
    }
}

#[tauri::command]
pub async fn disconnect_db(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.connections.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn mysql_query(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Vec<Map<String, Value>>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql::query(pool, &sql, database.as_deref()).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_list_databases(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql::list_databases(pool).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_server_info(state: State<'_, AppState>, id: String) -> Result<mysql::ServerInfo, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql::server_info(pool).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_list_tables(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Vec<String>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql::list_tables(pool, &database).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_table_data(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    page: i64,
    page_size: i64,
) -> Result<mysql::TablePage, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql::table_data(pool, &database, &table, page, page_size).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_update_row(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    updates: Map<String, Value>,
    key: Map<String, Value>,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql::update_row(pool, &database, &table, &updates, &key).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mongo_list_databases(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => mongo::list_databases(client).await,
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mongo_list_collections(
    state: State<'_, AppState>,
    id: String,
    db: String,
) -> Result<Vec<String>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => mongo::list_collections(client, &db).await,
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mongo_find(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    filter: String,
    limit: i64,
) -> Result<Vec<Value>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => mongo::find(client, &db, &collection, &filter, limit).await,
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn redis_command(
    state: State<'_, AppState>,
    id: String,
    args: Vec<String>,
) -> Result<Value, String> {
    let mut connections = state.connections.lock().await;
    match connections.get_mut(&id).map(|c| &mut c.handle) {
        Some(DbHandle::Redis(conn)) => redis_db::run_command(conn, args).await,
        Some(_) => Err("Connection is not a Redis connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}
