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
