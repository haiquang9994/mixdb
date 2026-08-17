//! Database: the module MixDB started as.
//!
//! Everything about reaching a server, browsing it and writing to it lives under here. The app
//! above knows only [`register`] and this module's block of the command list in
//! [`super::handler`] — no type declared in here reaches the shell.

pub mod commands;
pub mod drivers;
pub mod models;
pub mod state;

/// Puts this module's own state in the app. Called once, from `lib.rs`.
///
/// Tauri keys managed state by type, so a second module manages its own struct through a call of
/// its own here without ever meeting [`state::DbState`].
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(state::DbState::default())
}
