use super::local;
use super::models::LocalShell;
use crate::error::AppError;

/// Máy này mở được shell nào. Dò bằng cách nhìn đĩa và — trên Windows — hỏi `wsl.exe`, nên chạy
/// trên thread blocking chứ không giữ vòng lặp async.
#[tauri::command]
pub async fn terminal_local_shells() -> Result<Vec<LocalShell>, AppError> {
    tokio::task::spawn_blocking(local::detect)
        .await
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))
}
