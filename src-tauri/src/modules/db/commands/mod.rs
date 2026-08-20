//! Connecting, disconnecting, and everything the per-engine command files are built on.
//!
//! The helpers below stay private on purpose: a child module sees its parent's private items, so
//! `commands/mysql.rs` reaches them through `use super::...` while nothing outside `commands` can.
//!
//! The drivers are reached through `drivers::` here rather than imported by name, because
//! `pub mod mysql;` below and a `use ...drivers::mysql;` would be the same name in this one module.

use crate::error::AppError;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::modules::db::drivers;
use crate::modules::db::models::{ConnectionConfig, DbKind};
use crate::modules::db::state::{ActiveConnection, DbHandle, DbState};
use crate::ssh::{self, SshConfig};

/// Chạy lại một lệnh **đọc** đúng một lần, nếu lần đầu chết cùng kết nối.
///
/// Chỉ đọc. Một `INSERT` chạy lại sau khi mất kết nối có thể thành hai dòng — câu lệnh có thể đã
/// tới máy chủ và chỉ có câu trả lời là mất — nên lệnh ghi báo lỗi và để người dùng quyết định.
///
/// Là macro chứ không phải một hàm nhận closure: một `Fn() -> impl Future` mượn `State<'_, DbState>`
/// đưa lời gọi vào đúng loại rắc rối lifetime không đáng đánh nhau, còn macro thì chỉ là viết thân
/// lệnh hai lần.
///
/// Gọi bằng `retry_read!({ ... })` — ngoặc tròn bọc block, vì một lời gọi macro mở bằng ngoặc nhọn
/// ở vị trí câu lệnh được phân tích như một *statement macro*, không phải một biểu thức có giá trị.
macro_rules! retry_read {
    ($body:block) => {{
        match async { $body }.await {
            // Không ngủ giữa hai lần: lần thứ hai sẽ tự nằm chờ trong `acquire` của pool, sau
            // lần mở lại phiên đang diễn ra.
            Err(e) if e.code == "error.connectionLost" => async { $body }.await,
            first => first,
        }
    }};
}

pub mod mongo;
pub mod mysql;
pub mod postgres;
pub mod redis;
pub mod tools;


const DB_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Where the settings screen listens for how far a tool download has got. Named here and in
/// `src/tools.ts`, which are the only two places that need to agree on it.
const TOOLS_PROGRESS_EVENT: &str = "tools://progress";

/// Where the workspace listens for how far a dump or a restore has got. Named here and in
/// `src/transfer.ts`.
const TRANSFER_PROGRESS_EVENT: &str = "transfer://progress";

/// Where a workspace listens for its SSH tunnel dropping and coming back. Named here and in
/// `src/modules/db/tunnel.ts`.
const TUNNEL_STATE_EVENT: &str = "tunnel://state";

/// One reading of a running transfer, with the connection it belongs to: two tabs can be dumping at
/// once, and neither overlay has any business showing the other's figures.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    id: String,
    #[serde(flatten)]
    progress: drivers::dump::Progress,
}

/// Hands every reading of one connection's transfer to the window, on [`TRANSFER_PROGRESS_EVENT`].
fn reporter(app: &AppHandle, id: &str) -> impl Fn(drivers::dump::Progress) {
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

/// Một tin về tunnel của một connection, gửi lên cửa sổ.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TunnelState {
    id: String,
    /// `"reconnecting"`, `"reconnected"` hoặc `"failed"` — cùng bộ chữ với `TunnelState` bên
    /// TypeScript.
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<AppError>,
}

/// Hands every turn of one connection's tunnel to the window, on [`TUNNEL_STATE_EVENT`].
fn tunnel_notify(app: &AppHandle, id: &str) -> ssh::TunnelNotify {
    let app = app.clone();
    let id = id.to_string();
    Arc::new(move |event: ssh::TunnelEvent| {
        let (state, error) = match event {
            ssh::TunnelEvent::Reconnecting => ("reconnecting", None),
            ssh::TunnelEvent::Reconnected => ("reconnected", None),
            ssh::TunnelEvent::Failed(e) => ("failed", Some(e)),
        };
        // A dropped notice is not worth failing anything over: the watcher says it again on its
        // next round.
        let _ = app.emit(
            TUNNEL_STATE_EVENT,
            TunnelState { id: id.clone(), state, error },
        );
    })
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
    ssh::test_connection(&ssh, &app_data_dir(&app)?).await
}

/// The address to dial and, when the connection goes through SSH, the tunnel that has to stay
/// alive for it to keep working. A caller that gives up before storing the tunnel drops it, which
/// closes the forward again rather than leaving it running unattended.
async fn resolve_endpoint(
    config: &ConnectionConfig,
    app_data: &std::path::Path,
    notify: ssh::TunnelNotify,
) -> Result<(String, u16, Option<ssh::Tunnel>), AppError> {
    match &config.ssh {
        Some(ssh) => {
            let (local_port, tunnel) =
                ssh::open_tunnel(ssh, &config.host, config.port, app_data, notify).await?;
            Ok(("127.0.0.1".to_string(), local_port, Some(tunnel)))
        }
        None => Ok((config.host.clone(), config.port, None)),
    }
}

#[tauri::command]
pub async fn connect_db(
    app: AppHandle,
    state: State<'_, DbState>,
    config: ConnectionConfig,
) -> Result<String, AppError> {
    let app_data = app_data_dir(&app)?;
    // Id sinh ở đây chứ không phải sau khi đã kết nối: closure báo tin cần biết nó tên gì, và
    // tunnel bắt đầu báo tin ngay khi nó được mở.
    let id = Uuid::new_v4().to_string();
    let notify = tunnel_notify(&app, &id);
    let (handle, endpoint, tunnel) = match config.kind {
        DbKind::Mysql => {
            let (host, port, tunnel) =
                resolve_endpoint(&config, &app_data, Arc::clone(&notify)).await?;
            let username = config.username.clone().unwrap_or_default();
            let password = config.password.clone().unwrap_or_default();
            let pool = with_timeout(
                drivers::mysql::connect(
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
            let mariadb = drivers::mysql::detect_mariadb(&pool).await;
            (DbHandle::Mysql { pool, mariadb }, Some((host, port)), tunnel)
        }
        DbKind::Postgres => {
            let (host, port, tunnel) =
                resolve_endpoint(&config, &app_data, Arc::clone(&notify)).await?;
            let username = config.username.clone().unwrap_or_default();
            let password = config.password.clone().unwrap_or_default();
            let pools = with_timeout(
                drivers::postgres::connect(
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
                    let (host, port) = drivers::mongo::first_endpoint(uri).await?;
                    let (local_port, task) =
                        ssh::open_tunnel(ssh, &host, port, &app_data, Arc::clone(&notify)).await?;
                    (Some(("127.0.0.1".to_string(), local_port)), Some(task))
                }
                None => (None, None),
            };
            let client =
                with_timeout(drivers::mongo::connect(uri, endpoint.clone()), "MongoDB").await?;
            (DbHandle::Mongo(client), endpoint, tunnel)
        }
        DbKind::Redis => {
            let (host, port, tunnel) =
                resolve_endpoint(&config, &app_data, Arc::clone(&notify)).await?;
            let db_index = config.database.as_deref().and_then(|d| d.parse().ok()).unwrap_or(0);
            let conn = with_timeout(
                drivers::redis::connect(
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
pub async fn disconnect_db(state: State<'_, DbState>, id: String) -> Result<(), AppError> {
    state.connections.lock().await.remove(&id);
    Ok(())
}

/// The handle `id` names, cloned out of the connection map so that the map is unlocked again
/// before the command runs anything on it.
///
/// This is what `DbHandle` is cheap to clone for. Awaiting a query while holding the map would
/// turn that lock into a queue for the whole app: a slow `SELECT` in one tab would stop a key
/// listing in another, and stop the Disconnect button meant to put an end to it.
async fn handle(state: &State<'_, DbState>, id: &str) -> Result<DbHandle, AppError> {
    state
        .connections
        .lock()
        .await
        .get(id)
        .map(|connection| connection.handle.clone())
        .ok_or_else(|| err!("error.unknownConnection"))
}

async fn mysql_pool(state: &State<'_, DbState>, id: &str) -> Result<sqlx::MySqlPool, AppError> {
    mysql_connection(state, id).await.map(|(pool, _)| pool)
}

/// The MySQL pool for `id`, and whether the server it reaches is MariaDB — for the handful of
/// reads whose answer depends on which of the two answered.
async fn mysql_connection(
    state: &State<'_, DbState>,
    id: &str,
) -> Result<(sqlx::MySqlPool, bool), AppError> {
    match handle(state, id).await? {
        DbHandle::Mysql { pool, mariadb } => Ok((pool, mariadb)),
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
    state: &State<'_, DbState>,
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
    state: &State<'_, DbState>,
    id: &str,
) -> Result<Arc<drivers::postgres::Pools>, AppError> {
    match handle(state, id).await? {
        DbHandle::Postgres(pools) => Ok(pools),
        _ => Err(err!("error.wrongConnectionKind", kind = "PostgreSQL")),
    }
}

async fn mongo_client(state: &State<'_, DbState>, id: &str) -> Result<mongodb::Client, AppError> {
    match handle(state, id).await? {
        DbHandle::Mongo(client) => Ok(client),
        _ => Err(err!("error.wrongConnectionKind", kind = "MongoDB")),
    }
}

/// The Redis connection `id` names. Locked by the caller for the length of one command, which is
/// as long as anything needs it: the lock is this connection's own, so two tabs no longer wait on
/// each other.
async fn redis_connection(
    state: &State<'_, DbState>,
    id: &str,
) -> Result<Arc<Mutex<drivers::redis::Connection>>, AppError> {
    match handle(state, id).await? {
        DbHandle::Redis(conn) => Ok(conn),
        _ => Err(err!("error.wrongConnectionKind", kind = "Redis")),
    }
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
    state: &State<'_, DbState>,
    id: &str,
    kind: DbKind,
) -> Result<SqlEndpoint, AppError> {
    let connections = state.connections.lock().await;
    let connection = connections.get(id).ok_or_else(|| err!("error.unknownConnection"))?;
    let matches = match kind {
        DbKind::Mysql => matches!(connection.handle, DbHandle::Mysql { .. }),
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
    state: &State<'_, DbState>,
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

#[cfg(test)]
mod tests {
    use crate::error::AppError;
    use std::cell::Cell;

    /// Đúng một lần chạy lại, và chỉ khi lần đầu chết cùng kết nối. Bộ đếm là thứ nói lên điều đó:
    /// một lệnh ghi lọt vào đây sẽ chạy hai lần, nên "chạy đúng mấy lần" là điều phải khoá lại.
    #[tokio::test]
    async fn a_read_runs_again_only_after_a_lost_connection() {
        let runs = Cell::new(0);
        let result: Result<u32, AppError> = retry_read!({
            runs.set(runs.get() + 1);
            if runs.get() == 1 {
                Err(err!("error.connectionLost"))
            } else {
                Ok(7)
            }
        });
        assert_eq!(result, Ok(7));
        assert_eq!(runs.get(), 2);

        // Lần đầu đã xong thì không có lần thứ hai.
        let runs = Cell::new(0);
        let result: Result<u32, AppError> = retry_read!({
            runs.set(runs.get() + 1);
            // Kiểu lỗi phải nói ra ở đây: thân lệnh thật được `?` ghim kiểu cho, còn một `Ok`
            // đứng một mình trong `async` thì không có gì để suy ra `E`.
            Ok::<u32, AppError>(1)
        });
        assert_eq!(result, Ok(1));
        assert_eq!(runs.get(), 1);

        // Lỗi của máy chủ không phải lý do để hỏi lại: câu SQL sai lần hai vẫn sai.
        let runs = Cell::new(0);
        let result: Result<u32, AppError> = retry_read!({
            runs.set(runs.get() + 1);
            Err(err!("error.mysql", message = "syntax"))
        });
        assert_eq!(result, Err(err!("error.mysql", message = "syntax")));
        assert_eq!(runs.get(), 1);
    }
}
