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
        // 源已达标：不重编码（避免「越压越大」+ 白损失质量），直接返回源
        let src_size = std::fs::metadata(input).map(|m| m.len()).unwrap_or(0);
        if src_size > 0 && src_size <= max_bytes {
            on_progress(100);
            return Ok(Output {
                output_path: input.to_path_buf(),
                output_size: src_size,
                skipped: true,
            });
        }
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
                std::fs::metadata(output)
                    .map(|m| m.len() / 1024)
                    .unwrap_or(0)
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
        "pngquant" => pngquant_run(input, output, &locator, quality).await,
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
        skipped: false,
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

/// pngquant：输入需为 PNG，非 PNG 先用 ffmpeg 转换。
/// 质量区间由用户设置的 quality 决定（上限=quality，下限=quality-25，最低 10），
/// 修复旧版 `--quality=60-85` 硬编码导致用户质量档对 PNG 不生效的问题。
async fn pngquant_run(
    input: &Path,
    output: &Path,
    locator: &BinaryLocator,
    quality: u8,
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
            .args([
                "-y",
                "-i",
                input.to_str().ok_or("路径非法")?,
                tmp.to_str().ok_or("路径非法")?,
            ])
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|e| e.to_string())?;
        if !st.success() {
            return Err("PNG 转换失败".into());
        }
        tmp.clone()
    };

    // pngquant 质量区间：min-max，落在区间内输出；上限跟随用户质量档
    let hi = quality.clamp(10, 100);
    let lo = (quality.saturating_sub(25)).clamp(10, hi);
    let st = Command::new(&pngquant)
        .args([
            format!("--quality={lo}-{hi}"),
            "--strip".into(),
            "--output".into(),
            output.to_str().ok_or("路径非法")?.into(),
            png_in.to_str().ok_or("路径非法")?.into(),
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

/// AVIF 引擎（libavif 语义，ffmpeg 实现）：
/// 历史缺陷——Linux deb 捆绑的 avifenc 链接 libavif.so.16 而捆绑库为 .15（ABI 不匹配），
/// 导致 AVIF 压缩在 Linux 上实际不可用（用户机器同款问题，实测退出码 127）。
/// 修复：改用随包捆绑的 ffmpeg（libaom-av1 + avif muxer，-still-picture 1），
/// 跨平台确定可用，参数公开（libaom CRF 0-63 语义与 avifenc qscale 一致）。
async fn avif(
    input: &Path,
    output: &Path,
    locator: &BinaryLocator,
    quality: u8,
) -> Result<Output, String> {
    let ffmpeg = locator
        .find("ffmpeg")
        .ok_or_else(|| "未找到 ffmpeg 二进制".to_string())?;
    let q = quality.clamp(0, 100) as u64;
    let crf = (63u64.saturating_mul(100 - q) / 100).clamp(0, 63);
    let st = Command::new(&ffmpeg)
        .args([
            "-y",
            "-i",
            input.to_str().ok_or("路径非法")?,
            "-c:v",
            "libaom-av1",
            "-crf",
            &crf.to_string(),
            "-still-picture",
            "1",
            "-cpu-used",
            "6",
            "-pix_fmt",
            "yuv420p",
            "-an",
            output.to_str().ok_or("路径非法")?,
        ])
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !st.success() {
        return Err(format!("AVIF（libaom-av1）编码退出码: {:?}", st.code()));
    }
    finish(output).await
}

// 保持 PathBuf 导入被使用
#[allow(dead_code)]
fn _sig(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn verify_dir() -> PathBuf {
        Path::new("/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/verify")
            .to_path_buf()
    }
    fn corpus(name: &str) -> PathBuf {
        Path::new("/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/corpus")
            .join(name)
    }

    /// 集成实测：pngquant 质量透传——同源 q80 输出应显著大于 q60
    /// （旧版硬编码 --quality=60-85 时两个档位输出相同，此测试保证修复生效）
    #[tokio::test]
    #[ignore = "集成实测：需要 pngquant 在 PATH"]
    async fn pngquant_quality_passthrough() {
        let input = corpus("photo_river.png");
        assert!(input.exists(), "缺少素材 {}", input.display());
        let out80 = verify_dir().join("out_q80.png");
        let out60 = verify_dir().join("out_q60.png");
        let _ = std::fs::remove_file(&out80);
        let _ = std::fs::remove_file(&out60);
        let locator = BinaryLocator;
        pngquant_run(&input, &out80, &locator, 80)
            .await
            .unwrap_or_else(|e| panic!("q80 失败: {e}"));
        pngquant_run(&input, &out60, &locator, 60)
            .await
            .unwrap_or_else(|e| panic!("q60 失败: {e}"));
        let s80 = std::fs::metadata(&out80).unwrap().len();
        let s60 = std::fs::metadata(&out60).unwrap().len();
        assert!(s80 > s60, "q80={s80}B 应大于 q60={s60}B（质量透传未生效）");
        println!("[实测] pngquant 透传: q80={}B q60={}B", s80, s60);
    }

    /// 集成实测：AVIF qscale 0-63 线性映射——
    /// 高质量档（q80 → qscale 13）输出应大于低质量档（q10 → qscale 57）
    #[tokio::test]
    #[ignore = "集成实测：需要 avifenc 在 PATH"]
    async fn avif_qscale_mapping() {
        let input = corpus("photo_dog.jpg");
        assert!(input.exists(), "缺少素材 {}", input.display());
        let out_hi = verify_dir().join("out_q80.avif");
        let out_lo = verify_dir().join("out_q10.avif");
        let _ = std::fs::remove_file(&out_hi);
        let _ = std::fs::remove_file(&out_lo);
        let locator = BinaryLocator;
        avif(&input, &out_hi, &locator, 80)
            .await
            .unwrap_or_else(|e| panic!("avif q80 失败: {e}"));
        avif(&input, &out_lo, &locator, 10)
            .await
            .unwrap_or_else(|e| panic!("avif q10 失败: {e}"));
        let s_hi = std::fs::metadata(&out_hi).unwrap().len();
        let s_lo = std::fs::metadata(&out_lo).unwrap().len();
        assert!(
            s_hi > s_lo,
            "q80={s_hi}B 应大于 q10={s_lo}B（qscale 映射失效）"
        );
        println!("[实测] AVIF qscale 映射: q80={}B q10={}B", s_hi, s_lo);
    }

    /// 集成实测：图片目标大小二分——新内置预设 webp-300k（≤300KB）与 avif-500k（≤500KB）
    /// 必须把源压进体积上限（compress 的 max_size_kb 二分路径，7 轮质量逼近）
    #[tokio::test]
    #[ignore = "集成实测：需要引擎二进制在 PATH"]
    async fn image_target_size_bisect_reaches_limit() {
        let river = corpus("photo_river.jpg");
        let dog = corpus("photo_dog.jpg");
        assert!(river.exists() && dog.exists());
        let out_webp = verify_dir().join("out_webp300.webp");
        let out_avif = verify_dir().join("out_avif500.avif");
        let _ = std::fs::remove_file(&out_webp);
        let _ = std::fs::remove_file(&out_avif);

        let webp300 = ImageParams {
            format: "webp".into(),
            engine: "libwebp".into(),
            quality: Some(80),
            max_size_kb: Some(300),
            strip_metadata: true,
        };
        let r_webp = compress(&river, &out_webp, &webp300, |_| {})
            .await
            .unwrap_or_else(|e| panic!("webp 300KB 失败: {e}"));
        assert!(
            r_webp.output_size <= 300 * 1024,
            "webp 输出 {} 超出 300KB",
            r_webp.output_size
        );

        let avif500 = ImageParams {
            format: "avif".into(),
            engine: "libavif".into(),
            quality: Some(75),
            max_size_kb: Some(500),
            strip_metadata: true,
        };
        let r_avif = compress(&dog, &out_avif, &avif500, |_| {})
            .await
            .unwrap_or_else(|e| panic!("avif 500KB 失败: {e}"));
        assert!(
            r_avif.output_size <= 500 * 1024,
            "avif 输出 {} 超出 500KB",
            r_avif.output_size
        );
        let s_river = std::fs::metadata(&river).unwrap().len();
        let s_dog = std::fs::metadata(&dog).unwrap().len();
        println!(
            "[实测] 图片目标大小: webp300 源{} ({}B) -> {}B ({:.1}%); avif500 源{} ({}B) -> {}B ({:.1}%)",
            river.display(),
            s_river,
            r_webp.output_size,
            r_webp.output_size as f64 / s_river as f64 * 100.0,
            dog.display(),
            s_dog,
            r_avif.output_size,
            r_avif.output_size as f64 / s_dog as f64 * 100.0,
        );
    }

    /// 集成实测：引擎体积矩阵——dog/river 两图 × mozjpeg q80 / libwebp q75 / avif q75
    /// 打印 CSV（配合 ffmpeg PSNR/SSIM 做质量评估）
    #[tokio::test]
    #[ignore = "集成实测：需要引擎二进制在 PATH"]
    async fn image_engine_matrix_output_sizes() {
        let cases: Vec<(&str, PathBuf)> = vec![
            ("dog", corpus("photo_dog.jpg")),
            ("river", corpus("photo_river.jpg")),
        ];
        for (name, input) in cases {
            assert!(input.exists(), "缺少素材 {}", input.display());
            let src = std::fs::metadata(&input).unwrap().len();
            let matrix = [
                (
                    "mozjpeg-q80",
                    ImageParams {
                        format: "jpeg".into(),
                        engine: "mozjpeg".into(),
                        quality: Some(80),
                        max_size_kb: None,
                        strip_metadata: true,
                    },
                ),
                (
                    "libwebp-q75",
                    ImageParams {
                        format: "webp".into(),
                        engine: "libwebp".into(),
                        quality: Some(75),
                        max_size_kb: None,
                        strip_metadata: true,
                    },
                ),
                (
                    "libavif-q75",
                    ImageParams {
                        format: "avif".into(),
                        engine: "libavif".into(),
                        quality: Some(75),
                        max_size_kb: None,
                        strip_metadata: true,
                    },
                ),
            ];
            for (tag, img) in matrix {
                let ext = match img.format.as_str() {
                    "jpeg" => "jpg",
                    "webp" => "webp",
                    _ => "avif",
                };
                let out = verify_dir().join(format!("matrix_{name}_{tag}.{ext}"));
                let _ = std::fs::remove_file(&out);
                let r = compress(&input, &out, &img, |_| {})
                    .await
                    .unwrap_or_else(|e| panic!("{name} {tag} 失败: {e}"));
                println!(
                    "[矩阵] {name},{tag},src={src}B,out={}B,ratio={:.1}%",
                    r.output_size,
                    r.output_size as f64 / src as f64 * 100.0
                );
            }
        }
    }
}
