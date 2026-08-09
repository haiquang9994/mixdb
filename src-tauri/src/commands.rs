use serde_json::{Map, Value};
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

use crate::db::{mongo, mysql, mysql_script, mysql_structure, redis as redis_db};
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
    let (handle, tunnel) = match config.kind {
        DbKind::Mysql => {
            let (host, port, tunnel) = resolve_endpoint(&config).await?;
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
            (DbHandle::Mysql(pool), tunnel)
        }
        // MongoDB is configured as a whole connection string rather than host/port/user/password,
        // so the endpoint lives inside the URI. Tunneling therefore has to read the host back out
        // of it and then override it, instead of going through `resolve_endpoint`.
        DbKind::Mongo => {
            let uri = config.uri.as_deref().unwrap_or_default().trim();
            if uri.is_empty() {
                return Err("MongoDB connection string is required".to_string());
            }
            let (endpoint, tunnel) = match &config.ssh {
                Some(ssh) => {
                    let (host, port) = mongo::first_endpoint(uri).await?;
                    let (local_port, task) = ssh_tunnel::open_tunnel(ssh, &host, port).await?;
                    (Some(("127.0.0.1".to_string(), local_port)), Some(task))
                }
                None => (None, None),
            };
            let client = with_timeout(mongo::connect(uri, endpoint), "MongoDB connection").await?;
            (DbHandle::Mongo(client), tunnel)
        }
        DbKind::Redis => {
            let (host, port, tunnel) = resolve_endpoint(&config).await?;
            let db_index = config.database.as_deref().and_then(|d| d.parse().ok()).unwrap_or(0);
            let conn = with_timeout(
                redis_db::connect(&host, port, config.password.as_deref(), db_index),
                "Redis connection",
            )
            .await?;
            (DbHandle::Redis(conn), tunnel)
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
    sort_column: Option<String>,
    sort_desc: bool,
    filters: Option<Vec<mysql::Filter>>,
) -> Result<mysql::TablePage, String> {
    let connections = state.connections.lock().await;
    let filters = filters.unwrap_or_default();
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => {
            mysql::table_data(
                pool,
                &database,
                &table,
                page,
                page_size,
                sort_column.as_deref(),
                sort_desc,
                &filters,
            )
            .await
        }
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
pub async fn mysql_insert_rows(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    rows: Vec<Map<String, Value>>,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql::insert_rows(pool, &database, &table, &rows).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_delete_rows(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    keys: Vec<Map<String, Value>>,
    all: bool,
    reset_auto_increment: bool,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => {
            mysql::delete_rows(pool, &database, &table, &keys, all, reset_auto_increment).await
        }
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_table_structure(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<mysql_structure::TableStructure, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql_structure::table_structure(pool, &database, &table).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

/// The collations this server has, for the column editor's picker. A property of the server rather
/// than of any one table, so the frontend reads it once per connection.
#[tauri::command]
pub async fn mysql_collations(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<mysql_structure::Collation>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql_structure::collations(pool).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

/// Creates an empty table — one `id` column and its primary key — for the sidebar's add button.
#[tauri::command]
pub async fn mysql_create_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    collation: Option<String>,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => {
            mysql_structure::create_table(pool, &database, &table, collation.as_deref()).await
        }
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

/// Renames a table, for the sidebar's context menu.
#[tauri::command]
pub async fn mysql_rename_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    new_name: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => {
            mysql_structure::rename_table(pool, &database, &table, &new_name).await
        }
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

/// Drops a table and everything in it, for the sidebar's context menu.
#[tauri::command]
pub async fn mysql_drop_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql_structure::drop_table(pool, &database, &table).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_add_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    spec: mysql_structure::ColumnSpec,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql_structure::add_column(pool, &database, &table, &spec).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_modify_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
    spec: mysql_structure::ColumnSpec,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => {
            mysql_structure::modify_column(pool, &database, &table, &name, &spec).await
        }
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_drop_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql_structure::drop_column(pool, &database, &table, &name).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_add_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    spec: mysql_structure::IndexSpec,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql_structure::add_index(pool, &database, &table, &spec).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_modify_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
    spec: mysql_structure::IndexSpec,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => {
            mysql_structure::modify_index(pool, &database, &table, &name, &spec).await
        }
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mysql_drop_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql_structure::drop_index(pool, &database, &table, &name).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

/// Runs the Query tab's editor contents. `database` is the one selected in the header, applied as a
/// `USE` before the script so that unqualified table names resolve the way the rest of the
/// workspace resolves them.
#[tauri::command]
pub async fn mysql_run_script(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Vec<mysql_script::StatementResult>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql_script::run(pool, &sql, database.as_deref()).await,
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
pub async fn mongo_server_info(state: State<'_, AppState>, id: String) -> Result<mongo::ServerInfo, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => mongo::server_info(client).await,
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

/// Creates an empty collection, for the sidebar's add button.
#[tauri::command]
pub async fn mongo_create_collection(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => mongo::create_collection(client, &db, &collection).await,
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

/// Renames a collection, for the sidebar's context menu.
#[tauri::command]
pub async fn mongo_rename_collection(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    new_name: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => {
            mongo::rename_collection(client, &db, &collection, &new_name).await
        }
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

/// Drops a collection and every document in it, for the sidebar's context menu.
#[tauri::command]
pub async fn mongo_drop_collection(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => mongo::drop_collection(client, &db, &collection).await,
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
pub async fn mongo_collection_page(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    page: i64,
    page_size: i64,
    filters: Option<Vec<mongo::Filter>>,
) -> Result<mongo::CollectionPage, String> {
    let connections = state.connections.lock().await;
    let filters = filters.unwrap_or_default();
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => {
            mongo::collection_page(client, &db, &collection, page, page_size, &filters).await
        }
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mongo_next_ids(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    count: i64,
) -> Result<Vec<Value>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => mongo::next_ids(client, &db, &collection, count).await,
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mongo_insert_documents(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    documents: Vec<Value>,
) -> Result<usize, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => {
            mongo::insert_documents(client, &db, &collection, &documents).await
        }
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mongo_update_document(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    doc_id: Value,
    ops: mongo::DocUpdateOps,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => {
            mongo::update_document(client, &db, &collection, &doc_id, &ops).await
        }
        Some(_) => Err("Connection is not a MongoDB connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn mongo_delete_document(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    doc_id: Value,
) -> Result<(), String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mongo(client)) => mongo::delete_document(client, &db, &collection, &doc_id).await,
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

#[tauri::command]
pub async fn redis_server_info(
    state: State<'_, AppState>,
    id: String,
) -> Result<redis_db::ServerInfo, String> {
    let mut connections = state.connections.lock().await;
    match connections.get_mut(&id).map(|c| &mut c.handle) {
        Some(DbHandle::Redis(conn)) => redis_db::server_info(conn).await,
        Some(_) => Err("Connection is not a Redis connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn redis_list_databases(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<redis_db::DbInfo>, String> {
    let mut connections = state.connections.lock().await;
    match connections.get_mut(&id).map(|c| &mut c.handle) {
        Some(DbHandle::Redis(conn)) => redis_db::list_databases(conn).await,
        Some(_) => Err("Connection is not a Redis connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn redis_select_db(
    state: State<'_, AppState>,
    id: String,
    index: i64,
) -> Result<(), String> {
    let mut connections = state.connections.lock().await;
    match connections.get_mut(&id).map(|c| &mut c.handle) {
        Some(DbHandle::Redis(conn)) => redis_db::select_db(conn, index).await,
        Some(_) => Err("Connection is not a Redis connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn redis_scan_keys(
    state: State<'_, AppState>,
    id: String,
    pattern: String,
    cursor: String,
    count: i64,
) -> Result<redis_db::KeyPage, String> {
    let mut connections = state.connections.lock().await;
    match connections.get_mut(&id).map(|c| &mut c.handle) {
        Some(DbHandle::Redis(conn)) => redis_db::scan_keys(conn, &pattern, &cursor, count).await,
        Some(_) => Err("Connection is not a Redis connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn redis_key_value(
    state: State<'_, AppState>,
    id: String,
    key: String,
    cursor: Option<String>,
    count: i64,
) -> Result<redis_db::KeyValuePage, String> {
    let mut connections = state.connections.lock().await;
    match connections.get_mut(&id).map(|c| &mut c.handle) {
        Some(DbHandle::Redis(conn)) => redis_db::key_value(conn, &key, cursor.as_deref(), count).await,
        Some(_) => Err("Connection is not a Redis connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}

#[tauri::command]
pub async fn redis_delete_keys(
    state: State<'_, AppState>,
    id: String,
    keys: Vec<String>,
) -> Result<i64, String> {
    let mut connections = state.connections.lock().await;
    match connections.get_mut(&id).map(|c| &mut c.handle) {
        Some(DbHandle::Redis(conn)) => redis_db::delete_keys(conn, &keys).await,
        Some(_) => Err("Connection is not a Redis connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}
