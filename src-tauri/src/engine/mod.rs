pub mod edit;
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
    /// 源已满足目标大小、未重新编码（输出即源文件）
    pub skipped: bool,
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
/// v0.3.0 扩展：image_edit（图片批量编辑）、container（视频容器转换）、audio_only（音轨提取）。
pub async fn run_compression(
    mut job: JobState,
    preset: &Preset,
    output_dir: Option<&Path>,
    rename: Option<&str>,
    edit: Option<&video::EditOptions>,
    image_edit: Option<&edit::ImageEditOptions>,
    container: Option<&str>,
    audio_only: Option<&str>,
    cancel: &std::sync::atomic::AtomicBool,
    mut on_progress: impl FnMut(u8),
) -> JobState {
    job.status = "running".into();
    job.progress = 5;
    on_progress(5);

    let input = PathBuf::from(&job.input_path);
    // 视频容器白名单（不重编码优先；webm 走 VP9 回退）
    let container = container
        .map(|c| c.to_ascii_lowercase())
        .filter(|c| matches!(c.as_str(), "mp4" | "mkv" | "avi" | "webm" | "mov" | "flv" | "ts"))
        .unwrap_or_else(|| "mp4".to_string());
    let (kind, ext) = match preset.kind.as_str() {
        "video" => {
            let ext = match audio_only {
                Some("wav") => "wav",
                Some(_) => "mp3",
                None => container.as_str(),
            }
            .to_string();
            ("video", ext)
        }
        "image" => {
            let ext = if let Some(ie) = image_edit {
                // 图片编辑模式：输出格式跟随编辑参数（缺省保持源扩展名）
                edit::output_ext(&input, ie.format.as_deref())
            } else {
                preset
                    .image
                    .as_ref()
                    .map(|i| match i.format.as_str() {
                        "png" => "png",
                        "webp" => "webp",
                        "avif" => "avif",
                        _ => "jpg",
                    })
                    .unwrap_or("jpg")
                    .to_string()
            };
            ("image", ext)
        }
        other => {
            job.status = "error".into();
            job.error = Some(format!("未知预设类型: {other}"));
            return job;
        }
    };

    let output = resolve_output_path(&input, kind, &ext, output_dir, rename);
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
        "video" => {
            if let Some(a) = audio_only {
                // 音轨提取（mp3/wav）：不转码画面
                video::extract_audio(&input, &output, a, cancel).await
            } else if container != "mp4" {
                // 容器转换：优先 -c copy 不重编码，失败自动回退转码
                video::remux(&input, &output, &container).await
            } else {
                match preset.video.clone() {
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
                }
            }
        }
        "image" => {
            if let Some(ie) = image_edit {
                // 图片批量编辑模式（尺寸/旋转/裁剪/水印）：纯编辑，不压缩
                edit::edit(&input, &output, ie, &mut on_progress).await
            } else {
                match preset.image.clone() {
                    Some(params) => {
                        image::compress(&input, &output, &params, &mut on_progress).await
                    }
                    None => Err("预设缺少图片参数".to_string()),
                }
            }
        }
        _ => unreachable!(),
    };

    match result {
        Ok(out) => {
            job.status = "done".into();
            job.progress = 100;
            job.output_size = Some(out.output_size);
            job.output_path = Some(out.output_path.to_string_lossy().into_owned());
            if out.skipped {
                // 源已满足目标大小：未重新编码，直接提示（避免「越压越大」）
                job.warning = Some(
                    "源文件已满足大小要求，未重新压缩（直接使用原文件）".to_string(),
                );
            } else if job.input_size > 0 && out.output_size >= job.input_size {
                // 治理「压缩后变大」：输出未小于源 → 非致命提示（用户感知「没达到预期」的主因之一）
                let ratio =
                    ((out.output_size as f64 / job.input_size as f64) * 100.0).round() as u64;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::queue::JobParams;
    use crate::presets::VideoParams;
    use serde_json::json;

    /// 集成实测：复现「CRF 预设对低码率源膨胀」——1MB 的 bbb 片段经
    /// bilibili-high（crf23.5 slow maxrate3000k）输出约 3.9MB，
    /// run_compression 必须生成「输出比源大」warning（而非静默成功）
    #[tokio::test]
    #[ignore = "集成实测：需要 ffmpeg 在 PATH"]
    async fn video_bigger_output_raises_warning() {
        let input = Path::new(
            "/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/corpus/vid_bbb_1080p10s.mp4",
        );
        assert!(input.exists(), "缺少素材 {}", input.display());
        let out_dir = Path::new(
            "/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/verify",
        );
        let input_size = std::fs::metadata(input).unwrap().len();
        let params = JobParams {
            preset_id: "bilibili-high".into(),
            ..Default::default()
        };
        let job = JobState::new(
            "verify-bbb-warning".into(),
            input.to_string_lossy().into_owned(),
            "bilibili-high".into(),
            input_size,
            params,
        );
        let preset = Preset {
            id: "bilibili-high".into(),
            name: "B站 高清 1080p".into(),
            platform: "bilibili".into(),
            kind: "video".into(),
            tags: vec![],
            constraints: Some(json!({ "max_bitrate_kbps": 3000 })),
            video: Some(VideoParams {
                codec: "libx264".into(),
                crf: 23.5,
                preset: "slow".into(),
                level: Some("4.1".into()),
                keyint: Some(590),
                pix_fmt: None,
                audio: None,
            }),
            image: None,
            filters: None,
            note: None,
        };
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let out = run_compression(
            job, &preset, Some(out_dir), None, None, None, None, None, &cancel, |_| {},
        )
        .await;
        assert_eq!(out.status, "done", "err={:?}", out.error);
        assert!(
            out.warning.is_some(),
            "低码率源膨胀时必须触发变大 warning，实际 warning={:?}",
            out.warning
        );
        println!("[实测] 变大 warning 触发: {}", out.warning.as_deref().unwrap());
    }

    /// 集成实测：复现「自由 q80 对已压缩 JPEG 膨胀」——photo_river.jpg（360KB，已压缩）
    /// 经 mozjpeg q80 输出约 384KB（104.9%），必须触发变大 warning
    #[tokio::test]
    #[ignore = "集成实测：需要 cjpeg 在 PATH"]
    async fn image_bigger_output_raises_warning() {
        use crate::presets::ImageParams;
        let input = Path::new(
            "/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/corpus/photo_river.jpg",
        );
        assert!(input.exists(), "缺少素材 {}", input.display());
        let out_dir = Path::new(
            "/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/verify",
        );
        let input_size = std::fs::metadata(input).unwrap().len();
        let params = JobParams {
            preset_id: "photo-80".into(),
            ..Default::default()
        };
        let job = JobState::new(
            "verify-jpg-warning".into(),
            input.to_string_lossy().into_owned(),
            "photo-80".into(),
            input_size,
            params,
        );
        let preset = Preset {
            id: "photo-80".into(),
            name: "通用图片（自由质量）".into(),
            platform: "generic".into(),
            kind: "image".into(),
            tags: vec![],
            constraints: None,
            video: None,
            image: Some(ImageParams {
                format: "jpeg".into(),
                engine: "mozjpeg".into(),
                quality: Some(80),
                max_size_kb: None,
                strip_metadata: true,
            }),
            filters: None,
            note: None,
        };
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let out = run_compression(
            job, &preset, Some(out_dir), None, None, None, None, None, &cancel, |_| {},
        )
        .await;
        assert_eq!(out.status, "done", "err={:?}", out.error);
        assert!(
            out.warning.is_some(),
            "已压缩 JPEG 经 mozjpeg q80 膨胀时必须触发变大 warning，实际 warning={:?}",
            out.warning
        );
        println!(
            "[实测] 图片变大 warning 触发: 源 {input_size}B -> {}B",
            out.output_size.unwrap_or(0)
        );
    }
}
