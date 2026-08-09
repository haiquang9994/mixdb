mod commands;
mod db;
mod models;
mod ssh_tunnel;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect_db,
            commands::disconnect_db,
            commands::test_ssh_tunnel,
            commands::mysql_query,
            commands::mysql_list_databases,
            commands::mysql_server_info,
            commands::mysql_list_tables,
            commands::mysql_table_data,
            commands::mysql_update_row,
            commands::mysql_insert_rows,
            commands::mysql_delete_rows,
            commands::mysql_table_structure,
            commands::mysql_add_column,
            commands::mysql_modify_column,
            commands::mysql_drop_column,
            commands::mysql_add_index,
            commands::mysql_modify_index,
            commands::mysql_drop_index,
            commands::mysql_run_script,
            commands::mongo_list_databases,
            commands::mongo_server_info,
            commands::mongo_list_collections,
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
