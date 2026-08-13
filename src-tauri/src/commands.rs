use crate::error::AppError;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::db::{
    dump, mongo, mysql, mysql_script, mysql_structure, postgres, postgres_ddl, postgres_script,
    postgres_structure,
    redis as redis_db, tools,
};
use crate::models::{ConnectionConfig, DbKind, SshConfig};
use crate::secrets;
use crate::ssh_tunnel;
use crate::state::{ActiveConnection, AppState, DbHandle};

const DB_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Where the settings screen listens for how far a tool download has got. Named here and in
/// `src/tools.ts`, which are the only two places that need to agree on it.
const TOOLS_PROGRESS_EVENT: &str = "tools://progress";

/// Where the workspace listens for how far a dump or a restore has got. Named here and in
/// `src/transfer.ts`.
const TRANSFER_PROGRESS_EVENT: &str = "transfer://progress";

/// One reading of a running transfer, with the connection it belongs to: two tabs can be dumping at
/// once, and neither overlay has any business showing the other's figures.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    id: String,
    #[serde(flatten)]
    progress: dump::Progress,
}

/// Hands every reading of one connection's transfer to the window, on [`TRANSFER_PROGRESS_EVENT`].
fn reporter(app: &AppHandle, id: &str) -> impl Fn(dump::Progress) {
    let app = app.clone();
    let id = id.to_string();
    move |progress| {
        // A dropped reading is not worth failing a transfer over: the next one is a quarter of a
        // second away, and the last word comes from the command's own result.
        let _ = app.emit(
            TRANSFER_PROGRESS_EVENT,
            TransferProgress { id: id.clone(), progress },
        );
    }
}

async fn with_timeout<T>(
    fut: impl std::future::Future<Output = Result<T, AppError>>,
    kind: &'static str,
) -> Result<T, AppError> {
    match tokio::time::timeout(DB_CONNECT_TIMEOUT, fut).await {
        Ok(result) => result,
        Err(_) => Err(err!("error.connectTimeout", kind = kind, seconds = DB_CONNECT_TIMEOUT.as_secs())),
    }
}

#[tauri::command]
pub async fn test_ssh_tunnel(app: AppHandle, ssh: SshConfig) -> Result<(), AppError> {
    ssh_tunnel::test_connection(&ssh, &app_data_dir(&app)?).await
}

/// The address to dial and, when the connection goes through SSH, the tunnel that has to stay
/// alive for it to keep working. A caller that gives up before storing the tunnel drops it, which
/// closes the forward again rather than leaving it running unattended.
async fn resolve_endpoint(
    config: &ConnectionConfig,
    app_data: &std::path::Path,
) -> Result<(String, u16, Option<ssh_tunnel::Tunnel>), AppError> {
    match &config.ssh {
        Some(ssh) => {
            let (local_port, tunnel) =
                ssh_tunnel::open_tunnel(ssh, &config.host, config.port, app_data).await?;
            Ok(("127.0.0.1".to_string(), local_port, Some(tunnel)))
        }
        None => Ok((config.host.clone(), config.port, None)),
    }
}

#[tauri::command]
pub async fn connect_db(
    app: AppHandle,
    state: State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<String, AppError> {
    let app_data = app_data_dir(&app)?;
    let (handle, endpoint, tunnel) = match config.kind {
        DbKind::Mysql => {
            let (host, port, tunnel) = resolve_endpoint(&config, &app_data).await?;
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
                "MySQL",
            )
            .await?;
            (DbHandle::Mysql(pool), Some((host, port)), tunnel)
        }
        DbKind::Postgres => {
            let (host, port, tunnel) = resolve_endpoint(&config, &app_data).await?;
            let username = config.username.clone().unwrap_or_default();
            let password = config.password.clone().unwrap_or_default();
            let pools = with_timeout(
                postgres::connect(
                    &host,
                    port,
                    &username,
                    &password,
                    config.database.as_deref(),
                    config.use_ssl,
                ),
                "PostgreSQL",
            )
            .await?;
            (
                DbHandle::Postgres(Arc::new(pools)),
                Some((host, port)),
                tunnel,
            )
        }
        // MongoDB is configured as a whole connection string rather than host/port/user/password,
        // so the endpoint lives inside the URI. Tunneling therefore has to read the host back out
        // of it and then override it, instead of going through `resolve_endpoint`.
        DbKind::Mongo => {
            let uri = config.uri.as_deref().unwrap_or_default().trim();
            if uri.is_empty() {
                return Err(err!("error.mongoUriRequired"));
            }
            let (endpoint, tunnel) = match &config.ssh {
                Some(ssh) => {
                    let (host, port) = mongo::first_endpoint(uri).await?;
                    let (local_port, task) = ssh_tunnel::open_tunnel(ssh, &host, port, &app_data).await?;
                    (Some(("127.0.0.1".to_string(), local_port)), Some(task))
                }
                None => (None, None),
            };
            let client =
                with_timeout(mongo::connect(uri, endpoint.clone()), "MongoDB").await?;
            (DbHandle::Mongo(client), endpoint, tunnel)
        }
        DbKind::Redis => {
            let (host, port, tunnel) = resolve_endpoint(&config, &app_data).await?;
            let db_index = config.database.as_deref().and_then(|d| d.parse().ok()).unwrap_or(0);
            let conn = with_timeout(
                redis_db::connect(
                    &host,
                    port,
                    config.username.as_deref(),
                    config.password.as_deref(),
                    db_index,
                ),
                "Redis",
            )
            .await?;
            (
                DbHandle::Redis(Arc::new(Mutex::new(conn))),
                Some((host, port)),
                tunnel,
            )
        }
    };

    let id = Uuid::new_v4().to_string();
    state.connections.lock().await.insert(
        id.clone(),
        ActiveConnection {
            handle,
            config,
            endpoint,
            tunnel,
        },
    );
    Ok(id)
}

#[tauri::command]
pub async fn disconnect_db(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    state.connections.lock().await.remove(&id);
    Ok(())
}

/// The handle `id` names, cloned out of the connection map so that the map is unlocked again
/// before the command runs anything on it.
///
/// This is what `DbHandle` is cheap to clone for. Awaiting a query while holding the map would
/// turn that lock into a queue for the whole app: a slow `SELECT` in one tab would stop a key
/// listing in another, and stop the Disconnect button meant to put an end to it.
async fn handle(state: &State<'_, AppState>, id: &str) -> Result<DbHandle, AppError> {
    state
        .connections
        .lock()
        .await
        .get(id)
        .map(|connection| connection.handle.clone())
        .ok_or_else(|| err!("error.unknownConnection"))
}

async fn mysql_pool(state: &State<'_, AppState>, id: &str) -> Result<sqlx::MySqlPool, AppError> {
    match handle(state, id).await? {
        DbHandle::Mysql(pool) => Ok(pool),
        _ => Err(err!("error.wrongConnectionKind", kind = "MySQL")),
    }
}

/// The pool for one database of a PostgreSQL connection, opening it if this is the first time that
/// database has been asked for. `database` empty means the one the connection was opened on.
///
/// Every PostgreSQL command goes through this rather than through a pool of its own, because that
/// is the whole difference from MySQL: there is no `USE`, so which database a command runs against
/// is decided by which pool it is handed.
async fn postgres_pool(
    state: &State<'_, AppState>,
    id: &str,
    database: &str,
) -> Result<sqlx::PgPool, AppError> {
    match handle(state, id).await? {
        DbHandle::Postgres(pools) => pools.pool(Some(database)).await,
        _ => Err(err!("error.wrongConnectionKind", kind = "PostgreSQL")),
    }
}

/// The whole PostgreSQL connection rather than one of its pools — for `DROP DATABASE`, which has
/// to close the pool on the database it is dropping before the server will allow it.
async fn postgres_pools(
    state: &State<'_, AppState>,
    id: &str,
) -> Result<Arc<postgres::Pools>, AppError> {
    match handle(state, id).await? {
        DbHandle::Postgres(pools) => Ok(pools),
        _ => Err(err!("error.wrongConnectionKind", kind = "PostgreSQL")),
    }
}

async fn mongo_client(state: &State<'_, AppState>, id: &str) -> Result<mongodb::Client, AppError> {
    match handle(state, id).await? {
        DbHandle::Mongo(client) => Ok(client),
        _ => Err(err!("error.wrongConnectionKind", kind = "MongoDB")),
    }
}

/// The Redis connection `id` names. Locked by the caller for the length of one command, which is
/// as long as anything needs it: the lock is this connection's own, so two tabs no longer wait on
/// each other.
async fn redis_connection(
    state: &State<'_, AppState>,
    id: &str,
) -> Result<Arc<Mutex<redis_db::Connection>>, AppError> {
    match handle(state, id).await? {
        DbHandle::Redis(conn) => Ok(conn),
        _ => Err(err!("error.wrongConnectionKind", kind = "Redis")),
    }
}

#[tauri::command]
pub async fn mysql_query(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Vec<Map<String, Value>>, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql::query(&pool, &sql, database.as_deref()).await
}

#[tauri::command]
pub async fn mysql_list_databases(state: State<'_, AppState>, id: String) -> Result<Vec<String>, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql::list_databases(&pool).await
}

#[tauri::command]
pub async fn mysql_server_info(state: State<'_, AppState>, id: String) -> Result<mysql::ServerInfo, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql::server_info(&pool).await
}

#[tauri::command]
pub async fn mysql_list_tables(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql::list_tables(&pool, &database).await
}

/// What every table in the database weighs, for the workspace's Statistics tab.
#[tauri::command]
pub async fn mysql_table_stats(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Vec<mysql_structure::TableStats>, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::table_stats(&pool, &database).await
}

#[tauri::command]
pub async fn mysql_table_data(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    query: mysql::PageQuery,
) -> Result<mysql::TablePage, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql::table_data(&pool, &database, &table, &query).await
}

#[tauri::command]
pub async fn mysql_update_row(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    updates: Map<String, Value>,
    key: Map<String, Value>,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql::update_row(&pool, &database, &table, &updates, &key).await
}

#[tauri::command]
pub async fn mysql_insert_rows(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    rows: Vec<Map<String, Value>>,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql::insert_rows(&pool, &database, &table, &rows).await
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
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
        mysql::delete_rows(&pool, &database, &table, &keys, all, reset_auto_increment).await
}

#[tauri::command]
pub async fn mysql_table_structure(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<mysql_structure::TableStructure, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::table_structure(&pool, &database, &table).await
}

/// Every table and column of one database, for the Query tab's completion. One read covers the
/// whole database, so the editor never asks per table as the Structure tab does.
#[tauri::command]
pub async fn mysql_schema_outline(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<mysql_structure::SchemaOutline, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::schema_outline(&pool, &database).await
}

/// The collations this server has, for the column editor's picker. A property of the server rather
/// than of any one table, so the frontend reads it once per connection.
#[tauri::command]
pub async fn mysql_collations(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<mysql_structure::Collation>, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::collations(&pool).await
}

/// What a dump or restore needs to dial the server itself: the address actually in use (the
/// tunnel's local end, when there is one) and the credentials that opened the connection.
///
/// Read out of the connection and returned by value on purpose — the tools run for as long as the
/// database is big, and holding the connection lock across that would stop every other command in
/// the app until the dump finished.
struct SqlEndpoint {
    host: String,
    port: u16,
    user: String,
    password: String,
}

/// The endpoint of a MySQL or PostgreSQL connection, checking on the way that it is the kind the
/// caller expects — the tools of one engine cannot be pointed at the other's server.
async fn sql_endpoint(
    state: &State<'_, AppState>,
    id: &str,
    kind: DbKind,
) -> Result<SqlEndpoint, AppError> {
    let connections = state.connections.lock().await;
    let connection = connections.get(id).ok_or_else(|| err!("error.unknownConnection"))?;
    let matches = match kind {
        DbKind::Mysql => matches!(connection.handle, DbHandle::Mysql(_)),
        DbKind::Postgres => matches!(connection.handle, DbHandle::Postgres(_)),
        _ => false,
    };
    if !matches {
        let name = if kind == DbKind::Postgres { "PostgreSQL" } else { "MySQL" };
        return Err(err!("error.wrongConnectionKind", kind = name));
    }
    let (host, port) = connection
        .endpoint
        .clone()
        .ok_or_else(|| err!("error.noDumpAddress"))?;
    Ok(SqlEndpoint {
        host,
        port,
        user: connection.config.username.clone().unwrap_or_default(),
        password: connection.config.password.clone().unwrap_or_default(),
    })
}

/// The MongoDB connection string to hand the tools, and the tunnel endpoint to point it at.
async fn mongo_endpoint(
    state: &State<'_, AppState>,
    id: &str,
) -> Result<(String, Option<(String, u16)>), AppError> {
    let connections = state.connections.lock().await;
    let connection = connections.get(id).ok_or_else(|| err!("error.unknownConnection"))?;
    if !matches!(connection.handle, DbHandle::Mongo(_)) {
        return Err(err!("error.wrongConnectionKind", kind = "MongoDB"));
    }
    let uri = connection
        .config
        .uri
        .clone()
        .filter(|uri| !uri.trim().is_empty())
        .ok_or_else(|| err!("error.noDumpUri"))?;
    Ok((uri, connection.endpoint.clone()))
}

/// Runs one of the command-line tools off the async runtime: they block for as long as the dump
/// takes, which is not something an async worker should be spending itself on.
async fn in_background<T, F>(work: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| err!("error.backgroundTaskFailed", message = e))?
}

/// Writes a saved connection's secrets to the OS credential store, replacing what was there.
///
/// Off the async runtime: the credential stores are blocking, and on macOS opening one may put a
/// prompt on screen — which is not something to hold a runtime worker for.
#[tauri::command]
pub async fn secrets_save(id: String, secrets: secrets::Secrets) -> Result<(), AppError> {
    in_background(move || secrets::save(&id, &secrets)).await
}

/// A saved connection's secrets, or nothing when it has none stored.
#[tauri::command]
pub async fn secrets_load(id: String) -> Result<secrets::Secrets, AppError> {
    in_background(move || secrets::load(&id)).await
}

/// Forgets a saved connection's secrets, for when the connection itself is deleted.
#[tauri::command]
pub async fn secrets_delete(id: String) -> Result<(), AppError> {
    in_background(move || secrets::delete(&id)).await
}

/// Where MixDB keeps what it remembers between runs: the tools it downloaded, and the SSH host
/// keys it has seen.
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| err!("error.noAppDataDir", message = e))
}

/// Where MixDB keeps the tools it downloaded for itself.
fn tools_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app_data_dir(app).map(|dir| dir.join("tools"))
}

/// Every dump tool and where it stands: a path the user chose, a copy MixDB downloaded, something
/// already on the machine, or nothing at all.
#[tauri::command]
pub async fn tools_status(app: AppHandle) -> Result<Vec<tools::ToolStatus>, AppError> {
    Ok(tools::status(&tools_dir(&app)?))
}

/// Whether a suite is usable at all — what the dump and restore buttons check before running.
#[tauri::command]
pub async fn tools_ready(app: AppHandle, suite: String) -> Result<bool, AppError> {
    let suite = tools::Suite::parse(&suite)?;
    Ok(tools::installed(suite, &tools_dir(&app)?))
}

/// Whether MixDB can fetch this suite for itself on this platform — MySQL publishes a plain
/// archive for Windows only, so everywhere else its tools have to come from the machine.
#[tauri::command]
pub async fn tools_downloadable(suite: String) -> Result<bool, AppError> {
    Ok(tools::downloadable(tools::Suite::parse(&suite)?))
}

/// Points a tool at a copy the user picked themselves, or forgets that choice when given no path.
#[tauri::command]
pub async fn tools_set_path(
    app: AppHandle,
    tool: String,
    path: Option<String>,
) -> Result<(), AppError> {
    let tool = tools::Tool::parse(&tool)?;
    tools::set_path(tool, path.as_deref(), &tools_dir(&app)?)
}

/// Deletes the copy MixDB downloaded. What was already on the machine is left where it is.
#[tauri::command]
pub async fn tools_uninstall(app: AppHandle, suite: String) -> Result<(), AppError> {
    let suite = tools::Suite::parse(&suite)?;
    tools::uninstall(suite, &tools_dir(&app)?)
}

/// Downloads one suite of tools.
///
/// Minutes long on an ordinary connection, so it reports as it goes: every stage, and a running
/// byte count while the archive comes down, on `tools://progress`. The command returning is what
/// says it is finished — the events only say how far along it is.
#[tauri::command]
pub async fn tools_install(app: AppHandle, suite: String) -> Result<(), AppError> {
    let suite = tools::Suite::parse(&suite)?;
    let dir = tools_dir(&app)?;
    let reporter = app.clone();
    in_background(move || {
        tools::install(suite, &dir, &|progress| {
            // A dropped progress event is not worth failing an install over: the next one is a
            // quarter of a second away, and the last word comes from the command's own result.
            let _ = reporter.emit(TOOLS_PROGRESS_EVENT, progress);
        })
    })
    .await
}

/// Writes a database out as SQL. `mode` is `structure`, `data` or `all`.
///
/// Long enough on a real database to need saying how far along it is, which it does on
/// `transfer://progress` — an estimate built from what mysqldump says it is doing, so the command
/// returning is still what says the dump is done.
#[tauri::command]
pub async fn mysql_dump(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    database: String,
    mode: String,
    path: String,
) -> Result<(), AppError> {
    let mode = dump::DumpMode::parse(&mode)?;
    let tool = tools::require(tools::Tool::MysqlDump, &tools_dir(&app)?)?;
    // Read through the pool, before the endpoint: the character set the dump is transferred in and
    // the server's own version are properties of the server, not of how the tool is invoked.
    let pool = mysql_pool(&state, &id).await?;
    let charset = mysql_structure::dump_charset(&pool, &database).await?;
    let version = mysql::server_info(&pool).await.map(|info| info.version);
    // Only 8.0 and up has the histogram table an 8.0 mysqldump reads by default. A version that
    // could not be read is treated as old, which costs a dump nothing but the histograms.
    let column_statistics = version
        .as_deref()
        .is_ok_and(|version| !version.starts_with('5'));
    // What each table weighs, for the progress the dump reports. A server that will not say —
    // `information_schema` shows a user only what they have privileges on — leaves the dump to run
    // with a bar that moves without a number, which is not worth refusing to dump over.
    let tables: Vec<(String, u64)> = mysql_structure::table_stats(&pool, &database)
        .await
        .map(|tables| {
            tables
                .into_iter()
                .map(|table| (table.name, table.data_size))
                .collect()
        })
        .unwrap_or_default();
    let endpoint = sql_endpoint(&state, &id, DbKind::Mysql).await?;
    let report = reporter(&app, &id);
    in_background(move || {
        dump::mysql_dump(
            &tool,
            &endpoint.host,
            endpoint.port,
            &endpoint.user,
            &endpoint.password,
            &database,
            &charset,
            mode,
            column_statistics,
            &path,
            &tables,
            &dump::Watch { report: &report },
        )
    })
    .await
}

/// Replays a SQL file. `database` is the default one for statements that do not name their own.
///
/// Reports on `transfer://progress` as the file goes in, which for a restore is a count rather
/// than an estimate — the file is of a known size and the client is fed it byte by byte.
#[tauri::command]
pub async fn mysql_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    database: String,
    path: String,
) -> Result<(), AppError> {
    let tool = tools::require(tools::Tool::MysqlClient, &tools_dir(&app)?)?;
    let endpoint = sql_endpoint(&state, &id, DbKind::Mysql).await?;
    let report = reporter(&app, &id);
    in_background(move || {
        dump::mysql_restore(
            &tool,
            &endpoint.host,
            endpoint.port,
            &endpoint.user,
            &endpoint.password,
            &database,
            &path,
            &dump::Watch { report: &report },
        )
    })
    .await
}

/// Writes a database out as a mongodump archive.
///
/// Reports on `transfer://progress` as the archive is written, measured against what the server
/// says the database's documents weigh.
#[tauri::command]
pub async fn mongo_dump(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    db: String,
    path: String,
) -> Result<(), AppError> {
    let tool = tools::require(tools::Tool::MongoDump, &tools_dir(&app)?)?;
    let client = mongo_client(&state, &id).await?;
    // What the archive is being measured against. A server that will not say leaves the dump to
    // run with a bar that moves without a number, which is not worth refusing to dump over.
    let documents: u64 = mongo::collection_stats(&client, &db)
        .await
        .map(|collections| collections.iter().map(|one| one.data_size).sum())
        .unwrap_or(0);
    let (uri, endpoint) = mongo_endpoint(&state, &id).await?;
    let report = reporter(&app, &id);
    in_background(move || {
        let endpoint = endpoint.as_ref().map(|(host, port)| (host.as_str(), *port));
        dump::mongo_dump(
            &tool,
            &uri,
            endpoint,
            &db,
            &path,
            documents,
            &dump::Watch { report: &report },
        )
    })
    .await
}

/// Restores a mongodump archive into `db`, renaming its namespaces on the way in.
///
/// Reports on `transfer://progress` as the archive goes in, which like a MySQL restore is a count
/// rather than an estimate — the archive is fed to mongorestore byte by byte.
#[tauri::command]
pub async fn mongo_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    db: String,
    path: String,
) -> Result<(), AppError> {
    let tool = tools::require(tools::Tool::MongoRestore, &tools_dir(&app)?)?;
    let (uri, endpoint) = mongo_endpoint(&state, &id).await?;
    let report = reporter(&app, &id);
    in_background(move || {
        let endpoint = endpoint.as_ref().map(|(host, port)| (host.as_str(), *port));
        dump::mongo_restore(
            &tool,
            &uri,
            endpoint,
            &db,
            &path,
            &dump::Watch { report: &report },
        )
    })
    .await
}

/// Drops a database and every table in it.
#[tauri::command]
pub async fn mysql_drop_database(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::drop_database(&pool, &database).await
}

/// Drops a database and every collection in it.
#[tauri::command]
pub async fn mongo_drop_database(
    state: State<'_, AppState>,
    id: String,
    db: String,
) -> Result<(), AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::drop_database(&client, &db).await
}

/// Creates a database, for the header's database picker.
#[tauri::command]
pub async fn mysql_create_database(
    state: State<'_, AppState>,
    id: String,
    name: String,
    collation: Option<String>,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
        mysql_structure::create_database(&pool, &name, collation.as_deref()).await
}

/// Creates an empty table — one `id` column and its primary key — for the sidebar's add button.
#[tauri::command]
pub async fn mysql_create_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    collation: Option<String>,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
        mysql_structure::create_table(&pool, &database, &table, collation.as_deref()).await
}

/// Renames a table, for the sidebar's context menu.
#[tauri::command]
pub async fn mysql_rename_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    new_name: String,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
        mysql_structure::rename_table(&pool, &database, &table, &new_name).await
}

/// Drops a table and everything in it, for the sidebar's context menu.
#[tauri::command]
pub async fn mysql_drop_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::drop_table(&pool, &database, &table).await
}

#[tauri::command]
pub async fn mysql_add_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    spec: mysql_structure::ColumnSpec,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::add_column(&pool, &database, &table, &spec).await
}

#[tauri::command]
pub async fn mysql_modify_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
    spec: mysql_structure::ColumnSpec,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
        mysql_structure::modify_column(&pool, &database, &table, &name, &spec).await
}

#[tauri::command]
pub async fn mysql_drop_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::drop_column(&pool, &database, &table, &name).await
}

#[tauri::command]
pub async fn mysql_add_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    spec: mysql_structure::IndexSpec,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::add_index(&pool, &database, &table, &spec).await
}

#[tauri::command]
pub async fn mysql_modify_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
    spec: mysql_structure::IndexSpec,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
        mysql_structure::modify_index(&pool, &database, &table, &name, &spec).await
}

#[tauri::command]
pub async fn mysql_drop_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
) -> Result<(), AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_structure::drop_index(&pool, &database, &table, &name).await
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
) -> Result<Vec<mysql_script::StatementResult>, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    let result = mysql_script::run(&pool, &sql, database.as_deref(), |thread| {
        state
            .running_queries
            .lock()
            .unwrap()
            .insert(id.clone(), thread);
    })
    .await;
    // However it ended — finished, failed, or killed from `mysql_cancel_query` — there is nothing
    // left to cancel, and the id would otherwise name a session running someone else's statement
    // by the time the button was next pressed.
    state.running_queries.lock().unwrap().remove(&id);
    result
}

/// Asks MySQL to parse one statement without running it, for the editor's error checking.
///
/// Read-only in the strongest sense available: the statement is prepared and the plan thrown away,
/// so not even a `DELETE` handed to this does anything. What comes back is `null` when the server
/// had nothing to say — see `mysql_script::validate` for why most of what it *does* say is a
/// warning rather than an error.
#[tauri::command]
pub async fn mysql_validate_sql(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Option<mysql_script::SqlProblem>, AppError> {
    let pool = mysql_pool(&state, &id).await?;
    mysql_script::validate(&pool, &sql, database.as_deref()).await
}

/// Stops the script this connection is running, if it is running one.
///
/// Asking to cancel what has already finished is not an error: the button is pressed while the
/// results are on their way back often enough, and the user's intent — that it not still be
/// running — is satisfied either way.
#[tauri::command]
pub async fn mysql_cancel_query(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let thread = state.running_queries.lock().unwrap().get(&id).copied();
    let Some(thread) = thread else {
        return Ok(());
    };
    mysql::kill_query(&mysql_pool(&state, &id).await?, thread).await
}

#[tauri::command]
pub async fn mongo_list_databases(state: State<'_, AppState>, id: String) -> Result<Vec<String>, AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::list_databases(&client).await
}

#[tauri::command]
pub async fn mongo_server_info(state: State<'_, AppState>, id: String) -> Result<mongo::ServerInfo, AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::server_info(&client).await
}

#[tauri::command]
pub async fn mongo_list_collections(
    state: State<'_, AppState>,
    id: String,
    db: String,
) -> Result<Vec<String>, AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::list_collections(&client, &db).await
}

/// What every collection in the database weighs, for the workspace's Statistics tab.
#[tauri::command]
pub async fn mongo_collection_stats(
    state: State<'_, AppState>,
    id: String,
    db: String,
) -> Result<Vec<mongo::CollectionStats>, AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::collection_stats(&client, &db).await
}

/// Creates an empty collection, for the sidebar's add button.
#[tauri::command]
pub async fn mongo_create_collection(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
) -> Result<(), AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::create_collection(&client, &db, &collection).await
}

/// Renames a collection, for the sidebar's context menu.
#[tauri::command]
pub async fn mongo_rename_collection(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    new_name: String,
) -> Result<(), AppError> {
    let client = mongo_client(&state, &id).await?;
        mongo::rename_collection(&client, &db, &collection, &new_name).await
}

/// Drops a collection and every document in it, for the sidebar's context menu.
#[tauri::command]
pub async fn mongo_drop_collection(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
) -> Result<(), AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::drop_collection(&client, &db, &collection).await
}

#[tauri::command]
pub async fn mongo_find(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    filter: String,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::find(&client, &db, &collection, &filter, limit).await
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
) -> Result<mongo::CollectionPage, AppError> {
    let filters = filters.unwrap_or_default();
    let client = mongo_client(&state, &id).await?;
        mongo::collection_page(&client, &db, &collection, page, page_size, &filters).await
}

#[tauri::command]
pub async fn mongo_next_ids(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    count: i64,
) -> Result<Vec<Value>, AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::next_ids(&client, &db, &collection, count).await
}

#[tauri::command]
pub async fn mongo_insert_documents(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    documents: Vec<Value>,
) -> Result<usize, AppError> {
    let client = mongo_client(&state, &id).await?;
        mongo::insert_documents(&client, &db, &collection, &documents).await
}

#[tauri::command]
pub async fn mongo_update_document(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    doc_id: Value,
    ops: mongo::DocUpdateOps,
) -> Result<(), AppError> {
    let client = mongo_client(&state, &id).await?;
        mongo::update_document(&client, &db, &collection, &doc_id, &ops).await
}

#[tauri::command]
pub async fn mongo_delete_document(
    state: State<'_, AppState>,
    id: String,
    db: String,
    collection: String,
    doc_id: Value,
) -> Result<(), AppError> {
    let client = mongo_client(&state, &id).await?;
    mongo::delete_document(&client, &db, &collection, &doc_id).await
}

#[tauri::command]
pub async fn redis_command(
    state: State<'_, AppState>,
    id: String,
    args: Vec<String>,
) -> Result<Value, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::run_command(conn.commands(), args).await
}

#[tauri::command]
pub async fn redis_server_info(
    state: State<'_, AppState>,
    id: String,
) -> Result<redis_db::ServerInfo, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::server_info(conn.commands()).await
}

#[tauri::command]
pub async fn redis_list_databases(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<redis_db::DbInfo>, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::list_databases(conn.commands()).await
}

#[tauri::command]
pub async fn redis_select_db(
    state: State<'_, AppState>,
    id: String,
    index: i64,
) -> Result<(), AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::select_db(&mut conn, index).await
}

#[tauri::command]
pub async fn redis_scan_keys(
    state: State<'_, AppState>,
    id: String,
    pattern: String,
    cursor: String,
    count: i64,
) -> Result<redis_db::KeyPage, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::scan_keys(conn.commands(), &pattern, &cursor, count).await
}

#[tauri::command]
pub async fn redis_key_value(
    state: State<'_, AppState>,
    id: String,
    key: String,
    cursor: Option<String>,
    count: i64,
) -> Result<redis_db::KeyValuePage, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::key_value(conn.commands(), &key, cursor.as_deref(), count).await
}

#[tauri::command]
pub async fn redis_delete_keys(
    state: State<'_, AppState>,
    id: String,
    keys: Vec<String>,
) -> Result<i64, AppError> {
    let conn = redis_connection(&state, &id).await?;
    let mut conn = conn.lock().await;
    redis_db::delete_keys(conn.commands(), &keys).await
}

// ---------------------------------------------------------------------------
// PostgreSQL
//
// Every one of these takes the database as an argument the way the MySQL commands do, but it means
// something different: there it names a database to reach into from the one connection, here it
// picks which pool the command runs on. See `postgres_pool`.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn postgres_list_databases(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<String>, AppError> {
    let pool = postgres_pool(&state, &id, "").await?;
    postgres::list_databases(&pool).await
}

#[tauri::command]
pub async fn postgres_server_info(
    state: State<'_, AppState>,
    id: String,
) -> Result<postgres::ServerInfo, AppError> {
    let pool = postgres_pool(&state, &id, "").await?;
    postgres::server_info(&pool).await
}

#[tauri::command]
pub async fn postgres_list_tables(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres::list_tables(&pool).await
}

#[tauri::command]
pub async fn postgres_table_stats(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Vec<postgres_structure::TableStats>, AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_structure::table_stats(&pool).await
}

#[tauri::command]
pub async fn postgres_table_data(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    query: postgres::PageQuery,
) -> Result<postgres::TablePage, AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres::table_data(&pool, &table, &query).await
}

#[tauri::command]
pub async fn postgres_update_row(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    updates: Map<String, Value>,
    key: Map<String, Value>,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres::update_row(&pool, &table, &updates, &key).await
}

#[tauri::command]
pub async fn postgres_insert_rows(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    rows: Vec<Map<String, Value>>,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres::insert_rows(&pool, &table, &rows).await
}

/// `reset_auto_increment` keeps MySQL's name because it is the frontend's name for the same
/// checkbox; what it resets here is the table's identity or `serial` sequence.
#[tauri::command]
pub async fn postgres_delete_rows(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    keys: Vec<Map<String, Value>>,
    all: bool,
    reset_auto_increment: bool,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres::delete_rows(&pool, &table, &keys, all, reset_auto_increment).await
}

#[tauri::command]
pub async fn postgres_table_structure(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<postgres_structure::TableStructure, AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_structure::table_structure(&pool, &table).await
}

#[tauri::command]
pub async fn postgres_collations(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<postgres_structure::Collation>, AppError> {
    let pool = postgres_pool(&state, &id, "").await?;
    postgres_structure::collations(&pool).await
}

#[tauri::command]
pub async fn postgres_query(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, AppError> {
    let pool = postgres_pool(&state, &id, database.as_deref().unwrap_or("")).await?;
    postgres::query(&pool, &sql).await
}

#[tauri::command]
pub async fn postgres_schema_outline(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<postgres_structure::SchemaOutline, AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_structure::schema_outline(&pool, &database).await
}

#[tauri::command]
pub async fn postgres_run_script(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Vec<postgres_script::StatementResult>, AppError> {
    let pool = postgres_pool(&state, &id, database.as_deref().unwrap_or("")).await?;
    let result = postgres_script::run(&pool, &sql, |pid| {
        state.running_queries.lock().unwrap().insert(id.clone(), pid);
    })
    .await;
    // However it ended, there is nothing left to cancel — and the pid would otherwise name a
    // session running someone else's statement by the time the button was next pressed.
    state.running_queries.lock().unwrap().remove(&id);
    result
}

/// Asks PostgreSQL to parse one statement without running it, for the editor's error checking.
#[tauri::command]
pub async fn postgres_validate_sql(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    database: Option<String>,
) -> Result<Option<postgres_script::SqlProblem>, AppError> {
    let pool = postgres_pool(&state, &id, database.as_deref().unwrap_or("")).await?;
    postgres_script::validate(&pool, &sql).await
}

/// Stops the script this connection is running, if it is running one.
///
/// The cancel goes out on a connection of its own, since the one being cancelled is busy — and to
/// the same database, because a backend pid is only cancellable from the server it belongs to.
#[tauri::command]
pub async fn postgres_cancel_query(
    state: State<'_, AppState>,
    id: String,
    database: Option<String>,
) -> Result<(), AppError> {
    let pid = state.running_queries.lock().unwrap().get(&id).copied();
    let Some(pid) = pid else {
        return Ok(());
    };
    let pool = postgres_pool(&state, &id, database.as_deref().unwrap_or("")).await?;
    postgres_script::cancel(&pool, pid).await
}

/// Creates a database, for the header's database picker. `collation` is accepted and ignored: see
/// `postgres_ddl::create_database`.
#[tauri::command]
pub async fn postgres_create_database(
    state: State<'_, AppState>,
    id: String,
    name: String,
    #[allow(unused_variables)] collation: Option<String>,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, "").await?;
    postgres_ddl::create_database(&pool, &name).await
}

/// Drops a database and every table in it. Takes the whole connection rather than a pool, since the
/// pool on the database being dropped is what has to be closed first.
#[tauri::command]
pub async fn postgres_drop_database(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<(), AppError> {
    let pools = postgres_pools(&state, &id).await?;
    postgres_ddl::drop_database(&pools, &database).await
}

/// Creates an empty table — one `id` column and its primary key — for the sidebar's add button.
/// `collation` is accepted and ignored: a PostgreSQL table has none of its own.
#[tauri::command]
pub async fn postgres_create_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    #[allow(unused_variables)] collation: Option<String>,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::create_table(&pool, &table).await
}

#[tauri::command]
pub async fn postgres_rename_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    new_name: String,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::rename_table(&pool, &table, &new_name).await
}

#[tauri::command]
pub async fn postgres_drop_table(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::drop_table(&pool, &table).await
}

#[tauri::command]
pub async fn postgres_add_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    spec: postgres_ddl::ColumnSpec,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::add_column(&pool, &table, &spec).await
}

#[tauri::command]
pub async fn postgres_modify_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
    spec: postgres_ddl::ColumnSpec,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::modify_column(&pool, &table, &name, &spec).await
}

#[tauri::command]
pub async fn postgres_drop_column(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::drop_column(&pool, &table, &name).await
}

#[tauri::command]
pub async fn postgres_add_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    spec: postgres_ddl::IndexSpec,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::add_index(&pool, &table, &spec).await
}

#[tauri::command]
pub async fn postgres_modify_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
    spec: postgres_ddl::IndexSpec,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::modify_index(&pool, &table, &name, &spec).await
}

#[tauri::command]
pub async fn postgres_drop_index(
    state: State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    name: String,
) -> Result<(), AppError> {
    let pool = postgres_pool(&state, &id, &database).await?;
    postgres_ddl::drop_index(&pool, &table, &name).await
}


/// Writes a PostgreSQL database out as SQL. `mode` is `structure`, `data` or `all`.
///
/// Reports on `transfer://progress` as pg_dump names each table it reaches, the same estimate the
/// MySQL dump gives — so the command returning is still what says the dump is done.
#[tauri::command]
pub async fn postgres_dump(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    database: String,
    mode: String,
    path: String,
) -> Result<(), AppError> {
    let mode = dump::DumpMode::parse(&mode)?;
    let tool = tools::require(tools::Tool::PgDump, &tools_dir(&app)?)?;
    // What each table weighs, for the progress the dump reports. A server that will not say leaves
    // the dump to run with a bar that moves without a number, which is not worth refusing over.
    let pool = postgres_pool(&state, &id, &database).await?;
    let tables: Vec<(String, u64)> = postgres_structure::table_stats(&pool)
        .await
        .map(|tables| {
            tables
                .into_iter()
                .map(|table| (table.name, table.data_size))
                .collect()
        })
        .unwrap_or_default();
    let endpoint = sql_endpoint(&state, &id, DbKind::Postgres).await?;
    let report = reporter(&app, &id);
    in_background(move || {
        dump::postgres_dump(
            &tool,
            &endpoint.host,
            endpoint.port,
            &endpoint.user,
            &endpoint.password,
            &database,
            mode,
            &path,
            &tables,
            &dump::Watch { report: &report },
        )
    })
    .await
}

/// Replays a SQL file through psql, into `database`.
#[tauri::command]
pub async fn postgres_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    database: String,
    path: String,
) -> Result<(), AppError> {
    let tool = tools::require(tools::Tool::PsqlClient, &tools_dir(&app)?)?;
    let endpoint = sql_endpoint(&state, &id, DbKind::Postgres).await?;
    let report = reporter(&app, &id);
    in_background(move || {
        dump::postgres_restore(
            &tool,
            &endpoint.host,
            endpoint.port,
            &endpoint.user,
            &endpoint.password,
            &database,
            &path,
            &dump::Watch { report: &report },
        )
    })
    .await
}
