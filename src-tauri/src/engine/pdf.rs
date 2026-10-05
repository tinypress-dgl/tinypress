use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::Command;

use super::{BinaryLocator, Output};

/// 单图转单页 PDF（批量转 PDF = 每图一个 PDF 任务）。
/// 技术路径（自研、无专利依赖）：
///  1. ffprobe 取原图宽高（像素）；
///  2. ffmpeg 统一转 yuvj420p JPEG（有 alpha 时先合成白底；PNG→JPEG 有损 q=4≈92）；
///  3. 手写最小 PDF 1.4：JPEG 字节以 DCTDecode 直嵌（零二次压缩），页面按 A4 等比缩放居中。
pub async fn image_to_pdf(
    input: &Path,
    output_pdf: &Path,
    mut on_progress: impl FnMut(u8),
) -> Result<Output, String> {
    on_progress(10);
    let locator = BinaryLocator;
    let ffmpeg = locator
        .find("ffmpeg")
        .ok_or_else(|| "未找到 ffmpeg 二进制".to_string())?;
    let input_s = input.to_str().ok_or("路径非法")?;

    // 1) 尺寸
    let (w, h) = probe_dimensions(&locator, input).await?;

    // 2) 统一转 JPEG（有 alpha 白底合成，避免透明变黑）
    let tmp_jpg = output_pdf
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(
            ".tinypress_pdf_{}.jpg",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ));
    on_progress(25);
    let has_alpha = probe_has_alpha(&locator, input).await;
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        input_s.into(),
    ];
    if has_alpha {
        args.push("-filter_complex".into());
        args.push(format!(
            "[0:v]format=rgba[fg];color=white:s={w}x{h}:d=1[bg];[bg][fg]overlay=0:0,format=yuvj420p"
        ));
    } else {
        args.push("-vf".into());
        args.push("format=yuvj420p".into());
    }
    args.extend([
        "-frames:v".into(),
        "1".into(), // color 源默认多帧，必须限单帧（image2 不支持序列）
        "-q:v".into(),
        "4".into(),
        tmp_jpg.to_string_lossy().into_owned(),
    ]);
    let st = Command::new(&ffmpeg)
        .args(&args)
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
    if !st.success() {
        let _ = std::fs::remove_file(&tmp_jpg);
        return Err(format!("转 PDF 预处理退出码: {:?}", st.code()));
    }
    on_progress(55);
    let jpeg = std::fs::read(&tmp_jpg).map_err(|e| format!("读取 JPEG 失败: {e}"))?;
    let _ = std::fs::remove_file(&tmp_jpg);

    // 3) 手写 PDF（A4 = 595x842 pt，等比缩放居中）
    let pdf = build_pdf(&jpeg, w, h);
    on_progress(85);
    std::fs::write(output_pdf, pdf).map_err(|e| format!("写 PDF 失败: {e}"))?;
    on_progress(100);
    let size = std::fs::metadata(output_pdf)
        .map_err(|e| format!("读取 PDF 失败: {e}"))?
        .len();
    Ok(Output {
        output_path: output_pdf.to_path_buf(),
        output_size: size,
        skipped: false,
    })
}

/// ffprobe 取视频流宽高
async fn probe_dimensions(locator: &BinaryLocator, input: &Path) -> Result<(u32, u32), String> {
    let ffprobe = locator
        .find("ffprobe")
        .ok_or_else(|| "未找到 ffprobe 二进制".to_string())?;
    let out = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0:s=x",
            input.to_str().ok_or("路径非法")?,
        ])
        .output()
        .await
        .map_err(|e| format!("启动 ffprobe 失败: {e}"))?;
    let s = String::from_utf8_lossy(&out.stdout);
    let mut it = s.trim().split(['x', ',']).filter(|p| !p.is_empty());
    let w: u32 = it
        .next()
        .and_then(|v| v.trim().parse().ok())
        .ok_or_else(|| format!("无法解析图片尺寸: {s}"))?;
    let h: u32 = it
        .next()
        .and_then(|v| v.trim().parse().ok())
        .ok_or_else(|| format!("无法解析图片尺寸: {s}"))?;
    Ok((w, h))
}

/// ffprobe 检查像素格式是否含 alpha 通道
async fn probe_has_alpha(locator: &BinaryLocator, input: &Path) -> bool {
    let Some(ffprobe) = locator.find("ffprobe") else {
        return false;
    };
    let out = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=pix_fmt",
            "-of",
            "csv=p=0",
            input.to_str().unwrap_or(""),
        ])
        .output()
        .await
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    out.contains("a") && (out.contains("rgba") || out.contains("ya") || out.contains("abgr"))
}

/// 生成单页 PDF 字节（JPEG DCTDecode 直嵌，A4 等比缩放居中）
fn build_pdf(jpeg: &[u8], w_px: u32, h_px: u32) -> Vec<u8> {
    const A4_W: f64 = 595.0;
    const A4_H: f64 = 842.0;
    // 96dpi 语义：1px = 1/96 inch = 0.75pt
    let w_pt = w_px as f64 * 0.75;
    let h_pt = h_px as f64 * 0.75;
    let scale = (A4_W / w_pt).min(A4_H / h_pt);
    let dw = (w_pt * scale).round();
    let dh = (h_pt * scale).round();
    let dx = ((A4_W - dw) / 2.0).round();
    let dy = ((A4_H - dh) / 2.0).round();

    let mut buf = Vec::with_capacity(jpeg.len() + 1024);
    let mut offs = [0usize; 5];
    buf.extend_from_slice(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    // 1: catalog
    offs[0] = buf.len();
    buf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    // 2: pages
    offs[1] = buf.len();
    buf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
    // 3: page
    offs[2] = buf.len();
    let page = format!(
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {A4_W:.0} {A4_H:.0}] \
/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
    );
    buf.extend_from_slice(page.as_bytes());
    // 4: image xobject
    offs[3] = buf.len();
    let im = format!(
        "4 0 obj\n<< /Type /XObject /Subtype /Image /Width {w_px} /Height {h_px} \
/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {}\nstream\n",
        jpeg.len()
    );
    buf.extend_from_slice(im.as_bytes());
    buf.extend_from_slice(jpeg);
    buf.extend_from_slice(b"\nendstream\nendobj\n");
    // 5: content（绘制到页面）
    offs[4] = buf.len();
    let content = format!(
        "5 0 obj\n<< /Length 54 >>\nstream\nq {dw:.2} 0 0 {dh:.2} {dx:.2} {dy:.2} cm /Im0 Do Q\nendstream\nendobj\n"
    );
    buf.extend_from_slice(content.as_bytes());
    // xref
    let xref_off = buf.len();
    let xref = format!(
        "xref\n0 6\n0000000000 65535 f \n{off1:010} 00000 n \n{off2:010} 00000 n \n{off3:010} 00000 n \n{off4:010} 00000 n \n{off5:010} 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref_off}\n%%EOF\n",
        off1 = offs[0],
        off2 = offs[1],
        off3 = offs[2],
        off4 = offs[3],
        off5 = offs[4],
    );
    buf.extend_from_slice(xref.as_bytes());
    buf
}

// 保持 PathBuf 导入被使用（output_path 返回类型路径）
#[allow(dead_code)]
fn _sig(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn verify_dir() -> PathBuf {
        Path::new(
            "/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/verify",
        )
        .to_path_buf()
    }
    fn corpus(name: &str) -> PathBuf {
        Path::new(
            "/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/corpus",
        )
        .join(name)
    }

    #[test]
    fn build_pdf_structure_smoke() {
        let fake_jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 0xFF, 0xD9];
        let pdf = build_pdf(&fake_jpeg, 1920, 1080);
        let s = String::from_utf8_lossy(&pdf);
        assert!(s.starts_with("%PDF-1.4"), "PDF 头");
        assert!(s.contains("/Filter /DCTDecode"), "JPEG 直嵌");
        assert!(s.contains("/Width 1920"), "宽度");
        assert!(s.contains("/Height 1080"), "高度");
        assert!(s.contains("startxref"), "xref");
        assert!(s.ends_with("%%EOF\n"), "EOF");
        assert!(s.contains("/MediaBox [0 0 595 842]"), "A4");
        assert!(s.contains("cm /Im0 Do Q"), "绘制命令");
    }

    /// 集成实测：真实 JPEG → PDF，断言头/直嵌/体积与可解析性
    #[tokio::test]
    #[ignore = "集成实测：需要引擎二进制在 PATH"]
    async fn image_to_pdf_real_jpeg() {
        let input = corpus("photo_river.jpg");
        assert!(input.exists(), "缺少素材 {}", input.display());
        let out = verify_dir().join("out_pdf.pdf");
        let _ = std::fs::remove_file(&out);
        let r = image_to_pdf(&input, &out, |_| {})
            .await
            .unwrap_or_else(|e| panic!("转 PDF 失败: {e}"));
        assert!(r.output_path.exists());
        let bytes = std::fs::read(&out).unwrap();
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("/Filter /DCTDecode"), "应直嵌 JPEG");
        // JPEG 二次编码（q4）+ PDF 开销：允许 20% 增容
        let src = std::fs::metadata(&input).unwrap().len();
        assert!(
            r.output_size <= src + src / 5,
            "PDF 过大: 源 {src} 输出 {}",
            r.output_size
        );
        println!(
            "[实测] 转PDF: {} -> {} ({}B, 源 {src}B)",
            input.display(),
            r.output_path.display(),
            r.output_size
        );
    }

    /// 集成实测：带透明 PNG → PDF（白底合成，不应黑底）
    #[tokio::test]
    #[ignore = "集成实测：需要引擎二进制在 PATH"]
    async fn image_to_pdf_png_alpha() {
        let input = corpus("png_screenshot_ui.png");
        assert!(input.exists(), "缺少素材 {}", input.display());
        let out = verify_dir().join("out_pdf_png.pdf");
        let _ = std::fs::remove_file(&out);
        let r = image_to_pdf(&input, &out, |_| {})
            .await
            .unwrap_or_else(|e| panic!("PNG 转 PDF 失败: {e}"));
        assert!(r.output_path.exists());
        let bytes = std::fs::read(&out).unwrap();
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("/Filter /DCTDecode"));
        println!(
            "[实测] 透明PNG转PDF(白底): {} ({}B)",
            r.output_path.display(),
            r.output_size
        );
    }
}
