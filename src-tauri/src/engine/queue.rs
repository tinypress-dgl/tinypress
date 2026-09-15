use std::sync::Mutex;

use serde::Serialize;

/// 单个压缩任务的状态快照（与前端 types.ts 对齐，camelCase）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobState {
    pub id: String,
    pub input_path: String,
    pub preset_id: String,
    /// queued | running | done | error
    pub status: String,
    pub progress: u8,
    pub input_size: u64,
    pub output_size: Option<u64>,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

impl JobState {
    pub fn new(id: String, input_path: String, preset_id: String, input_size: u64) -> Self {
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
        }
    }
}

/// 全局任务存储（进程内，骨架阶段不做持久化）
#[derive(Default)]
pub struct JobStore(pub Mutex<Vec<JobState>>);
