// First, and with `macro_use`: the `err!` macro it defines is used by every module below it.
#[macro_use]
mod error;

mod commands;
mod db;
mod models;
mod secrets;
mod ssh;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init());

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

    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect_db,
            commands::disconnect_db,
            commands::test_ssh_tunnel,
            commands::mysql_query,
            commands::mysql_list_databases,
            commands::mysql_server_info,
            commands::mysql_list_tables,
            commands::mysql_table_stats,
            commands::mysql_table_data,
            commands::mysql_update_row,
            commands::mysql_insert_rows,
            commands::mysql_delete_rows,
            commands::mysql_table_structure,
            commands::mysql_schema_outline,
            commands::mysql_collations,
            commands::tools_status,
            commands::tools_ready,
            commands::tools_downloadable,
            commands::tools_install,
            commands::tools_uninstall,
            commands::tools_set_path,
            commands::mysql_dump,
            commands::mysql_restore,
            commands::mysql_drop_database,
            commands::mysql_create_database,
            commands::mysql_create_table,
            commands::mysql_rename_table,
            commands::mysql_drop_table,
            commands::mysql_add_column,
            commands::mysql_modify_column,
            commands::mysql_drop_column,
            commands::mysql_add_index,
            commands::mysql_modify_index,
            commands::mysql_drop_index,
            commands::mysql_run_script,
            commands::mysql_cancel_query,
            commands::mysql_validate_sql,
            commands::postgres_query,
            commands::postgres_list_databases,
            commands::postgres_server_info,
            commands::postgres_list_tables,
            commands::postgres_table_stats,
            commands::postgres_table_data,
            commands::postgres_update_row,
            commands::postgres_insert_rows,
            commands::postgres_delete_rows,
            commands::postgres_table_structure,
            commands::postgres_collations,
            commands::postgres_schema_outline,
            commands::postgres_run_script,
            commands::postgres_validate_sql,
            commands::postgres_cancel_query,
            commands::postgres_create_database,
            commands::postgres_drop_database,
            commands::postgres_create_table,
            commands::postgres_rename_table,
            commands::postgres_drop_table,
            commands::postgres_add_column,
            commands::postgres_modify_column,
            commands::postgres_drop_column,
            commands::postgres_add_index,
            commands::postgres_modify_index,
            commands::postgres_drop_index,
            commands::postgres_dump,
            commands::postgres_restore,
            secrets::secrets_save,
            secrets::secrets_load,
            secrets::secrets_delete,
            commands::mongo_list_databases,
            commands::mongo_server_info,
            commands::mongo_list_collections,
            commands::mongo_collection_stats,
            commands::mongo_dump,
            commands::mongo_restore,
            commands::mongo_drop_database,
            commands::mongo_create_collection,
            commands::mongo_rename_collection,
            commands::mongo_drop_collection,
            commands::mongo_find,
            commands::mongo_collection_page,
            commands::mongo_next_ids,
            commands::mongo_insert_documents,
            commands::mongo_update_document,
            commands::mongo_delete_document,
            commands::redis_command,
            commands::redis_server_info,
            commands::redis_list_databases,
            commands::redis_select_db,
            commands::redis_scan_keys,
            commands::redis_key_value,
            commands::redis_delete_keys,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
