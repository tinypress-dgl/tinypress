use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AudioParams {
    pub codec: String,
    #[serde(rename = "bitrate_kbps")]
    pub bitrate_kbps: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoParams {
    pub codec: String,
    pub crf: f64,
    pub preset: String,
    pub level: Option<String>,
    pub keyint: Option<u32>,
    pub pix_fmt: Option<String>,
    pub audio: Option<AudioParams>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ImageParams {
    pub format: String,
    pub engine: String,
    pub quality: Option<u8>,
    #[serde(rename = "max_size_kb")]
    pub max_size_kb: Option<u64>,
    #[serde(rename = "strip_metadata")]
    pub strip_metadata: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub platform: String,
    /// "video" | "image"
    pub kind: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub constraints: Option<Value>,
    pub video: Option<VideoParams>,
    pub image: Option<ImageParams>,
    pub filters: Option<Value>,
    pub note: Option<String>,
}

/// 从内嵌 JSON 加载预设库。
/// 热更新：后续改为「先读 exe 旁 presets.json（存在则覆盖），否则回退内嵌」。
pub fn load() -> Vec<Preset> {
    let raw = include_str!("presets.json");
    let root: Value = serde_json::from_str(raw).expect("presets.json 解析失败");
    let arr = root
        .get("presets")
        .expect("presets.json 缺少 presets 数组")
        .clone();
    serde_json::from_value(arr).expect("presets.json 结构不合法")
}

// ===== 自定义预设（用户配置目录持久化） =====

/// 从自定义预设文件读取（文件不存在时返回空列表）
pub fn load_custom(file: &Path) -> Vec<Preset> {
    let raw = match std::fs::read_to_string(file) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let arr = match root.get("presets") {
        Some(a) => a.clone(),
        None => return Vec::new(),
    };
    serde_json::from_value(arr).unwrap_or_default()
}

/// 保存整个自定义预设列表（按 id 覆盖式写入，文件格式与内嵌一致）
pub fn save_custom(file: &Path, presets: &[Preset]) -> Result<(), String> {
    let payload = serde_json::json!({
        "schema_version": 1,
        "updated_at": "2026-09-15",
        "presets": presets,
    });
    let text = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    std::fs::write(file, text).map_err(|e| format!("写入自定义预设失败: {e}"))
}

/// 合并内置与自定义预设：自定义按 id 覆盖内置（同 id 时以自定义为准），
/// 其余自定义追加到列表末尾。
pub fn merge_with_custom(mut builtin: Vec<Preset>, custom: Vec<Preset>) -> Vec<Preset> {
    for cp in custom {
        if let Some(slot) = builtin.iter_mut().find(|p| p.id == cp.id) {
            *slot = cp;
        } else {
            builtin.push(cp);
        }
    }
    builtin
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_preset(id: &str, name: &str) -> Preset {
        Preset {
            id: id.into(),
            name: name.into(),
            platform: "custom".into(),
            kind: "video".into(),
            tags: vec!["custom".into()],
            constraints: None,
            video: Some(VideoParams {
                codec: "libx264".into(),
                crf: 23.5,
                preset: "slow".into(),
                level: None,
                keyint: None,
                pix_fmt: None,
                audio: None,
            }),
            image: None,
            filters: None,
            note: None,
        }
    }

    #[test]
    fn custom_presets_roundtrip() {
        let dir = std::env::temp_dir().join(format!("tp_custom_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("custom-presets.json");

        let p1 = sample_preset("custom-a", "预设A");
        presets_save(&file, &[p1.clone()]).unwrap();
        let loaded = load_custom(&file);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "custom-a");
        assert_eq!(loaded[0].name, "预设A");
        assert_eq!(loaded[0].video.as_ref().unwrap().crf, 23.5);

        // 覆盖保存：同 id 更新
        let p1v2 = sample_preset("custom-a", "预设A-改");
        presets_save(&file, &[p1v2]).unwrap();
        let loaded = load_custom(&file);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "预设A-改");

        let _ = std::fs::remove_dir_all(&dir);
    }

    // 复用同名函数避免与 commands 层耦合（save_custom 已 pub，直接调用）
    fn presets_save(file: &Path, list: &[Preset]) -> Result<(), String> {
        save_custom(file, list)
    }

    #[test]
    fn merge_custom_overrides_builtin() {
        let builtin = vec![sample_preset("bilibili-1080p", "内置"), sample_preset("x", "X")];
        let custom = vec![
            sample_preset("bilibili-1080p", "自定义覆盖"), // 同 id 覆盖
            sample_preset("custom-new", "新增"),
        ];
        let merged = merge_with_custom(builtin, custom);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].name, "自定义覆盖");
        assert_eq!(merged[2].id, "custom-new");
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = std::env::temp_dir().join(format!("tp_custom_missing_{}", std::process::id()));
        let file = dir.join("none.json");
        assert!(load_custom(&file).is_empty());
    }
}
