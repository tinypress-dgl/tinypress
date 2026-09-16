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
