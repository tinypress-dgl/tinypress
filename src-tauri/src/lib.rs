mod commands;
mod engine;
mod presets;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(std::sync::Arc::new(engine::queue::JobStore::default()))
        .manage(commands::WatchState::default())
        // 原生层监听拖放事件（不依赖前端 onDragDropEvent API，与进度事件同机制转发）
        .on_webview_event(|webview, event| {
            use tauri::DragDropEvent;
            if let tauri::WebviewEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let paths: Vec<String> = paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                let _ = webview.emit("native-files-dropped", paths);
            }
        })
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
            commands::pick_output_dir,
            commands::pick_input_files,
            commands::resolve_input_paths,
            commands::file_to_data_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
