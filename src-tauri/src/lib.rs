mod app_menu;
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
        .plugin(tauri_plugin_notification::init())
        // 单实例：重复启动时聚焦已有窗口（防并发写同一队列文件）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.unminimize();
                let _ = w.set_focus();
            });
        }))
        // 窗口状态记忆：退出时记住位置/大小，下次启动恢复
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(std::sync::Arc::new(engine::queue::JobStore::default()))
        .manage(commands::WatchState::default())
        .manage(commands::CancelStore::default())
        // 并发上限：默认最多 2 个压缩任务并行（避免 N 个 ffmpeg 同时抢占 CPU/IO）
        .manage(std::sync::Arc::new(tokio::sync::Semaphore::new(2)))
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
        .setup(move |app| {
            // 崩溃与应用日志：写入 app_log_dir/tinypress.log，商用可诊断
            if let Ok(log_dir) = app.path().app_log_dir() {
                let _ = std::fs::create_dir_all(&log_dir);
                let log_path = log_dir.join("tinypress.log");
                let panic_log = log_path.clone();
                std::panic::set_hook(Box::new(move |info| {
                    use std::io::Write;
                    let line = format!(
                        "[{}] PANIC: {}\n",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                        info
                    );
                    if let Ok(mut f) = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&panic_log)
                    {
                        let _ = f.write_all(line.as_bytes());
                    }
                }));
                use std::io::Write;
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    let _ = writeln!(
                        f,
                        "[{}] TinyPress v{} started",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                        env!("CARGO_PKG_VERSION")
                    );
                }
            }
            // 恢复上次会话的任务队列（未完成任务置 queued，等待用户重新开始）
            let store = app.state::<std::sync::Arc<engine::queue::JobStore>>();
            commands::load_jobs(app.handle(), store.inner());
            #[cfg(dev)]
            let url = WebviewUrl::App(std::path::PathBuf::from("/"));
            #[cfg(not(dev))]
            let url = {
                let url = tauri::Url::parse(&format!("http://localhost:{}", port))
                    .expect("invalid localhost url");
                WebviewUrl::External(url)
            };
            // 系统菜单：语言与界面语言一致（读持久化 langPref；zh/en/system）
            // 必须在创建主窗口前设置，macOS 系统菜单栏语言立即生效
            app_menu::setup_menu(app)?;

            WebviewWindowBuilder::new(app, "main", url)
                .title("TinyPress 速压")
                .inner_size(1200.0, 800.0)
                .min_inner_size(900.0, 680.0)
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
            commands::cancel_job,
            commands::retry_job,
            commands::get_queue,
            commands::reveal_in_folder,
            commands::start_watch,
            commands::stop_watch,
            commands::get_watch_status,
            commands::get_settings,
            commands::save_settings,
            app_menu::set_menu_language,
            commands::get_app_version,
            commands::check_update,
            commands::pick_output_dir,
            commands::pick_input_files,
            commands::pick_watermark_image,
            commands::pick_subtitle_file,
            commands::resolve_input_paths,
            commands::file_to_data_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
