//! SQLite
//!
//! Every one of these takes a `database` argument the way the MySQL and PostgreSQL commands do, and
//! for the same reason — the workspace above hands one down — but there is only ever one value it
//! can hold: `drivers::sqlite::MAIN_DATABASE`. It is accepted and ignored rather than removed, so
//! that the shared `SqlApi` on the frontend keeps one shape across all three engines.
//!
//! `retry_read!` is not used here. It exists for a pooled connection that died between two
//! statements; a file that has gone away is not something a second attempt fixes.

use crate::error::AppError;
use crate::modules::db::drivers::sqlite;
use crate::modules::db::models::ServerInfo;
use crate::modules::db::state::DbState;
use tauri::State;

use super::sqlite_pool;

#[tauri::command]
pub async fn sqlite_server_info(
    state: State<'_, DbState>,
    id: String,
) -> Result<ServerInfo, AppError> {
    let pool = sqlite_pool(&state, &id).await?;
    sqlite::server_info(&pool).await
}
