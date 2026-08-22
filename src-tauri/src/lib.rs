// First, and with `macro_use`: the `err!` macro it defines is used by every module below it.
#[macro_use]
mod error;

mod modules;
mod secrets;
mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // Self-update: fetching the release, checking its minisign signature and running the installer
    // all happen here, in Rust, which is why the front end needs no network permission for it.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Only the maximized flag is persisted: leave the window maximized and it comes back
        // maximized, restore it down and the next launch uses the default size from the config.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::MAXIMIZED)
                .build(),
        );

    // Each module puts its own state in; the list of commands they add up to is
    // `modules::handler`.
    let builder = modules::db::register(builder);
    let builder = modules::rest::register(builder);
    let builder = modules::terminal::register(builder);

    builder
        .invoke_handler(modules::handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
