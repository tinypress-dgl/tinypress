use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::engine::queue::{JobParams, JobState, JobStore};
use crate::engine::watch::{self, WatchEvents, WatchHandle, WatchOptions};
use crate::engine::{BinaryLocator, GpuKind};
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
        // AVIF 现由随包 ffmpeg（libaom-av1）实现，不再依赖 avifenc（其与捆绑库 ABI 不匹配）
        ("libavif", ffmpeg_ok),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    // 硬件加速 = 「ffmpeg 构建含该编码器」 AND 「本机真实 GPU 可用」。
    // 旧版仅做字符串匹配，无 GPU 机器也会误报可用；现改为真实探测。
    let hardware = HardwareInfo {
        nvenc: locator.gpu_available(GpuKind::Nvenc),
        qsv: locator.gpu_available(GpuKind::Qsv),
        videotoolbox: locator.gpu_available(GpuKind::Videotoolbox),
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

/// 全局取消标志存储：job_id → 取消标志（running 任务置位后由引擎 kill ffmpeg）
#[derive(Default)]
pub struct CancelStore(pub Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

/// 队列持久化文件：应用配置目录下 jobs.json
fn jobs_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {e}"))?;
    Ok(dir.join("jobs.json"))
}

/// 把当前队列写入 jobs.json（done/error 保留为历史；queued/running 下次启动恢复为 queued）
pub fn persist_jobs(app: &AppHandle, store: &Arc<JobStore>) {
    let Ok(file) = jobs_file(app) else { return };
    let snap = store.0.lock().unwrap().clone();
    let text = serde_json::to_string(&snap).unwrap_or_default();
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, text);
}

/// 启动时恢复队列：running/queued → queued（等待用户重新开始）；done/error 保留展示
pub fn load_jobs(app: &AppHandle, store: &Arc<JobStore>) {
    let Ok(file) = jobs_file(app) else { return };
    let raw = match std::fs::read_to_string(&file) {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut jobs: Vec<JobState> = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    for j in jobs.iter_mut() {
        if j.status == "running" || j.status == "queued" {
            j.status = "queued".into();
            j.progress = 0;
            j.output_size = None;
            j.output_path = None;
        }
    }
    *store.0.lock().unwrap() = jobs;
}

/// 提交压缩任务：入队后由信号量控制并发（默认 2 个 ffmpeg 并行），
/// 失败可重试、重启可从 jobs.json 恢复（queued 任务重新开始）。
#[tauri::command]
pub fn compress_files(
    app: AppHandle,
    state: State<'_, Arc<JobStore>>,
    semaphore: State<'_, Arc<tokio::sync::Semaphore>>,
    cancels: State<'_, CancelStore>,
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
        let params = JobParams {
            preset_id: item.preset_id.clone(),
            output_dir: item.output_dir.clone(),
            rename: item.rename.clone(),
            edit: item.edit.clone(),
        };
        let job = JobState::new(
            id.clone(),
            item.input_path.clone(),
            item.preset_id,
            input_size,
            params,
        );
        state.0.lock().unwrap().push(job.clone());
        snapshots.push(job.clone());

        let cancel = Arc::new(AtomicBool::new(false));
        cancels.0.lock().unwrap().insert(id.clone(), cancel.clone());

        let app2 = app.clone();
        let store = state.inner().clone();
        let sem = semaphore.inner().clone();
        let cancels_inner = cancels.inner().0.clone();
        let out_dir = item.output_dir.clone().map(PathBuf::from);
        let rename = item.rename.clone();
        let edit = item.edit.clone();
        tokio::spawn(async move {
            // 并发上限：acquire 到许可才开始执行（队列中等待的任务保持 queued）
            let Ok(permit) = sem.acquire_owned().await else {
                return;
            };
            run_job(
                app2, store, job, preset, out_dir, rename, edit, cancel, permit, cancels_inner,
            )
            .await;
        });
    }
    persist_jobs(&app, &state.inner());
    Ok(snapshots)
}

#[allow(clippy::too_many_arguments)]
async fn run_job(
    app: AppHandle,
    store: Arc<JobStore>,
    mut job: JobState,
    preset: Preset,
    out_dir: Option<PathBuf>,
    rename: Option<String>,
    edit: Option<crate::engine::video::EditOptions>,
    cancel: Arc<AtomicBool>,
    permit: tokio::sync::OwnedSemaphorePermit,
    cancels: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
) {
    // 入队等待期间被取消：直接置 cancelled，不占用引擎
    if cancel.load(Ordering::Relaxed) {
        let mut cancelled_job = job.clone();
        cancelled_job.status = "cancelled".into();
        cancelled_job.progress = 0;
        {
            let mut guard = store.0.lock().unwrap();
            if let Some(j) = guard.iter_mut().find(|j| j.id == job.id) {
                *j = cancelled_job.clone();
            }
        }
        let _ = app.emit("compress_done", cancelled_job);
        persist_jobs(&app, &store);
        return;
    }
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
        &cancel,
        on_progress,
    )
    .await;
    // 用户取消 → 引擎返回「任务已取消」错误 → 归一为 cancelled 状态（非 error）
    if job.status == "error" && job.error.as_deref() == Some("任务已取消") {
        job.status = "cancelled".into();
        job.error = None;
    }
    let done_id = job.id.clone();
    finish_job(&app, &store, job);
    persist_jobs(&app, &store);
    cancels.lock().unwrap().remove(&done_id);
    drop(permit);
}

fn finish_job(app: &AppHandle, store: &Arc<JobStore>, job: JobState) {
    if let Ok(mut guard) = store.0.lock() {
        if let Some(j) = guard.iter_mut().find(|j| j.id == job.id) {
            *j = job.clone();
        }
    }
    let _ = app.emit("compress_done", job);
}

/// 取消任务：queued 直接置 cancelled；running 置位中断标志（引擎 kill ffmpeg）
#[tauri::command]
pub fn cancel_job(
    app: AppHandle,
    state: State<'_, Arc<JobStore>>,
    cancels: State<'_, CancelStore>,
    id: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    {
        let mut guard = store.0.lock().unwrap();
        if let Some(j) = guard.iter_mut().find(|j| j.id == id) {
            if j.status == "queued" {
                j.status = "cancelled".into();
                let snap = j.clone();
                drop(guard);
                let _ = app.emit("compress_done", snap);
                persist_jobs(&app, &store);
                return Ok(());
            }
        }
    }
    if let Some(flag) = cancels.0.lock().unwrap().get(&id).cloned() {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// 重试失败/已取消任务：按持久化参数原样重新入队（复用原 job id 保持队列位置）
#[tauri::command]
pub async fn retry_job(
    app: AppHandle,
    state: State<'_, Arc<JobStore>>,
    semaphore: State<'_, Arc<tokio::sync::Semaphore>>,
    cancels: State<'_, CancelStore>,
    id: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    let (job, preset, out_dir, rename, edit) = {
        let guard = store.0.lock().unwrap();
        let job = guard
            .iter()
            .find(|j| j.id == id)
            .cloned()
            .ok_or_else(|| "任务不存在".to_string())?;
        if job.status != "error" && job.status != "cancelled" {
            return Err("仅失败或已取消的任务可以重试".into());
        }
        let params = job
            .params
            .clone()
            .ok_or_else(|| "该任务缺少重跑参数".to_string())?;
        let preset = presets::load()
            .into_iter()
            .find(|p| p.id == params.preset_id)
            .ok_or_else(|| "预设不存在或已被删除".to_string())?;
        (job, preset, params.output_dir.map(PathBuf::from), params.rename, params.edit)
    };
    {
        let mut guard = store.0.lock().unwrap();
        if let Some(j) = guard.iter_mut().find(|j| j.id == id) {
            j.status = "queued".into();
            j.progress = 0;
            j.error = None;
            j.warning = None;
        }
    }
    let cancel = Arc::new(AtomicBool::new(false));
    cancels.0.lock().unwrap().insert(id.clone(), cancel.clone());
    let app2 = app.clone();
    let store2 = store.clone();
    let sem = semaphore.inner().clone();
    let cancels_inner = cancels.inner().0.clone();
    tokio::spawn(async move {
        let Ok(permit) = sem.acquire_owned().await else {
            return;
        };
        run_job(
            app2, store2, job, preset, out_dir, rename, edit, cancel, permit, cancels_inner,
        )
        .await;
    });
    persist_jobs(&app, &store);
    Ok(())
}

/// 读取当前队列（含历史 done/error；重启恢复的未完成任务为 queued）
#[tauri::command]
pub fn get_queue(state: State<'_, Arc<JobStore>>) -> Vec<JobState> {
    state.0.lock().unwrap().clone()
}

/// 在系统文件管理器中显示文件：
/// Windows 资源管理器定位选中；macOS Finder 定位；Linux 打开所在目录
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("打开 Finder 失败: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let dir = p
            .parent()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or_else(|| "/".to_string());
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {e}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
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
