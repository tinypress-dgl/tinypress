pub mod image;
pub mod queue;
pub mod video;
pub mod watch;

use std::path::{Path, PathBuf};

use crate::presets::Preset;

use self::queue::JobState;

#[derive(Debug)]
pub struct Output {
    pub output_path: PathBuf,
    pub output_size: u64,
}

/// 命名模板占位符：
/// - `{name}`  原文件名（不含扩展名）
/// - `{kind}`  任务类型（video / image）
/// - `{ext}`   目标格式扩展名（如 mp4 / jpg / webp）
/// 默认模板等价于 `{name}.{kind}`（即原行为 `原名.video.mp4`）。
/// 模板中的非法字符与路径分隔符会被清洗，防路径穿越。
pub fn apply_rename_template(template: &str, name: &str, kind: &str, ext: &str) -> String {
    let rendered = template
        .replace("{name}", name)
        .replace("{kind}", kind)
        .replace("{ext}", ext);
    // 清洗：去掉路径分隔符、相对路径片段与 Windows 非法字符
    let cleaned: String = rendered
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        format!("{name}.{kind}")
    } else {
        cleaned
    }
}

/// 输出路径解析：目录取 output_dir（缺省为输入同目录），文件名按模板渲染。
/// 目标扩展名 ext 始终由预设决定（如 mp4/jpg/webp），模板中的 `{ext}` 只是占位。
pub fn resolve_output_path(
    input: &Path,
    kind: &str,
    ext: &str,
    output_dir: Option<&Path>,
    rename_template: Option<&str>,
) -> PathBuf {
    let dir = output_dir
        .filter(|d| !d.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| input.parent().map(Path::to_path_buf).unwrap_or_default());
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let name = rename_template
        .map(|t| apply_rename_template(t, stem, kind, ext))
        .unwrap_or_else(|| format!("{stem}.{kind}"));
    dir.join(format!("{name}.{ext}"))
}

/// 执行单个压缩任务（命令与文件夹监控共用）。
/// 内部完成：kind/ext 推导 → 输出路径解析 → 置 running → 调用视频/图片引擎 → 标记 done/error。
/// 返回最终 JobState（不写全局 store，由调用方负责入队、进度事件与收尾写入）。
/// cancel 置位后任务中断（返回 cancelled 语义由调用方处理）。
pub async fn run_compression(
    mut job: JobState,
    preset: &Preset,
    output_dir: Option<&Path>,
    rename: Option<&str>,
    edit: Option<&video::EditOptions>,
    cancel: &std::sync::atomic::AtomicBool,
    mut on_progress: impl FnMut(u8),
) -> JobState {
    job.status = "running".into();
    job.progress = 5;
    on_progress(5);

    let input = PathBuf::from(&job.input_path);
    let (kind, ext) = match preset.kind.as_str() {
        "video" => ("video", "mp4"),
        "image" => {
            let ext = preset
                .image
                .as_ref()
                .map(|i| match i.format.as_str() {
                    "png" => "png",
                    "webp" => "webp",
                    "avif" => "avif",
                    _ => "jpg",
                })
                .unwrap_or("jpg");
            ("image", ext)
        }
        other => {
            job.status = "error".into();
            job.error = Some(format!("未知预设类型: {other}"));
            return job;
        }
    };

    let output = resolve_output_path(&input, kind, ext, output_dir, rename);
    let max_bitrate_kbps = preset
        .constraints
        .as_ref()
        .and_then(|c| c.get("max_bitrate_kbps"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let max_size_kb = preset
        .constraints
        .as_ref()
        .and_then(|c| c.get("max_size_kb"))
        .and_then(|v| v.as_u64());
    let result = match preset.kind.as_str() {
        "video" => match preset.video.clone() {
            Some(params) => {
                if let Some(kb) = max_size_kb {
                    // 目标大小压缩（朋友圈 ≤25MB 等）：二分逼近，兑现预设语义
                    video::compress_to_size(
                        &input,
                        &output,
                        &params,
                        preset.filters.as_ref(),
                        max_bitrate_kbps,
                        kb,
                        edit,
                        cancel,
                        &mut on_progress,
                    )
                    .await
                } else {
                    video::compress(
                        &input,
                        &output,
                        &params,
                        preset.filters.as_ref(),
                        max_bitrate_kbps,
                        edit,
                        cancel,
                        &mut on_progress,
                    )
                    .await
                }
            }
            None => Err("预设缺少视频参数".to_string()),
        },
        "image" => match preset.image.clone() {
            Some(params) => {
                image::compress(&input, &output, &params, &mut on_progress).await
            }
            None => Err("预设缺少图片参数".to_string()),
        },
        _ => unreachable!(),
    };

    match result {
        Ok(out) => {
            job.status = "done".into();
            job.progress = 100;
            job.output_size = Some(out.output_size);
            job.output_path = Some(out.output_path.to_string_lossy().into_owned());
            // 治理「压缩后变大」：输出未小于源 → 非致命提示（用户感知「没达到预期」的主因之一）
            if job.input_size > 0 && out.output_size >= job.input_size {
                let ratio = ((out.output_size as f64 / job.input_size as f64) * 100.0).round() as u64;
                job.warning = Some(format!(
                    "输出为源的 {ratio}%（未变小），源文件可能已是最优压缩；建议改用带体积上限的预设（如「微信朋友圈 ≤25MB」）"
                ));
            }
        }
        Err(e) => {
            job.status = "error".into();
            job.error = Some(e);
        }
    }
    job
}

/// 外部二进制定位器：优先 exe 旁 bins/ 目录，其次 exe 同目录，最后 PATH。
/// 二进制随包分发（FFmpeg 以子进程方式调用，不链接其代码）。
pub struct BinaryLocator;

fn bin_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

impl BinaryLocator {
    pub fn find(&self, name: &str) -> Option<PathBuf> {
        // 与 tauri.conf.json 的 productName 保持一致（Linux deb 资源目录名）
        const PRODUCT_DIR: &str = "TinyPress";
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for cand in [
                    dir.join("bins").join(bin_name(name)),                    // 开发态/Windows 安装态
                    dir.join(bin_name(name)),                                 // 同目录
                    Path::new("/usr/lib").join(PRODUCT_DIR).join("bins").join(bin_name(name)), // Linux deb
                ] {
                    if cand.is_file() {
                        return Some(cand);
                    }
                }
                if let Some(parent) = dir.parent() {
                    let mac = parent.join("Resources").join("bins").join(bin_name(name));
                    if mac.is_file() {
                        return Some(mac);
                    }
                }
            }
        }
        if let Some(path_env) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path_env) {
                let cand = dir.join(bin_name(name));
                if cand.is_file() {
                    return Some(cand);
                }
            }
        }
        // macOS Homebrew：GUI 应用从 Finder 启动时 PATH 不含 brew 目录，
        // 需按固定路径兜底探测（Apple Silicon /opt/homebrew，Intel /usr/local）
        for dir in [
            Path::new("/opt/homebrew/bin"),
            Path::new("/usr/local/bin"),
        ] {
            let cand = dir.join(bin_name(name));
            if cand.is_file() {
                return Some(cand);
            }
        }
        None
    }

    pub fn check(&self, name: &str) -> bool {
        self.find(name).is_some()
    }

    /// 运行 `bin -version` 取首行（用于引擎状态展示；失败返回 None）
    pub fn version(&self, name: &str) -> Option<String> {
        let bin = self.find(name)?;
        let out = std::process::Command::new(bin)
            .arg("-version")
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        text.lines().next().map(|s| s.to_string())
    }

    /// 运行 `bin -encoders` 返回全部输出（用于检测硬件编码器；失败返回 None）
    pub fn encoders(&self) -> Option<String> {
        let bin = self.find("ffmpeg")?;
        let out = std::process::Command::new(bin)
            .arg("-encoders")
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&out.stdout).into_owned())
    }
}

/// 硬件加速类型（真实 GPU 探测用）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuKind {
    Nvenc,
    Qsv,
    Videotoolbox,
}

impl GpuKind {
    /// ffmpeg 编码器名（与 -encoders 输出比对用）
    fn encoder_names(&self) -> &'static [&'static str] {
        match self {
            GpuKind::Nvenc => &["h264_nvenc", "hevc_nvenc"],
            GpuKind::Qsv => &["h264_qsv", "hevc_qsv"],
            GpuKind::Videotoolbox => &["h264_videotoolbox", "hevc_videotoolbox"],
        }
    }
}

impl BinaryLocator {
    /// 真实 GPU 探测：替代旧版「ffmpeg -encoders 字符串匹配」——
    /// 旧逻辑只看 ffmpeg 是否编译进编码器，沙箱无 GPU 也会误报「NVENC 可用」。
    /// - NVENC：探测 nvidia-smi 可执行（Windows 标准安装路径 + PATH；Linux PATH）
    /// - QSV：用 ffmpeg 试探初始化 qsv 设备（Intel 核显 + VAAPI 驱动）
    /// - VideoToolbox：macOS 全机型内置（含 Intel Mac），按平台判定
    pub fn gpu_available(&self, kind: GpuKind) -> bool {
        // 前置：对应编码器必须存在于 ffmpeg 构建
        let enc = self.encoders().unwrap_or_default();
        let builtin = kind
            .encoder_names()
            .iter()
            .any(|n| enc.contains(n));
        if !builtin {
            return false;
        }
        match kind {
            GpuKind::Videotoolbox => cfg!(target_os = "macos"),
            GpuKind::Nvenc => Self::nvidia_smi_exists(),
            GpuKind::Qsv => Self::qsv_device_ok(),
        }
    }

    fn nvidia_smi_exists() -> bool {
        let candidates = [
            // Windows 标准安装路径
            "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
            "C:\\Windows\\System32\\nvidia-smi.exe",
        ];
        for c in candidates {
            if std::path::Path::new(c).is_file() {
                return true;
            }
        }
        // PATH 探测（Linux / 已加入 PATH 的 Windows）
        if let Some(path_env) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path_env) {
                let cand = dir.join(bin_name("nvidia-smi"));
                if cand.is_file() {
                    return true;
                }
            }
        }
        false
    }

    fn qsv_device_ok() -> bool {
        let Some(ffmpeg) = BinaryLocator.find("ffmpeg") else {
            return false;
        };
        // 试探初始化 QSV 设备；失败（无 Intel 核显/无驱动）返回 false
        std::process::Command::new(ffmpeg)
            .args(["-init_hw_device", "qsv", "-f", "null", "-"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
