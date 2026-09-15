//! 文件夹监控：轻量轮询实现（无第三方依赖）。
//! 每 `WATCH_INTERVAL_SECS` 秒扫描一次目录，发现扩展名匹配的新文件后，
//! 自动按指定预设入队压缩。已存在的文件启动时预置为"已处理"，只处理新增。
//!
//! 本模块不依赖 tauri 类型，可在独立 tokio 运行时中测试。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex as AsyncMutex;
use tokio::time::sleep;

use crate::engine::queue::{JobState, JobStore};
use crate::engine::run_compression;
use crate::presets::Preset;

/// 轮询间隔（秒）
pub const WATCH_INTERVAL_SECS: u64 = 2;

/// 默认监控的媒体扩展名（小写）
pub fn default_extensions() -> Vec<String> {
    ["mp4", "mov", "mkv", "avi", "png", "jpg", "jpeg", "webp"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// 监控任务选项（对应前端设置）
#[derive(Debug, Clone)]
pub struct WatchOptions {
    pub preset_id: String,
    pub output_dir: Option<String>,
    pub rename: Option<String>,
}

/// 运行中的监控状态：停止标记 + 已处理文件集合（去重）
pub struct WatchHandle {
    pub stop: Arc<AtomicBool>,
    pub seen: Arc<AsyncMutex<HashSet<PathBuf>>>,
}

impl WatchHandle {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// 监控循环的事件回调（由命令层包装为 tauri emit）
pub struct WatchEvents {
    pub on_progress: Box<dyn Fn(&str, u8) + Send + Sync>,
    pub on_done: Box<dyn Fn(JobState) + Send + Sync>,
}

/// 启动监控循环（常驻任务）。`presets` 中缺失 preset_id 时静默停止。
#[allow(clippy::too_many_arguments)]
pub async fn start_watch_loop(
    dir: PathBuf,
    opts: WatchOptions,
    presets: HashMap<String, Preset>,
    store: Arc<JobStore>,
    events: WatchEvents,
    stop: Arc<AtomicBool>,
    seen: Arc<AsyncMutex<HashSet<PathBuf>>>,
) {
    // 预置：启动时已存在的媒体文件不处理（只处理启动后新增）
    let exts = default_extensions();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            if let Ok(p) = e.path().canonicalize() {
                if is_media(&p, &exts) {
                    seen.lock().await.insert(p);
                }
            }
        }
    }

    let preset = match presets.get(&opts.preset_id) {
        Some(p) => p.clone(),
        None => return,
    };

    while !stop.load(Ordering::Relaxed) {
        scan_once(&dir, &opts, &preset, &store, &events, &seen).await;
        sleep(Duration::from_secs(WATCH_INTERVAL_SECS)).await;
    }
}

/// 单轮扫描：处理所有新增媒体文件（串行压缩，避免同目录写冲突）
async fn scan_once(
    dir: &Path,
    opts: &WatchOptions,
    preset: &Preset,
    store: &Arc<JobStore>,
    events: &WatchEvents,
    seen: &Arc<AsyncMutex<HashSet<PathBuf>>>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return, // 目录不可读：本轮跳过
    };
    let exts = default_extensions();
    for e in entries.flatten() {
        let path = match e.path().canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !is_media(&path, &exts) {
            continue;
        }
        {
            let mut seen_guard = seen.lock().await;
            if seen_guard.contains(&path) {
                continue;
            }
            seen_guard.insert(path.clone());
        }

        let id = watch_job_id(&path);
        let input_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let job = JobState::new(
            id.clone(),
            path.to_string_lossy().into_owned(),
            preset.id.clone(),
            input_size,
        );
        store.0.lock().unwrap().push(job.clone());

        // 进度：更新 store + 通知前端
        let job_id = id.clone();
        let store2 = store.clone();
        let on_progress = move |p: u8| {
            if let Ok(mut g) = store2.0.lock() {
                if let Some(j) = g.iter_mut().find(|j| j.id == job_id) {
                    j.progress = p;
                }
            }
            (events.on_progress)(&job_id, p);
        };

        let out_dir = opts.output_dir.as_deref().map(PathBuf::from);
        let job = run_compression(
            job,
            preset,
            out_dir.as_deref(),
            opts.rename.as_deref(),
            None,
            on_progress,
        )
        .await;

        if let Ok(mut g) = store.0.lock() {
            if let Some(j) = g.iter_mut().find(|j| j.id == job.id) {
                *j = job.clone();
            }
        }
        (events.on_done)(job);
    }
}

fn is_media(path: &Path, exts: &[String]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| exts.iter().any(|x| x == &e.to_lowercase()))
        .unwrap_or(false)
}

/// 任务 ID：路径 hash + 时间戳，同一文件只入队一次
fn watch_job_id(path: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    let path_hash = h.finish();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("watch_{path_hash:x}_{ts:x}")
}
