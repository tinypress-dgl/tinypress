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
pub async fn run_compression(
    mut job: JobState,
    preset: &Preset,
    output_dir: Option<&Path>,
    rename: Option<&str>,
    edit: Option<&video::EditOptions>,
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
    let result = match preset.kind.as_str() {
        "video" => match preset.video.clone() {
            Some(params) => {
                video::compress(
                    &input,
                    &output,
                    &params,
                    preset.filters.as_ref(),
                    max_bitrate_kbps,
                    edit,
                    &mut on_progress,
                )
                .await
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
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for cand in [
                    dir.join("bins").join(bin_name(name)),
                    dir.join(bin_name(name)),
                ] {
                    if cand.is_file() {
                        return Some(cand);
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
