use std::path::PathBuf;
use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use super::models::{LocalShell, Output, OutputSink, TerminalEvent, TerminalSize, TerminalTarget};
use super::state::TerminalState;
use super::{local, remote};
use crate::error::AppError;

/// Máy này mở được shell nào. Dò bằng cách nhìn đĩa và — trên Windows — hỏi `wsl.exe`, nên chạy
/// trên thread blocking chứ không giữ vòng lặp async.
#[tauri::command]
pub async fn terminal_local_shells() -> Result<Vec<LocalShell>, AppError> {
    tokio::task::spawn_blocking(local::detect)
        .await
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))
}

/// Mở một phiên và nối nó với `on_event`.
///
/// `Data` đi dạng byte thô, `Exit` đi dạng JSON, trên cùng một kênh — `Channel` đánh số thứ tự cho
/// mọi khung và phía JS xếp lại theo số đó, nên `Exit` không thể vượt lên trước byte cuối.
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    id: String,
    target: TerminalTarget,
    size: TerminalSize,
    on_event: Channel<InvokeResponseBody>,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    let sink: OutputSink = Arc::new(move |output| match output {
        Output::Data(bytes) => {
            let _ = on_event.send(InvokeResponseBody::Raw(bytes));
        }
        Output::Exit { code, message } => {
            if let Ok(json) = serde_json::to_string(&TerminalEvent::Exit { code, message }) {
                let _ = on_event.send(InvokeResponseBody::Json(json));
            }
        }
    });

    let session = match target {
        TerminalTarget::Local { shell, args, cwd } => local::spawn(shell, args, cwd, size, sink)?,
        // Xác thực hỏng, vân tay đổi, máy chủ không tới được — tất cả hỏng ở đây, trước khi có
        // phiên nào để đưa vào map. Đó là thứ frontend đưa về `ErrorBanner` ngay tại form.
        TerminalTarget::Ssh(ssh) => remote::spawn(&ssh, &app_data_dir(&app)?, size, sink).await?,
    };

    // Cùng một id mở hai lần thì phiên cũ bị thay và `Drop` của nó dọn phần còn lại.
    state.sessions.lock().unwrap().insert(id, session);
    Ok(())
}

/// Byte người dùng gõ. `data` là chuỗi chứ không phải base64: cái `onData` của xterm sinh ra luôn
/// là chuỗi hợp lệ, và UTF-8 của nó đúng là thứ cần ghi vào pty.
#[tauri::command]
pub async fn terminal_write(
    id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| err!("error.terminalUnknownSession"))?;
    session
        .input
        .send(data.into_bytes())
        .map_err(|_| err!("error.terminalUnknownSession"))
}

#[tauri::command]
pub async fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| err!("error.terminalUnknownSession"))?;
    session
        .resize
        .send(TerminalSize { cols, rows })
        .map_err(|_| err!("error.terminalUnknownSession"))
}

/// Đóng phiên. Bỏ khỏi map là `Drop` chạy, là tiến trình bị giết — không có bước nào khác.
/// Một id không có trong map không phải lỗi: tab đóng sau khi phiên đã tự chết là chuyện thường.
#[tauri::command]
pub async fn terminal_close(id: String, state: State<'_, TerminalState>) -> Result<(), AppError> {
    state.sessions.lock().unwrap().remove(&id);
    Ok(())
}

/// Nơi MixDB nhớ những gì nó thấy giữa các lần chạy. Ở đây chỉ cần một thứ trong đó:
/// `known_hosts.json`, tức vân tay của mọi máy chủ SSH đã kết nối.
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| err!("error.noAppDataDir", message = e))
}
