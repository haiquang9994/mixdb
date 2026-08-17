//! The dump and restore tools: what MixDB can find, download and be pointed at.
//!
//! Commands of this module rather than of the app: a suite is one engine's pair of
//! programs (`mysqldump` and `mysql`, `pg_dump` and `psql`, `mongodump` and
//! `mongorestore`), and nothing outside the database module has a use for them.

use crate::error::AppError;
use tauri::{AppHandle, Emitter};
use crate::modules::db::drivers::tools;
use super::{in_background, tools_dir, TOOLS_PROGRESS_EVENT};

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
