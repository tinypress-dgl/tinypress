use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::Command;

use crate::presets::ImageParams;

use super::{BinaryLocator, Output};

/// 图片压缩入口：按 engine 分发到 mozjpeg/pngquant/libwebp/libavif，
/// 若预设带 max_size_kb，则对质量参数做二分逼近目标大小。
pub async fn compress(
    input: &Path,
    output: &Path,
    img: &ImageParams,
    mut on_progress: impl FnMut(u8),
) -> Result<Output, String> {
    on_progress(10);

    let quality = img.quality.unwrap_or(80);

    if let Some(max_kb) = img.max_size_kb {
        // 目标大小模式：二分质量，最大 7 轮
        let max_bytes = max_kb * 1024;
        let mut lo: u8 = 10;
        let mut hi: u8 = 95;
        let mut best: Option<Output> = None;
        for round in 0..7 {
            on_progress(20 + round as u8 * 10);
            let q = lo + (hi - lo) / 2;
            let out = run_once(input, output, img, q).await?;
            let fits = out.output_size <= max_bytes;
            if fits {
                best = Some(out);
                lo = q + 1;
            } else {
                hi = q.saturating_sub(1);
            }
            if lo > hi {
                break;
            }
        }
        let out = best.ok_or_else(|| {
            format!(
                "最低质量仍超过 {max_kb}KB 限制（当前大小 {}KB）",
                std::fs::metadata(output).map(|m| m.len() / 1024).unwrap_or(0)
            )
        })?;
        on_progress(100);
        Ok(out)
    } else {
        let out = run_once(input, output, img, quality).await?;
        on_progress(100);
        Ok(out)
    }
}

/// 单次执行选中的图片引擎
async fn run_once(
    input: &Path,
    output: &Path,
    img: &ImageParams,
    quality: u8,
) -> Result<Output, String> {
    let locator = BinaryLocator;
    match img.engine.as_str() {
        "mozjpeg" => mozjpeg(input, output, &locator, quality).await,
        "pngquant" => pngquant_run(input, output, &locator).await,
        "libwebp" => webp(input, output, &locator, quality).await,
        "libavif" => avif(input, output, &locator, quality).await,
        other => Err(format!("未知图片引擎: {other}")),
    }
}

async fn finish(output: &Path) -> Result<Output, String> {
    let size = std::fs::metadata(output)
        .map_err(|e| format!("读取输出失败: {e}"))?
        .len();
    Ok(Output {
        output_path: output.to_path_buf(),
        output_size: size,
    })
}

/// mozjpeg：ffmpeg 解码为临时 PPM 文件 → cjpeg 编码（质量优先，输出最小 jpg）
async fn mozjpeg(
    input: &Path,
    output: &Path,
    locator: &BinaryLocator,
    quality: u8,
) -> Result<Output, String> {
    let ffmpeg = locator
        .find("ffmpeg")
        .ok_or_else(|| "未找到 ffmpeg 二进制".to_string())?;
    let cjpeg = locator
        .find("cjpeg")
        .ok_or_else(|| "未找到 cjpeg（mozjpeg）二进制".to_string())?;

    // 1) ffmpeg 解码为临时 PPM（扩展名驱动格式，避免跨进程管道连接）
    let ppm = output.with_extension("tmp.ppm");
    let dec = Command::new(&ffmpeg)
        .args([
            "-y",
            "-i",
            input.to_str().ok_or("路径非法")?,
            "-pix_fmt",
            "rgb24",
            ppm.to_str().ok_or("路径非法")?,
        ])
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
    if !dec.success() {
        return Err("ffmpeg 解码为 PPM 失败".into());
    }

    // 2) cjpeg 压缩 PPM 为 JPEG
    let enc = Command::new(&cjpeg)
        .args([
            "-quality",
            &quality.to_string(),
            "-optimize",
            "-progressive",
            "-outfile",
            output.to_str().ok_or("路径非法")?,
            ppm.to_str().ok_or("路径非法")?,
        ])
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("启动 cjpeg 失败: {e}"))?;
    let _ = std::fs::remove_file(&ppm);
    if !enc.success() {
        return Err(format!("cjpeg 退出码: {:?}", enc.code()));
    }
    finish(output).await
}

/// pngquant：输入需为 PNG，非 PNG 先用 ffmpeg 转换；按质量区间量化
async fn pngquant_run(
    input: &Path,
    output: &Path,
    locator: &BinaryLocator,
) -> Result<Output, String> {
    let pngquant = locator
        .find("pngquant")
        .ok_or_else(|| "未找到 pngquant 二进制".to_string())?;
    let tmp = output.with_extension("tmp.png");
    let png_in = if input.extension().map(|e| e == "png").unwrap_or(false) {
        input.to_path_buf()
    } else {
        let ffmpeg = locator
            .find("ffmpeg")
            .ok_or_else(|| "未找到 ffmpeg 二进制".to_string())?;
        let st = Command::new(&ffmpeg)
            .args(["-y", "-i", input.to_str().ok_or("路径非法")?, tmp.to_str().ok_or("路径非法")?])
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?;
        if !st.success() {
            return Err("PNG 转换失败".into());
        }
        tmp.clone()
    };

    let st = Command::new(&pngquant)
        .args([
            "--quality=60-85",
            "--strip",
            "--output",
            output.to_str().ok_or("路径非法")?,
            png_in.to_str().ok_or("路径非法")?,
        ])
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !st.success() {
        return Err(format!("pngquant 退出码: {:?}", st.code()));
    }
    let _ = std::fs::remove_file(&tmp);
    finish(output).await
}

/// libwebp：cwebp 直接支持常见图片输入
async fn webp(
    input: &Path,
    output: &Path,
    locator: &BinaryLocator,
    quality: u8,
) -> Result<Output, String> {
    let cwebp = locator
        .find("cwebp")
        .ok_or_else(|| "未找到 cwebp（libwebp）二进制".to_string())?;
    let st = Command::new(&cwebp)
        .args([
            "-q",
            &quality.to_string(),
            "-metadata",
            "none",
            input.to_str().ok_or("路径非法")?,
            "-o",
            output.to_str().ok_or("路径非法")?,
        ])
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !st.success() {
        return Err(format!("cwebp 退出码: {:?}", st.code()));
    }
    finish(output).await
}

/// libavif：avifenc 支持 png/jpeg 输入
async fn avif(
    input: &Path,
    output: &Path,
    locator: &BinaryLocator,
    quality: u8,
) -> Result<Output, String> {
    let avifenc = locator
        .find("avifenc")
        .ok_or_else(|| "未找到 avifenc（libavif）二进制".to_string())?;
    let st = Command::new(&avifenc)
        .args([
            "--min",
            "0",
            "--max",
            "63",
            "--qscale",
            &quality.to_string(),
            "--speed",
            "6",
            input.to_str().ok_or("路径非法")?,
            output.to_str().ok_or("路径非法")?,
        ])
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !st.success() {
        return Err(format!("avifenc 退出码: {:?}", st.code()));
    }
    finish(output).await
}

// 保持 PathBuf 导入被使用
#[allow(dead_code)]
fn _sig(_: PathBuf) {}
