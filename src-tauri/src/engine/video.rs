use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::presets::VideoParams;

use super::{BinaryLocator, Output};

/// x264 风格 preset → NVENC 档位（p1 最快 / p7 最慢质量最高）
fn map_nvenc_preset(p: &str) -> String {
    match p {
        "ultrafast" | "superfast" | "veryfast" => "p1".into(),
        "faster" => "p2".into(),
        "fast" => "p3".into(),
        "medium" => "p4".into(),
        "slow" => "p5".into(),
        "slower" | "veryslow" | "placebo" => "p6".into(),
        _ if p.starts_with('p') => p.to_string(),
        _ => "p4".into(),
    }
}

/// 基础视频编辑选项（任务级，随 CompressItem 传入；全部可选）
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditOptions {
    /// 截取起点（秒）
    pub trim_start: Option<f64>,
    /// 截取时长（秒，从 trim_start 起）
    pub trim_duration: Option<f64>,
    /// 旋转：0 / 90 / 180 / 270（顺时针）
    pub rotate: Option<i32>,
    /// 自动去黑边（cropdetect 探测后裁剪）
    pub autocrop: bool,
    /// 手动裁剪：宽度/高度百分比（0-100，居中裁剪）
    pub crop_percent: Option<f64>,
}

/// 由 cropdetect 得到的黑边裁剪区域（像素）
#[derive(Debug, Clone)]
pub struct CropSpec {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// 组装编辑滤镜链：trim → rotate → autocrop/crop → （scale 由调用方追加）
fn edit_filter_chain(e: &EditOptions) -> Vec<String> {
    let mut chain: Vec<String> = Vec::new();
    if e.trim_start.is_some() || e.trim_duration.is_some() {
        let start = e.trim_start.unwrap_or(0.0);
        match e.trim_duration {
            Some(d) => chain.push(format!("trim=start={start}:duration={d},setpts=PTS-STARTPTS")),
            None => chain.push(format!("trim=start={start},setpts=PTS-STARTPTS")),
        }
    }
    if let Some(r) = e.rotate {
        if r != 0 {
            let rot = ((r % 360) + 360) % 360;
            let expr = match rot {
                90 => "transpose=1",
                180 => "hflip,vflip",
                270 => "transpose=2",
                _ => "",
            };
            if !expr.is_empty() {
                chain.push(expr.to_string());
            }
        }
    }
    if let Some(pct) = e.crop_percent {
        if (1.0..=100.0).contains(&pct) {
            // 居中按百分比裁剪：先算目标宽高比例再裁剪
            chain.push(format!(
                "crop=iw*{pct}/100:ih*{pct}/100:(iw-iw*{pct}/100)/2:(ih-ih*{pct}/100)/2"
            ));
        }
    }
    chain
}

/// 探测黑边裁剪区域（cropdetect，分析前 3 秒即可）
pub async fn detect_crop(input: &Path) -> Option<CropSpec> {
    let locator = BinaryLocator;
    let ffmpeg = locator.find("ffmpeg")?;
    let out = Command::new(ffmpeg)
        .args([
            "-t",
            "3",
            "-i",
            input.to_str()?,
            "-vf",
            "cropdetect=limit=24:round=2:reset=0",
            "-f",
            "null",
            "-",
        ])
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let mut last: Option<CropSpec> = None;
    for line in text.lines() {
        if let Some(pos) = line.find("crop=") {
            let spec = line[pos + 5..].trim();
            let parts: Vec<&str> = spec.split(':').collect();
            if parts.len() == 4 {
                if let (Ok(w), Ok(h), Ok(x), Ok(y)) = (
                    parts[0].parse::<u32>(),
                    parts[1].parse::<u32>(),
                    parts[2].parse::<u32>(),
                    parts[3].parse::<u32>(),
                ) {
                    last = Some(CropSpec { x, y, w, h });
                }
            }
        }
    }
    last
}

/// 组装 FFmpeg 参数（预设 JSON 直接映射，无硬编码平台规则；
/// 硬件编码器 NVENC/QSV 使用各自的质量与 GOP 参数方言；
/// max_bitrate_kbps 来自预设 constraints，输出 -maxrate/-bufsize 硬限码率；
/// edit/autocrop_spec 来自任务级编辑选项）
#[allow(clippy::too_many_arguments)]
fn build_args(
    input: &Path,
    output: &Path,
    v: &VideoParams,
    filters: Option<&serde_json::Value>,
    max_bitrate_kbps: Option<u32>,
    edit: Option<&EditOptions>,
    autocrop_spec: Option<&CropSpec>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-map".into(),
        "0:v:0".into(),
        "-c:v".into(),
        v.codec.clone(),
    ];

    let codec = v.codec.as_str();
    let is_nvenc = codec.contains("nvenc");
    let is_qsv = codec.contains("qsv");

    if is_nvenc {
        // NVENC：-cq 代替 -crf；preset 映射到 p1-p7
        args.push("-cq".into());
        args.push(v.crf.to_string());
        args.push("-preset".into());
        args.push(map_nvenc_preset(&v.preset));
    } else if is_qsv {
        // QSV：-global_quality 代替 -crf；preset 兼容 x264 风格值
        args.push("-global_quality".into());
        args.push(v.crf.to_string());
        args.push("-preset".into());
        args.push(v.preset.clone());
    } else {
        args.push("-crf".into());
        args.push(v.crf.to_string());
        args.push("-preset".into());
        args.push(v.preset.clone());
    }

    if let Some(kbps) = max_bitrate_kbps {
        // 硬限码率：B站免二压等场景必须保证峰值不超过平台阈值
        args.push("-maxrate".into());
        args.push(format!("{kbps}k"));
        args.push("-bufsize".into());
        args.push(format!("{}k", kbps * 2));
    }

    if let Some(level) = &v.level {
        if !is_nvenc {
            args.push("-level".into());
            args.push(level.clone());
        }
    }
    if let Some(keyint) = v.keyint {
        if codec.contains("x264") {
            args.push("-x264-params".into());
            args.push(format!("keyint={keyint}:min-keyint={keyint}:scenecut=0"));
        } else {
            // NVENC/QSV/软件 HEVC/AV1：GOP 大小 + 最小间隔
            args.push("-g".into());
            args.push(keyint.to_string());
            args.push("-keyint_min".into());
            args.push(keyint.to_string());
        }
    }

    // 滤镜链：编辑（trim/rotate/crop）→ autocrop → 平台 scale；fps 单独 -r
    let mut vf: Vec<String> = Vec::new();
    if let Some(e) = edit {
        vf.extend(edit_filter_chain(e));
        if let Some(crop) = autocrop_spec {
            vf.push(format!("crop={}:{}:{}:{}", crop.w, crop.h, crop.x, crop.y));
        }
    }
    if let Some(f) = filters {
        if let Some(scale) = f.get("scale").and_then(|s| s.as_str()) {
            vf.push(format!(
                "scale={scale}:force_original_aspect_ratio=decrease"
            ));
        }
    }
    if !vf.is_empty() {
        args.push("-vf".into());
        args.push(vf.join(","));
    }
    if let Some(f) = filters {
        if let Some(fps) = f.get("max_fps").and_then(|s| s.as_u64()) {
            args.push("-r".into());
            args.push(fps.to_string());
        }
    }

    args.push("-pix_fmt".into());
    args.push(v.pix_fmt.clone().unwrap_or_else(|| "yuv420p".into()));

    if let Some(audio) = &v.audio {
        args.push("-c:a".into());
        args.push(audio.codec.clone());
        args.push("-b:a".into());
        args.push(format!("{}k", audio.bitrate_kbps));
    } else {
        args.push("-an".into());
    }

    args.push("-movflags".into());
    args.push("faststart".into());
    args.push("-y".into());
    args.push(output.to_string_lossy().into_owned());
    args
}

/// 探测输入时长（秒），失败返回 None —— 仅用于进度展示，不阻塞压缩
async fn probe_duration(input: &Path) -> Option<f64> {
    let locator = BinaryLocator;
    let ffmpeg = locator.find("ffmpeg")?;
    let out = Command::new(ffmpeg)
        .args(["-i", input.to_str()?])
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let line = text.lines().find(|l| l.contains("Duration:"))?;
    let rest = line.split("Duration:").nth(1)?.trim();
    let time = rest.split(',').next()?.trim();
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// 视频压缩：spawn FFmpeg，解析 stderr 的 time= 输出实时进度（0-90 区间），完成后置 100
pub async fn compress(
    input: &Path,
    output: &Path,
    v: &VideoParams,
    filters: Option<&serde_json::Value>,
    max_bitrate_kbps: Option<u32>,
    edit: Option<&EditOptions>,
    mut on_progress: impl FnMut(u8),
) -> Result<Output, String> {
    let locator = BinaryLocator;
    let ffmpeg = locator
        .find("ffmpeg")
        .ok_or_else(|| "未找到 ffmpeg 二进制（请检查 bins/ 目录）".to_string())?;

    let duration = probe_duration(input).await;
    // 自动去黑边：先 cropdetect 探测（快，只解码 3 秒），再带入裁剪滤镜
    let autocrop_spec = match edit.and_then(|e| e.autocrop.then_some(())) {
        Some(()) => detect_crop(input).await,
        None => None,
    };
    let args = build_args(
        input,
        output,
        v,
        filters,
        max_bitrate_kbps,
        edit,
        autocrop_spec.as_ref(),
    );

    let mut child = Command::new(&ffmpeg)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;

    let mut reader = BufReader::new(
        child
            .stderr
            .take()
            .ok_or_else(|| "无法读取 ffmpeg stderr".to_string())?,
    );
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("读取进度失败: {e}"))?;
        if n == 0 {
            break;
        }
        if let (Some(dur), Some(cur)) = (duration, parse_time_secs(&line)) {
            let pct = ((cur / dur) * 90.0).min(89.0) as u8 + 1;
            on_progress(pct);
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("等待 ffmpeg 失败: {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg 退出码: {:?}", status.code()));
    }

    let size = std::fs::metadata(output)
        .map_err(|e| format!("读取输出文件失败: {e}"))?
        .len();
    on_progress(100);
    Ok(Output {
        output_path: output.to_path_buf(),
        output_size: size,
    })
}

/// 从 ffmpeg stderr 行解析 `time=HH:MM:SS.xx`
fn parse_time_secs(line: &str) -> Option<f64> {
    let pos = line.find("time=")?;
    let rest = line[pos + 5..].trim_start();
    let time = rest
        .split(|c: char| c.is_whitespace() || c == ',')
        .next()?;
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let s: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

// 保持 PathBuf 导入被使用（后续扩展签名用）
#[allow(dead_code)]
fn _sig(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(codec: &str, crf: f64, preset: &str) -> VideoParams {
        VideoParams {
            codec: codec.into(),
            crf,
            preset: preset.into(),
            level: None,
            keyint: Some(250),
            pix_fmt: None,
            audio: None,
        }
    }

    #[test]
    fn nvenc_uses_cq_and_mapped_preset() {
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &params("h264_nvenc", 23.0, "slow"),
            None,
            None,
            None,
            None,
        );
        let joined = args.join(" ");
        assert!(joined.contains("-c:v h264_nvenc"), "{joined}");
        assert!(joined.contains("-cq 23"), "{joined}");
        assert!(joined.contains("-preset p5"), "{joined}"); // slow → p5
        assert!(!joined.contains("-crf"), "{joined}");
        // NVENC GOP：-g 与 -keyint_min
        assert!(joined.contains("-g 250"), "{joined}");
        assert!(joined.contains("-keyint_min 250"), "{joined}");
    }

    #[test]
    fn qsv_uses_global_quality() {
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &params("hevc_qsv", 26.0, "medium"),
            None,
            None,
            None,
            None,
        );
        let joined = args.join(" ");
        assert!(joined.contains("-c:v hevc_qsv"), "{joined}");
        assert!(joined.contains("-global_quality 26"), "{joined}");
        assert!(joined.contains("-preset medium"), "{joined}");
        assert!(!joined.contains("-crf"), "{joined}");
    }

    #[test]
    fn x264_keeps_crf_and_x264_params() {
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &params("libx264", 23.5, "slow"),
            None,
            None,
            None,
            None,
        );
        let joined = args.join(" ");
        assert!(joined.contains("-crf 23.5"), "{joined}");
        assert!(joined.contains("-preset slow"), "{joined}");
        assert!(joined.contains("keyint=250:min-keyint=250:scenecut=0"), "{joined}");
    }

    #[test]
    fn nvenc_level_is_skipped() {
        let mut p = params("h264_nvenc", 23.0, "slow");
        p.level = Some("4.1".into());
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &p,
            None,
            None,
            None,
            None,
        );
        let joined = args.join(" ");
        assert!(!joined.contains("-level"), "{joined}");
    }

    #[test]
    fn scale_filter_applied() {
        let f = serde_json::json!({ "scale": "1920:-2", "max_fps": 60 });
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &params("libx264", 23.5, "slow"),
            Some(&f),
            None,
            None,
            None,
        );
        let joined = args.join(" ");
        assert!(joined.contains("scale=1920:-2"), "{joined}");
        assert!(joined.contains("-r 60"), "{joined}");
    }

    #[test]
    fn max_bitrate_applies_hard_limit() {
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &params("libx264", 23.5, "slow"),
            None,
            Some(3000),
            None,
            None,
        );
        let joined = args.join(" ");
        assert!(joined.contains("-maxrate 3000k"), "{joined}");
        assert!(joined.contains("-bufsize 6000k"), "{joined}");
    }

    #[test]
    fn edit_chain_trims_rotates_and_crops() {
        let e = EditOptions {
            trim_start: Some(5.0),
            trim_duration: Some(10.0),
            rotate: Some(90),
            autocrop: false,
            crop_percent: Some(80.0),
        };
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &params("libx264", 23.5, "slow"),
            None,
            None,
            Some(&e),
            None,
        );
        let joined = args.join(" ");
        let vf = joined
            .split("-vf ")
            .nth(1)
            .and_then(|s| s.split(' ').next())
            .unwrap_or("");
        assert!(
            vf.contains("trim=start=5:duration=10,setpts=PTS-STARTPTS"),
            "vf={vf}"
        );
        assert!(vf.contains("transpose=1"), "vf={vf}");
        assert!(
            vf.contains("crop=iw*80/100:ih*80/100"),
            "vf={vf}"
        );
    }

    #[test]
    fn autocrop_spec_injects_crop_filter() {
        let spec = CropSpec {
            x: 8,
            y: 10,
            w: 640,
            h: 360,
        };
        let e = EditOptions {
            autocrop: true,
            ..Default::default()
        };
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &params("libx264", 23.5, "slow"),
            None,
            None,
            Some(&e),
            Some(&spec),
        );
        let joined = args.join(" ");
        assert!(joined.contains("crop=640:360:8:10"), "{joined}");
    }

    #[test]
    fn no_edit_keeps_vf_clean() {
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            &params("libx264", 23.5, "slow"),
            None,
            None,
            None,
            None,
        );
        let joined = args.join(" ");
        assert!(!joined.contains("-vf"), "{joined}");
    }
}
