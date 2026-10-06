use std::path::{Path, PathBuf};

use tokio::process::Command;

use super::{BinaryLocator, Output};

/// v0.5.0：OCR 文字识别（Tesseract，全开源）。
/// 调用 `tesseract -l {lang} {input} stdout`，输出 .txt。
/// 语言包（chi_sim+eng）随包分发；未找到 tesseract 时给出清晰错误。
pub async fn ocr_image(
    input: &Path,
    output_txt: &Path,
    lang: &str,
    mut on_progress: impl FnMut(u8),
) -> Result<Output, String> {
    on_progress(10);
    let locator = BinaryLocator;
    let tesseract = locator
        .find("tesseract")
        .ok_or_else(|| "未找到 tesseract（OCR 引擎未随包安装）".to_string())?;
    let input_s = input.to_str().ok_or("路径非法")?;
    let lang = if lang.trim().is_empty() {
        "chi_sim+eng"
    } else {
        lang.trim()
    };

    // 预处理：放大 2 倍 + 灰度（tesseract 4.x 对小字/复杂背景敏感，放大显著提升召回）
    let mut target = input.to_path_buf();
    if let Some(ffmpeg) = locator.find("ffmpeg") {
        let tmp = output_txt
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!(
                ".tinypress_ocr_{}.png",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ));
        let st = Command::new(&ffmpeg)
            .args([
                "-y",
                "-i",
                input_s,
                "-vf",
                "scale=iw*2:ih*2:flags=lanczos,format=gray",
                "-q:v",
                "2",
                tmp.to_str().ok_or("路径非法")?,
            ])
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
        if st.success() {
            target = tmp;
        }
    }

    on_progress(30);
    // tessdata 随包分发：优先 tesseract 同目录的 tessdata/（bundled），否则用系统默认
    let mut args: Vec<String> = vec!["-l".into(), lang.into()];
    if let Some(td) = tesseract
        .parent()
        .map(|d| d.join("tessdata"))
        .filter(|d| d.join("chi_sim.traineddata").exists())
    {
        args.push("--tessdata-dir".into());
        args.push(td.to_string_lossy().into_owned());
    }
    args.push(target.to_string_lossy().into_owned());
    args.push("stdout".into());
    let out = Command::new(&tesseract)
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("启动 tesseract 失败: {e}"))?;
    if target != input.to_path_buf() {
        let _ = std::fs::remove_file(&target);
    }
    if !out.status.success() {
        return Err(format!(
            "OCR 失败退出码: {:?}（语言包是否缺失？）",
            out.status.code()
        ));
    }
    on_progress(80);
    let text = String::from_utf8_lossy(&out.stdout);
    if text.trim().is_empty() {
        return Err("未识别到文字（图片可能不含文字或过于模糊）".into());
    }
    std::fs::write(output_txt, text.as_bytes()).map_err(|e| format!("写 TXT 失败: {e}"))?;
    on_progress(100);
    let size = std::fs::metadata(output_txt)
        .map_err(|e| format!("读取 TXT 失败: {e}"))?
        .len();
    Ok(Output {
        output_path: output_txt.to_path_buf(),
        output_size: size,
        skipped: false,
    })
}

// 保持 PathBuf 导入被使用（路径返回类型）
#[allow(dead_code)]
fn _sig(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn verify_dir() -> PathBuf {
        Path::new("/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/verify")
            .to_path_buf()
    }

    /// 集成实测：带中文文字的图片 → OCR 提取出文字
    #[tokio::test]
    #[ignore = "集成实测：需要 tesseract 在 PATH"]
    async fn ocr_extracts_chinese_text() {
        // 素材：白底大字截图（模拟文档/截图场景，tesseract 4.x 适用域）
        let input = verify_dir().join("ocr_source.png");
        assert!(input.exists(), "缺少 OCR 素材 {}", input.display());
        let out = verify_dir().join("out_ocr.txt");
        let _ = std::fs::remove_file(&out);
        let r = ocr_image(&input, &out, "chi_sim+eng", |_| {})
            .await
            .unwrap_or_else(|e| panic!("OCR 失败: {e}"));
        assert!(r.output_path.exists());
        let text = std::fs::read_to_string(&out).unwrap();
        assert!(
            text.contains("TinyPress") && text.contains("OCR"),
            "应识别出文字，实际: {text}"
        );
        println!(
            "[实测] OCR: {} -> {} ({}B, {}字)",
            input.display(),
            r.output_path.display(),
            r.output_size,
            text.trim().chars().count()
        );
    }
}
