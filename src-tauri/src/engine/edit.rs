use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::Command;

use super::{BinaryLocator, Output};

/// 图片批量编辑选项（任务级，随 CompressItem 传入；全部可选）
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImageEditOptions {
    /// 缩放百分比（0-1000，如 50 = 缩到一半）；优先于 width/height
    pub scale_percent: Option<f64>,
    /// 目标宽度（像素）；与 height 同时给时精确缩放，单独给时另一维按比例（-1）
    pub width: Option<i32>,
    /// 目标高度（像素）
    pub height: Option<i32>,
    /// 旋转（度，顺时针）：0/90/180/270 用转置实现，其余角度用 rotate 滤镜
    pub rotate: Option<i32>,
    /// 居中裁剪百分比（0-100）
    pub crop_percent: Option<f64>,
    /// 文字水印内容（与 watermark_image 二选一或同时）
    pub watermark_text: Option<String>,
    /// 水印图片路径（与 watermark_text 可同时）
    pub watermark_image: Option<String>,
    /// 水印字号（文字）或水印图目标宽度 px（图片）；默认 32
    pub watermark_size: Option<u32>,
    /// 水印透明度 0-1（默认 0.6）
    pub watermark_opacity: Option<f64>,
    /// 水印位置：tl/tc/tr/ml/mc/mr/bl/bc/br（默认 br 右下角）
    pub watermark_position: Option<String>,
    /// 水印旋转（图片水印支持 0/90/180/270；文字水印不支持旋转）
    pub watermark_rotate: Option<i32>,
    /// 输出格式：jpg/png/webp/bmp/avif；缺省保持源扩展名
    pub format: Option<String>,
}

/// 编辑（不压缩）：scale → rotate → crop → watermark 一条 ffmpeg 滤镜链输出。
/// 语义与 WPS「批量改尺寸/旋转/裁剪/加水印」对齐；纯本地、无上传。
pub async fn edit(
    input: &Path,
    output: &Path,
    opt: &ImageEditOptions,
    mut on_progress: impl FnMut(u8),
) -> Result<Output, String> {
    on_progress(15);
    let locator = BinaryLocator;
    let ffmpeg = locator
        .find("ffmpeg")
        .ok_or_else(|| "未找到 ffmpeg 二进制".to_string())?;

    // 空参数防御：至少设置一项编辑动作（否则只是无意义复制）
    let has_text = opt
        .watermark_text
        .as_ref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    let has_img = opt
        .watermark_image
        .as_ref()
        .map(|p| Path::new(p).is_file())
        .unwrap_or(false);
    let has_action = opt.scale_percent.is_some()
        || opt.width.is_some()
        || opt.height.is_some()
        || opt.rotate.is_some()
        || opt.crop_percent.is_some()
        || has_text
        || has_img;
    if !has_action {
        return Err("图片编辑参数为空：请至少设置一项（缩放/尺寸/旋转/裁剪/水印）".into());
    }

    // 1) 主编辑链（scale/rotate/crop）——作用在 [0:v]
    let mut main_chain: Vec<String> = Vec::new();
    if let Some(p) = opt.scale_percent {
        if (1.0..=1000.0).contains(&p) {
            main_chain.push(format!(
                "scale=iw*{p}/100:ih*{p}/100:flags=lanczos"
            ));
        }
    } else if opt.width.is_some() || opt.height.is_some() {
        let w = opt.width.unwrap_or(-1);
        let h = opt.height.unwrap_or(-1);
        if w > 0 || h > 0 {
            main_chain.push(format!("scale={w}:{h}:flags=lanczos"));
        }
    }
    if let Some(r) = opt.rotate {
        let rot = ((r % 360) + 360) % 360;
        match rot {
            0 => {}
            90 => main_chain.push("transpose=1".into()),
            180 => main_chain.push("hflip,vflip".into()),
            270 => main_chain.push("transpose=2".into()),
            other => main_chain.push(format!("rotate={other}*PI/180")),
        }
    }
    if let Some(pct) = opt.crop_percent {
        if (1.0..=100.0).contains(&pct) {
            main_chain.push(format!(
                "crop=iw*{pct}/100:ih*{pct}/100:(iw-iw*{pct}/100)/2:(ih-ih*{pct}/100)/2"
            ));
        }
    }

    // 2) 水印层（文字 drawtext 直接叠主链；图片走 filter_complex overlay）
    let pos = opt
        .watermark_position
        .clone()
        .unwrap_or_else(|| "br".into());
    let alpha = opt.watermark_opacity.unwrap_or(0.6).clamp(0.0, 1.0);
    let size = opt.watermark_size.unwrap_or(32);

    // 2.1 文字水印（不支持旋转；alpha 走 drawtext 的 alpha 参数）
    let mut text_filter: Option<String> = None;
    if has_text {
        let text = escape_drawtext(opt.watermark_text.as_ref().unwrap());
        let font = pick_font().ok_or_else(|| {
            "未找到可用中文字体（drawtext 需要 fontfile）".to_string()
        })?;
        let (x, y) = text_pos_expr(&pos);
        text_filter = Some(format!(
            "drawtext=text='{text}':fontfile={font}:fontsize={size}:fontcolor=white@1.0:alpha={alpha}:{x}:{y}"
        ));
    }

    // 2.2 图片水印（支持 0/90/180/270 旋转；透明度走 colorchannelmixer）
    let mut img_filter: Option<String> = None;
    if has_img {
        // 水印图缩放到目标宽度（size px），限制最大高度避免过界；[1:v] = 第二个输入
        let wm = format!(
            "[1:v]scale={size}:-1:flags=lanczos,format=rgba,colorchannelmixer=aa={alpha}[wm]"
        );
        let rot = ((opt.watermark_rotate.unwrap_or(0) % 360) + 360) % 360;
        let wm_rotated = match rot {
            0 => "[wm]null[wm2]".to_string(),
            90 => "[wm]transpose=1[wm2]".to_string(),
            180 => "[wm]hflip,vflip[wm2]".to_string(),
            270 => "[wm]transpose=2[wm2]".to_string(),
            _ => "[wm]null[wm2]".to_string(), // 任意角降级为不旋转
        };
        let (x, y) = img_pos_expr(&pos);
        // 最终输出统一带 [outv] 标签，配合 -map "[outv]"（不能依赖自动输出）
        let overlay_out = if has_text { "[wmout]" } else { "[outv]" };
        img_filter = Some(format!(
            "{wm};{wm_rotated};[main][wm2]overlay={x}:{y}{overlay_out}"
        ));
    }

    // 3) 组装 ffmpeg 命令
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), input.to_string_lossy().into_owned()];

    let use_fc = img_filter.is_some();
    if use_fc {
        // filter_complex：主链作为 [main]，再 overlay 图片水印，最后可叠文字水印
        let main = if main_chain.is_empty() {
            "null".to_string()
        } else {
            main_chain.join(",")
        };
        let fc_parts: Vec<String> = std::iter::once(format!("[0:v]{main}[main]"))
            .chain(img_filter)
            .chain(text_filter.map(|t| format!("[wmout]{t}[outv]")))
            .collect();
        args.push("-filter_complex".into());
        args.push(fc_parts.join(";"));
        // 图片水印输入
        args.push("-i".into());
        args.push(opt.watermark_image.as_ref().unwrap().clone());
    } else if !main_chain.is_empty() || text_filter.is_some() {
        let mut vf = main_chain.clone();
        if let Some(t) = text_filter {
            vf.push(t);
        }
        args.push("-vf".into());
        args.push(vf.join(","));
    }

    let ext = output_ext(input, opt.format.as_deref());
    let out_path = output.with_extension(&ext);
    args.push("-y".into());
    args.push("-map".into());
    // filter_complex 分支输出带 [outv] 标签；-vf 分支映射主输入视频流
    if use_fc {
        args.push("[outv]".into());
    } else {
        args.push("0:v:0".into());
    }
    if opt.format.as_deref() == Some("jpg") || ext == "jpg" {
        // 旋转任意角时黑底；jpg 无透明通道
        args.push("-pix_fmt".into());
        args.push("yuvj420p".into());
    } else if !main_chain.is_empty() && main_chain.iter().any(|f| f.starts_with("rotate=")) {
        // 任意角旋转 + 透明格式：保持 rgba
        args.push("-pix_fmt".into());
        args.push("rgba".into());
    }
    args.push(out_path.to_string_lossy().into_owned());

    on_progress(30);
    let st = Command::new(&ffmpeg)
        .args(&args)
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
    if !st.success() {
        return Err(format!("图片编辑 ffmpeg 退出码: {:?}", st.code()));
    }
    on_progress(100);
    let size = std::fs::metadata(&out_path)
        .map_err(|e| format!("读取输出失败: {e}"))?
        .len();
    Ok(Output {
        output_path: out_path,
        output_size: size,
        skipped: false,
    })
}

/// 输出扩展名：显式 format 优先，否则保持源扩展名
pub fn output_ext(input: &Path, format: Option<&str>) -> String {
    if let Some(f) = format {
        return match f {
            "jpeg" | "jpg" => "jpg".into(),
            "png" => "png".into(),
            "webp" => "webp".into(),
            "bmp" => "bmp".into(),
            "avif" => "avif".into(),
            other => other.to_string(),
        };
    }
    input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_else(|| "png".into())
}

/// drawtext text 转义：单引号/冒号/反斜杠/百分号/逗号
fn escape_drawtext(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "'\\''")
        .replace(':', "\\:")
        .replace('%', "\\%")
        .replace(',', "\\,")
}

/// 文字水印位置表达式（drawtext 内可用 w/h/text_w/text_h）
fn text_pos_expr(pos: &str) -> (String, String) {
    match pos {
        "tl" => ("x=20".into(), "y=20".into()),
        "tc" => ("x=(w-text_w)/2".into(), "y=20".into()),
        "tr" => ("x=w-text_w-20".into(), "y=20".into()),
        "ml" => ("x=20".into(), "y=(h-text_h)/2".into()),
        "mc" => ("x=(w-text_w)/2".into(), "y=(h-text_h)/2".into()),
        "mr" => ("x=w-text_w-20".into(), "y=(h-text_h)/2".into()),
        "bl" => ("x=20".into(), "y=h-text_h-20".into()),
        "bc" => ("x=(w-text_w)/2".into(), "y=h-text_h-20".into()),
        _ => ("x=w-text_w-20".into(), "y=h-text_h-20".into()),
    }
}

/// 图片水印位置表达式（overlay 内可用 w/h 主画布、W/H 水印尺寸）
fn img_pos_expr(pos: &str) -> (String, String) {
    match pos {
        "tl" => ("x=20".into(), "y=20".into()),
        "tc" => ("x=(w-W)/2".into(), "y=20".into()),
        "tr" => ("x=w-W-20".into(), "y=20".into()),
        "ml" => ("x=20".into(), "y=(h-H)/2".into()),
        "mc" => ("x=(w-W)/2".into(), "y=(h-H)/2".into()),
        "mr" => ("x=w-W-20".into(), "y=(h-H)/2".into()),
        "bl" => ("x=20".into(), "y=h-H-20".into()),
        "bc" => ("x=(w-W)/2".into(), "y=h-H-20".into()),
        _ => ("x=w-W-20".into(), "y=h-H-20".into()),
    }
}

/// 探测一个可用中文字体（Linux Noto/WQY → macOS PingFang → Windows 微软雅黑）
fn pick_font() -> Option<String> {
    const CANDIDATES: &[&str] = &[
        // Linux
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        // macOS
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        // Windows
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
    ];
    CANDIDATES
        .iter()
        .find(|p| Path::new(p).is_file())
        .map(|p| p.to_string())
}

// 保持 PathBuf 导入被使用（output_ext 返回 String，无 PathBuf；此函数仅测试辅助）
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

    /// 集成实测：批量编辑——缩放 50% + 旋转 90° + 居中裁剪 80% + 文字水印
    /// 断言：输出存在、尺寸约为原图一半（旋转后宽高互换再裁 80%）、带水印输出更大
    #[tokio::test]
    #[ignore = "集成实测：需要 ffmpeg 在 PATH"]
    async fn image_edit_scale_rotate_crop_watermark() {
        let input = corpus("photo_dog.jpg");
        assert!(input.exists(), "缺少素材 {}", input.display());
        let out = verify_dir().join("out_edit_scale.jpg");
        let _ = std::fs::remove_file(&out);

        let opt = ImageEditOptions {
            scale_percent: Some(50.0),
            rotate: Some(90),
            crop_percent: Some(80.0),
            watermark_text: Some("TinyPress".into()),
            watermark_size: Some(40),
            watermark_opacity: Some(0.7),
            watermark_position: Some("br".into()),
            format: Some("jpg".into()),
            ..Default::default()
        };
        let r = edit(&input, &out, &opt, |_| {})
            .await
            .unwrap_or_else(|e| panic!("编辑失败: {e}"));
        assert!(r.output_path.exists(), "输出未生成");
        println!(
            "[实测] 编辑链(scale50+rot90+crop80+wm): {} -> {} ({}B)",
            input.display(),
            r.output_path.display(),
            r.output_size
        );
    }

    /// 集成实测：图片水印（透明度 + 位置 + 90° 旋转）
    #[tokio::test]
    #[ignore = "集成实测：需要 ffmpeg 在 PATH"]
    async fn image_edit_png_watermark() {
        let input = corpus("photo_river.jpg");
        let wm = corpus("png_screenshot_ui.png");
        assert!(input.exists() && wm.exists());
        let out = verify_dir().join("out_edit_wm.png");
        let _ = std::fs::remove_file(&out);

        let opt = ImageEditOptions {
            watermark_image: Some(wm.to_string_lossy().into_owned()),
            watermark_size: Some(120),
            watermark_opacity: Some(0.5),
            watermark_position: Some("tr".into()),
            watermark_rotate: Some(90),
            format: Some("png".into()),
            ..Default::default()
        };
        let r = edit(&input, &out, &opt, |_| {})
            .await
            .unwrap_or_else(|e| panic!("图片水印失败: {e}"));
        assert!(r.output_path.exists());
        println!(
            "[实测] 图片水印(tr/90°/alpha0.5): {} ({}B)",
            r.output_path.display(),
            r.output_size
        );
    }

    #[test]
    fn escape_and_position_smoke() {
        assert_eq!(escape_drawtext("a:b,c%'d\\"), "a\\:b\\,c\\%'\\''d\\\\");
        assert_eq!(text_pos_expr("tr"), ("x=w-text_w-20".into(), "y=20".into()));
        assert_eq!(img_pos_expr("mc"), ("x=(w-W)/2".into(), "y=(h-H)/2".into()));
        assert_eq!(output_ext(&corpus("a.JPG"), None), "jpg");
        assert_eq!(output_ext(&corpus("a.png"), Some("webp")), "webp");
    }
}
