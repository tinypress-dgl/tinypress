use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::engine::queue::{JobState, JobStore};
use crate::engine::watch::{self, WatchEvents, WatchHandle, WatchOptions};
use crate::engine::BinaryLocator;
use crate::presets::{self, Preset};

/// 自定义预设文件位置：应用配置目录下 custom-presets.json
fn custom_presets_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {e}"))?;
    Ok(dir.join("custom-presets.json"))
}

/// 应用设置（输出目录/命名模板/监控配置），存应用配置目录 settings.json
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub output_dir: Option<String>,
    pub rename_template: Option<String>,
    pub watch_dir: Option<String>,
    pub watch_preset: Option<String>,
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {e}"))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let file = settings_file(&app)?;
    if !file.exists() {
        return Ok(AppSettings::default());
    }
    let s = std::fs::read_to_string(&file).map_err(|e| format!("读取设置失败: {e}"))?;
    serde_json::from_str(&s).map_err(|e| format!("解析设置失败: {e}"))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let file = settings_file(&app)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let s = serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化设置失败: {e}"))?;
    std::fs::write(&file, s).map_err(|e| format!("写入设置失败: {e}"))
}

#[tauri::command]
pub fn list_presets(app: AppHandle) -> Result<Vec<Preset>, String> {
    let builtin = presets::load();
    let file = custom_presets_file(&app)?;
    Ok(presets::merge_with_custom(builtin, presets::load_custom(&file)))
}

/// 保存/更新一个自定义预设（按 id 覆盖；id 以 custom- 前缀由前端生成）
#[tauri::command]
pub fn save_custom_preset(app: AppHandle, preset: Preset) -> Result<(), String> {
    let file = custom_presets_file(&app)?;
    let mut all = presets::load_custom(&file);
    if let Some(slot) = all.iter_mut().find(|p| p.id == preset.id) {
        *slot = preset.clone();
    } else {
        all.push(preset);
    }
    presets::save_custom(&file, &all)
}

/// 删除自定义预设（内置预设 id 会被忽略，不会删除内嵌项）
#[tauri::command]
pub fn delete_custom_preset(app: AppHandle, id: String) -> Result<(), String> {
    let file = custom_presets_file(&app)?;
    let all = presets::load_custom(&file);
    let filtered: Vec<Preset> = all.into_iter().filter(|p| p.id != id).collect();
    presets::save_custom(&file, &filtered)
}

/// 生成任务 ID：时间戳 + 随机后缀，足够骨架阶段唯一
fn job_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    format!("job_{ts:x}_{pid:x}")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressRequest {
    pub items: Vec<CompressItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressItem {
    pub input_path: String,
    pub preset_id: String,
    /// 输出目录（缺省 = 输入文件同目录）
    #[serde(default)]
    pub output_dir: Option<String>,
    /// 命名模板（缺省 = `{name}.{kind}`，即 `原名.video.mp4`）
    #[serde(default)]
    pub rename: Option<String>,
    /// 基础编辑选项（截取/旋转/去黑边/裁剪），可空
    #[serde(default)]
    pub edit: Option<crate::engine::video::EditOptions>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub nvenc: bool,
    pub qsv: bool,
    pub videotoolbox: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub ffmpeg_ok: bool,
    pub ffmpeg_version: Option<String>,
    pub engines: HashMap<String, bool>,
    pub hardware: HardwareInfo,
}

#[tauri::command]
pub fn get_engine_info() -> EngineInfo {
    let locator = BinaryLocator;
    let ffmpeg_ok = locator.check("ffmpeg");
    let engines = [
        ("mozjpeg", locator.check("cjpeg")),
        ("pngquant", locator.check("pngquant")),
        ("libwebp", locator.check("cwebp")),
        ("libavif", locator.check("avifenc")),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    let encoders = locator.encoders().unwrap_or_default();
    let hardware = HardwareInfo {
        nvenc: encoders.contains("h264_nvenc") || encoders.contains("hevc_nvenc"),
        qsv: encoders.contains("h264_qsv") || encoders.contains("hevc_qsv"),
        videotoolbox: encoders.contains("h264_videotoolbox")
            || encoders.contains("hevc_videotoolbox"),
    };
    EngineInfo {
        ffmpeg_ok,
        ffmpeg_version: locator.version("ffmpeg"),
        engines,
        hardware,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    job_id: String,
    progress: u8,
}

/// 应用当前版本（来自 Cargo.toml，发布时随 tag 提升）
#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    /// 配置的更新/下载页（空 = 未配置更新源）
    pub update_url: Option<String>,
}

/// 检查更新源配置：读取 `app_config_dir/update-config.json` 的 `{ "update_url": "..." }`。
/// 未配置时返回 None，前端仅显示当前版本。
#[tauri::command]
pub fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let file = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {e}"))?
        .join("update-config.json");
    if !file.exists() {
        return Ok(UpdateInfo {
            current,
            update_url: None,
        });
    }
    let s = std::fs::read_to_string(&file).map_err(|e| format!("读取更新配置失败: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&s).map_err(|e| format!("解析更新配置失败: {e}"))?;
    let update_url = v.get("update_url").and_then(|u| u.as_str()).map(String::from);
    Ok(UpdateInfo { current, update_url })
}

/// 提交压缩任务：为每个文件启动独立后台任务，通过事件回报进度/结果
#[tauri::command]
pub fn compress_files(
    app: AppHandle,
    state: State<'_, Arc<JobStore>>,
    request: CompressRequest,
) -> Result<Vec<JobState>, String> {
    let presets: HashMap<String, Preset> = presets::load()
        .into_iter()
        .map(|p| (p.id.clone(), p))
        .collect();

    let mut snapshots = Vec::with_capacity(request.items.len());
    for item in request.items {
        let preset = presets
            .get(&item.preset_id)
            .cloned()
            .ok_or_else(|| format!("预设不存在: {}", item.preset_id))?;
        let id = job_id();
        let input_size = std::fs::metadata(&item.input_path)
            .map(|m| m.len())
            .unwrap_or(0);
        let job = JobState::new(id.clone(), item.input_path.clone(), item.preset_id, input_size);
        state.0.lock().unwrap().push(job.clone());
        snapshots.push(job.clone());

        let app2 = app.clone();
        let store = state.inner().clone();
        let out_dir = item.output_dir.clone().map(PathBuf::from);
        let rename = item.rename.clone();
        let edit = item.edit.clone();
        tokio::spawn(async move {
            run_job(app2, store, job, preset, out_dir, rename, edit).await;
        });
    }
    Ok(snapshots)
}

async fn run_job(
    app: AppHandle,
    store: Arc<JobStore>,
    mut job: JobState,
    preset: Preset,
    out_dir: Option<PathBuf>,
    rename: Option<String>,
    edit: Option<crate::engine::video::EditOptions>,
) {
    {
        let mut guard = store.0.lock().unwrap();
        if let Some(j) = guard.iter_mut().find(|j| j.id == job.id) {
            j.status = "running".into();
            j.progress = 5;
        }
    }
    let _ = app.emit(
        "compress_progress",
        ProgressEvent {
            job_id: job.id.clone(),
            progress: 5,
        },
    );

    let job_id = job.id.clone();
    let on_progress_app = app.clone();
    let on_progress_store = Arc::clone(&store);
    let on_progress = move |p: u8| {
        if let Ok(mut guard) = on_progress_store.0.lock() {
            if let Some(j) = guard.iter_mut().find(|j| j.id == job_id) {
                j.progress = p;
            }
        }
        let _ = on_progress_app.emit(
            "compress_progress",
            ProgressEvent {
                job_id: job_id.clone(),
                progress: p,
            },
        );
    };

    job = crate::engine::run_compression(
        job,
        &preset,
        out_dir.as_deref(),
        rename.as_deref(),
        edit.as_ref(),
        on_progress,
    )
    .await;
    finish_job(&app, &store, job);
}

fn finish_job(app: &AppHandle, store: &Arc<JobStore>, job: JobState) {
    if let Ok(mut guard) = store.0.lock() {
        if let Some(j) = guard.iter_mut().find(|j| j.id == job.id) {
            *j = job.clone();
        }
    }
    let _ = app.emit("compress_done", job);
}

/// 在文件管理器中显示文件（P1 完整实现；骨架直接返回成功）
#[tauri::command]
pub fn reveal_in_folder(_path: String) -> Result<(), String> {
    Ok(())
}

// ===== 文件夹监控（P1：轮询式，无第三方依赖） =====

/// 全局监控句柄：Some = 运行中
#[derive(Default)]
pub struct WatchState(pub Mutex<Option<WatchHandle>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchRequest {
    pub dir: String,
    pub preset_id: String,
    pub output_dir: Option<String>,
    pub rename: Option<String>,
}

/// 启动文件夹监控：先停旧监控，校验目录与预设后拉起常驻轮询任务
#[tauri::command]
pub fn start_watch(
    app: AppHandle,
    state: State<'_, Arc<JobStore>>,
    watch_state: State<'_, WatchState>,
    request: WatchRequest,
) -> Result<(), String> {
    if let Some(h) = watch_state.0.lock().unwrap().take() {
        h.stop();
    }
    let dir = PathBuf::from(&request.dir);
    if !dir.is_dir() {
        return Err(format!("监控目录不存在: {}", request.dir));
    }
    let presets: HashMap<String, Preset> = presets::load()
        .into_iter()
        .map(|p| (p.id.clone(), p))
        .collect();
    if !presets.contains_key(&request.preset_id) {
        return Err(format!("预设不存在: {}", request.preset_id));
    }

    let opts = WatchOptions {
        preset_id: request.preset_id,
        output_dir: request.output_dir,
        rename: request.rename,
    };
    let stop = Arc::new(AtomicBool::new(false));
    let seen = Arc::new(tokio::sync::Mutex::new(HashSet::new()));
    watch_state.0.lock().unwrap().replace(WatchHandle {
        stop: stop.clone(),
        seen: seen.clone(),
    });

    let store = state.inner().clone();
    let app_progress = app.clone();
    let events = WatchEvents {
        on_progress: Box::new(move |id: &str, p: u8| {
            let _ = app_progress.emit(
                "compress_progress",
                ProgressEvent {
                    job_id: id.to_string(),
                    progress: p,
                },
            );
        }),
        on_done: Box::new(move |job: JobState| {
            let _ = app.emit("compress_done", job);
        }),
    };
    tokio::spawn(async move {
        watch::start_watch_loop(dir, opts, presets, store, events, stop, seen).await;
    });
    Ok(())
}

/// 停止文件夹监控（已有任务继续跑完，只是不再接收新文件）
#[tauri::command]
pub fn stop_watch(watch_state: State<'_, WatchState>) -> Result<(), String> {
    if let Some(h) = watch_state.0.lock().unwrap().take() {
        h.stop();
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    pub running: bool,
}

#[tauri::command]
pub fn get_watch_status(watch_state: State<'_, WatchState>) -> WatchStatus {
    WatchStatus {
        running: watch_state.0.lock().unwrap().is_some(),
    }
}

/// 原生文件夹选择对话框（Windows/macOS/Linux 均原生）
/// 同步 command：Tauri v2 在主线程执行，兼容 macOS NSApplication 主线程要求
#[tauri::command]
pub fn pick_output_dir() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择输出目录")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

/// 原生多选文件对话框（图片/视频）
#[tauri::command]
pub fn pick_input_files() -> Option<Vec<String>> {
    rfd::FileDialog::new()
        .set_title("选择要压缩的图片或视频")
        .add_filter(
            "图片/视频",
            &[
                "jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "mp4", "mov", "mkv",
                "avi", "webm", "flv", "ts", "m4v", "wmv",
            ],
        )
        .pick_files()
        .map(|files| {
            files
                .into_iter()
                .map(|f| f.to_string_lossy().to_string())
                .collect()
        })
}

/// 将用户输入的路径（文件或文件夹，多个可混排）解析为真实文件列表：
/// 文件直接收录（不校验扩展名，交给压缩阶段判断）；文件夹递归收集媒体文件（跳过隐藏目录）
#[tauri::command]
pub fn resolve_input_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for p in paths {
        let pb = PathBuf::from(p.trim());
        if pb.as_os_str().is_empty() {
            continue;
        }
        if pb.is_file() {
            out.push(pb.to_string_lossy().to_string());
        } else if pb.is_dir() {
            collect_media_files(&pb, &mut out)?;
        }
    }
    Ok(out)
}

const IMG_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"];
const VID_EXTS: &[&str] = &[
    "mp4", "mov", "mkv", "avi", "webm", "flv", "ts", "m4v", "wmv",
];

fn is_media_file(p: &std::path::Path) -> bool {
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) => {
            let e = e.to_lowercase();
            IMG_EXTS.contains(&e.as_str()) || VID_EXTS.contains(&e.as_str())
        }
        None => false,
    }
}

fn collect_media_files(dir: &PathBuf, out: &mut Vec<String>) -> Result<(), String> {
    let mut stack = vec![dir.clone()];
    let mut guard: usize = 0;
    while let Some(d) = stack.pop() {
        guard += 1;
        if guard > 10_000 {
            return Err("文件夹层级过深或文件过多，已中止展开".into());
        }
        let rd = std::fs::read_dir(&d).map_err(|e| format!("读取目录失败 {:?}: {}", d, e))?;
        for ent in rd.flatten() {
            let path = ent.path();
            if path.is_dir() {
                // 跳过隐藏目录（. 开头）
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.') {
                        continue;
                    }
                }
                stack.push(path);
            } else if is_media_file(&path) {
                out.push(path.to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}

/// 读取本地文件为 data URL（用于图片预览）。
/// 走 IPC 而非 asset:// 协议：规避 macOS WebKit URL scheme handler 在内存压力下的崩溃。
/// 限制单文件 30MB，避免超大文件撑爆内存。
#[tauri::command]
pub fn file_to_data_url(path: String) -> Result<String, String> {
    use std::io::Read;

    const MAX_BYTES: u64 = 30 * 1024 * 1024;

    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("文件不存在: {path}"));
    }
    let meta = std::fs::metadata(&p).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if meta.len() > MAX_BYTES {
        return Err("文件超过 30MB，不支持预览".to_string());
    }
    let mut buf = Vec::with_capacity(meta.len() as usize);
    std::fs::File::open(&p)
        .and_then(|mut f| f.read_to_end(&mut buf))
        .map_err(|e| format!("读取文件失败: {e}"))?;

    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf)
    ))
}
