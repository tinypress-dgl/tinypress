use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::process::Command;

use super::{BinaryLocator, Output};

/// 音频转码/压缩（输入音频文件，输出 mp3/m4a/flac/ogg）。
/// 全开源 ffmpeg 实现；码率压缩、格式转换。bitrate=0 → 无损/不指定码率（FLAC）。
/// 保留给未来音频文件独立处理入口；当前 UI 仅视频页提供音轨提取（video::extract_audio）。
pub async fn transcode_audio(
    input: &Path,
    output: &Path,
    codec: &str,
    bitrate_kbps: u32,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u8),
) -> Result<Output, String> {
    on_progress(10);
    let ffmpeg = BinaryLocator
        .find("ffmpeg")
        .ok_or_else(|| "未找到 ffmpeg".to_string())?;
    let input_s = input.to_str().ok_or("路径非法")?;
    let output_s = output.to_str().ok_or("路径非法")?;

    // 扩展名 → 编码器映射
    let (enc, ext) = match codec {
        "mp3" | "libmp3lame" => ("libmp3lame", "mp3"),
        "aac" | "m4a" => ("aac", "m4a"),
        "flac" => ("flac", "flac"),
        "opus" | "ogg" => ("libopus", "ogg"),
        other => return Err(format!("不支持的音频编码器: {other}")),
    };
    if !output
        .to_string_lossy()
        .to_ascii_lowercase()
        .ends_with(&format!(".{ext}"))
    {
        return Err(format!("输出扩展名与编码器不匹配，应为 .{ext}"));
    }

    on_progress(30);
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-i".into(),
        input_s.into(),
        "-vn".into(),
        "-c:a".into(),
        enc.into(),
    ];
    // bitrate=0 → 无损/不指定码率（如 FLAC）
    if bitrate_kbps > 0 {
        args.push("-b:a".into());
        args.push(format!("{bitrate_kbps}k"));
    }
    args.push("-map_metadata".into());
    args.push("0".into());
    args.push(output_s.into());
    let status = Command::new(&ffmpeg)
        .args(&args)
        .status()
        .await
        .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
    if !status.success() {
        return Err(format!("音频转码失败，退出码: {:?}", status.code()));
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("已取消".to_string());
    }
    on_progress(90);
    let size = std::fs::metadata(output)
        .map_err(|e| format!("读取输出失败: {e}"))?
        .len();
    on_progress(100);
    Ok(Output {
        output_path: output.to_path_buf(),
        output_size: size,
        skipped: false,
    })
}

// 保持 PathBuf 导入被使用
#[allow(dead_code)]
fn _sig(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn verify_dir() -> PathBuf {
        Path::new("/home/user/Doubao/chats/38441761271276290/tinypress/.build/benchmark/verify")
            .to_path_buf()
    }

    /// 集成实测：音频转 MP3（从视频提取音轨 → 转码）
    #[tokio::test]
    #[ignore = "集成实测：需要 ffmpeg 在 PATH"]
    async fn audio_transcodes_to_mp3() {
        // 素材：从测试视频提取的原始音轨（wav）
        let input = verify_dir().join("audio_src.wav");
        if !input.exists() {
            // 现场生成：从 bbb_with_audio.mp4（带音轨素材）提取 5s 音频
            let ffmpeg = BinaryLocator.find("ffmpeg").unwrap();
            let src = verify_dir().join("bbb_with_audio.mp4");
            let status = if src.exists() {
                Command::new(&ffmpeg)
                    .args([
                        "-hide_banner",
                        "-y",
                        "-i",
                        src.to_str().unwrap(),
                        "-t",
                        "5",
                        "-vn",
                        "-c:a",
                        "pcm_s16le",
                        input.to_str().unwrap(),
                    ])
                    .status()
                    .await
                    .unwrap()
            } else {
                Command::new(&ffmpeg)
                    .args([
                        "-hide_banner",
                        "-y",
                        "-f",
                        "lavfi",
                        "-i",
                        "sine=frequency=440:duration=5",
                        "-c:a",
                        "pcm_s16le",
                        input.to_str().unwrap(),
                    ])
                    .status()
                    .await
                    .unwrap()
            };
            assert!(status.success(), "生成音频素材失败");
        }
        let out = verify_dir().join("out_audio.mp3");
        let _ = std::fs::remove_file(&out);
        let cancel = AtomicBool::new(false);
        let r = transcode_audio(&input, &out, "mp3", 128, &cancel, |_| {})
            .await
            .unwrap_or_else(|e| panic!("音频转码失败: {e}"));
        assert!(r.output_path.exists());
        assert!(r.output_size > 0, "输出为空");
        println!(
            "[实测] 音频: {} -> {} ({}B)",
            input.display(),
            r.output_path.display(),
            r.output_size
        );
    }
}
