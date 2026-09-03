// First, and with `macro_use`: the `err!` macro it defines is used by every module below it.
#[macro_use]
mod error;

mod launch;
mod modules;
mod platform;
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
        .setup(|app| {
            /* Housekeeping rather than startup work. A tool download that the app never came back
               from — a crash, a power cut, a force quit — leaves an unpacked server distribution
               in the tools directory, and this is the only thing that ever collects it. On a
               thread of its own and with its answer ignored: the window must not wait behind a
               directory walk and a delete of several hundred megabytes. */
            let handle = app.handle().clone();
            std::thread::spawn(move || modules::db::sweep_downloads(&handle));
            Ok(())
        })
        .invoke_handler(modules::handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
