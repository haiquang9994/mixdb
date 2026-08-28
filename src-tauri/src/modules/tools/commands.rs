//! Lệnh duy nhất của module Tools, và nó **chỉ đọc**.
//!
//! Không có `kill` ở đây và sẽ không bao giờ có: tool in ra lệnh giết tiến trình để người dùng chép
//! và tự chạy, và đó là ranh giới an toàn của cả module chứ không phải sự lười.

use crate::error::AppError;
use crate::platform::in_background;
use std::process::Command;

use super::ports::{self, ListeningPort};

/// Cổng nào trên máy này đang được nghe.
///
/// Chạy trên thread blocking: `netstat` trên một máy có nhiều kết nối mất vài trăm mili giây, và
/// `lsof` còn lâu hơn khi có ổ đĩa mạng.
#[tauri::command]
pub async fn tools_listening_ports() -> Result<Vec<ListeningPort>, AppError> {
    in_background(collect).await
}

fn output_of(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn collect() -> Result<Vec<ListeningPort>, AppError> {
    let netstat = output_of("netstat", &["-ano"])
        .ok_or_else(|| err!("error.portScanFailed", tool = "netstat"))?;
    // Không tra được tên tiến trình thì bảng vẫn có ích: cổng và PID đã trả lời được câu hỏi chính.
    let tasklist = output_of("tasklist", &["/FO", "CSV", "/NH"]).unwrap_or_default();
    Ok(ports::parse_netstat(&netstat, &tasklist))
}

#[cfg(target_os = "linux")]
fn collect() -> Result<Vec<ListeningPort>, AppError> {
    if let Some(text) = output_of("ss", &["-lntp"]) {
        return Ok(ports::parse_ss(&text));
    }
    // Máy không có `ss` thì lùi về `lsof` — cùng bộ đọc với macOS.
    let text = output_of("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"])
        .ok_or_else(|| err!("error.portScanFailed", tool = "ss"))?;
    Ok(ports::parse_lsof(&text))
}

#[cfg(target_os = "macos")]
fn collect() -> Result<Vec<ListeningPort>, AppError> {
    let text = output_of("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"])
        .ok_or_else(|| err!("error.portScanFailed", tool = "lsof"))?;
    Ok(ports::parse_lsof(&text))
}
