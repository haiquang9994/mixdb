//! SQLite: opening a database file, and what the header says about it.
//!
//! The one driver here with no server behind it. That is the whole of what makes it different, and
//! it shows up in three places: there is no endpoint to dial and so no SSH tunnel and no TLS; there
//! is one database per connection and it is always SQLite's own `main`; and the thing being
//! opened is a file on this machine that some other program may be writing to at the same time.

use crate::error::AppError;
use crate::modules::db::models::ServerInfo;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::Path;
use std::time::Duration;

/// How long a statement waits for another writer before giving up. The default sqlx picks, named
/// here because it is a decision: the file may be open in another program, and five seconds is long
/// enough to ride out a short write and short enough that a held lock is reported rather than hung
/// on.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The counterpart of `mysql::map_error` — see `mysql::lost_connection` for what it is for.
///
/// There is no connection to lose here, so nothing maps to `error.connectionLost`: a file that has
/// gone away fails at the next statement with SQLite's own words, and those are worth showing.
pub(super) fn map_error(e: sqlx::Error) -> AppError {
    err!("error.sqlite", message = e)
}

/// Opens the database file at `path`.
///
/// **Never creates one.** `create_if_missing` is sqlx's default and is set here anyway, because
/// leaving it implicit makes a typed-in path that does not exist look like a working connection to
/// an empty database — see D5 of the plan this was built from. A missing file is an error.
///
/// The journal mode is deliberately not set. sqlx only issues `PRAGMA journal_mode` when it is
/// asked to, so opening someone's database here leaves whatever mode it is in alone; setting it
/// would rewrite the file — and convert a rollback-journal database to WAL — just by looking at it.
///
/// Foreign keys are enforced, which is sqlx's default rather than SQLite's own. Kept, because the
/// Structure tab shows a table's foreign keys and a delete that ignored them would be the app
/// disagreeing with what it just displayed.
pub async fn connect(path: &str) -> Result<SqlitePool, AppError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(err!("error.sqlitePathRequired"));
    }
    /* Checked before opening rather than left to SQLite, which reports a missing file as
       "unable to open database file" — the same words it uses for a directory, a permission
       problem and a corrupt header. */
    if !Path::new(path).is_file() {
        return Err(err!("error.sqliteFileNotFound", path = path));
    }

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .busy_timeout(BUSY_TIMEOUT);

    SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .map_err(map_error)
}

/// The version of the SQLite the app carries, and the file it is pointed at.
///
/// `os` is the file's name rather than a machine's: the header line reads "SQLite 3.x on
/// blog.db", which is the useful thing to say when what you are connected to is a path. The engine
/// is the one compiled into MixDB — a SQLite database file has no server to ask.
pub async fn server_info(pool: &SqlitePool) -> Result<ServerInfo, AppError> {
    let version: String = sqlx::query("select sqlite_version()")
        .fetch_one(pool)
        .await
        .map_err(map_error)?
        .try_get(0)
        .map_err(map_error)?;

    let filename = pool.connect_options().get_filename().to_path_buf();
    let os = filename
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| filename.to_string_lossy().into_owned());

    Ok(ServerInfo { version, os })
}
