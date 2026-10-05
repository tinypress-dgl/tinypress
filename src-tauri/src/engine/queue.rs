use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// 任务重跑参数（持久化用：重启后 queued/cancelled 任务可原样重新提交）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobParams {
    pub preset_id: String,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub rename: Option<String>,
    #[serde(default)]
    pub edit: Option<crate::engine::video::EditOptions>,
    /// v0.3.0：图片批量编辑（尺寸/旋转/裁剪/水印）
    #[serde(default)]
    pub image_edit: Option<crate::engine::edit::ImageEditOptions>,
    /// v0.3.0：视频容器转换目标（mkv/avi/webm/mov/...）
    #[serde(default)]
    pub container: Option<String>,
    /// v0.3.0：音轨提取（mp3/wav）
    #[serde(default)]
    pub audio_only: Option<String>,
    /// v0.4.0：图片转 PDF
    #[serde(default)]
    pub pdf: bool,
    /// v0.5.0：PDF 瘦身质量（q:v 1-31，越小越清晰）
    #[serde(default)]
    pub pdf_slim: Option<u32>,
    /// v0.4.0：视频封面抽帧（时间点秒）
    #[serde(default)]
    pub cover_at: Option<f64>,
    /// v0.5.0：硬字幕烧录（.srt 路径），Some 时烧录进画面
    #[serde(default)]
    pub subtitle: Option<String>,
    /// v0.5.0：图片 OCR 识别文字（输出 .txt）
    #[serde(default)]
    pub ocr: bool,
    /// v0.4.0：输出替换源文件
    #[serde(default)]
    pub replace_source: bool,
}

/// 单个压缩任务的状态快照（与前端 types.ts 对齐，camelCase）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobState {
    pub id: String,
    pub input_path: String,
    pub preset_id: String,
    /// queued | running | done | error | cancelled
    pub status: String,
    pub progress: u8,
    pub input_size: u64,
    pub output_size: Option<u64>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    /// 非致命提示（如「输出比源大，源可能已是最优」），前端黄色展示
    #[serde(default)]
    pub warning: Option<String>,
    /// 重跑参数（持久化恢复用）
    #[serde(default)]
    pub params: Option<JobParams>,
}

impl JobState {
    pub fn new(
        id: String,
        input_path: String,
        preset_id: String,
        input_size: u64,
        params: JobParams,
    ) -> Self {
        Self {
            id,
            input_path,
            preset_id,
            status: "queued".into(),
            progress: 0,
            input_size,
            output_size: None,
            output_path: None,
            error: None,
            warning: None,
            params: Some(params),
        }
    }
}

/// 全局任务存储（进程内，骨架阶段不做持久化）
#[derive(Default)]
pub struct JobStore(pub Mutex<Vec<JobState>>);
