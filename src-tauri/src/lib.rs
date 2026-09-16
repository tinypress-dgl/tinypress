mod commands;
mod engine;
mod presets;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 随机选空闲端口：生产环境前端资源经 localhost HTTP 提供，
    // 绕开 macOS WKWebView URLSchemeHandler 在内存压力下 panic 崩溃的问题（macOS 26 Intel 实测复现）
    let port = portpicker::pick_unused_port().expect("failed to find unused port");
    tauri::Builder::default()
        .plugin(tauri_plugin_localhost::Builder::new(port).build())
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
        .setup(|app| {
            #[cfg(dev)]
            let url = WebviewUrl::App(std::path::PathBuf::from("/"));
            #[cfg(not(dev))]
            let url = {
                let url = tauri::Url::parse(&format!("http://localhost:{}", port))
                    .expect("invalid localhost url");
                WebviewUrl::External(url)
            };
            WebviewWindowBuilder::new(app, "main", url)
                .title("TinyPress 速压")
                .inner_size(1080.0, 720.0)
                .min_inner_size(800.0, 600.0)
                .center()
                .build()?;
            Ok(())
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
