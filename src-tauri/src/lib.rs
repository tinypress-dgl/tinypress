mod commands;
mod engine;
mod presets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(std::sync::Arc::new(engine::queue::JobStore::default()))
        .manage(commands::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_presets,
            commands::save_custom_preset,
            commands::delete_custom_preset,
            commands::get_engine_info,
            commands::compress_files,
            commands::reveal_in_folder,
            commands::start_watch,
            commands::stop_watch,
            commands::get_watch_status,
            commands::get_settings,
            commands::save_settings,
            commands::get_app_version,
            commands::check_update,
            commands::pick_output_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
