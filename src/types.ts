/** 与 src-tauri 侧 serde 结构一一对应（Rust 侧序列化为 camelCase，本文件使用 camelCase 字段） */

export type PresetKind = "video" | "image";

export interface VideoParams {
  codec: string; // libx264 | libx265 | libsvtav1 | h264_nvenc | hevc_nvenc | h264_qsv
  crf: number; // 对 NVENC 为 -cq，对 QSV 为 -global_quality
  preset: string; // x264 风格或 NVENC p1-p7
  level?: string;
  keyint?: number;
  pixFmt?: string;
  audio?: { codec: string; bitrate_kbps: number };
}

export interface ImageParams {
  format: string; // jpeg | png | webp | avif
  engine: string; // mozjpeg | pngquant | libwebp | libavif
  quality?: number;
  max_size_kb?: number;
  strip_metadata: boolean;
}

export interface Preset {
  id: string;
  name: string;
  platform: string;
  kind: PresetKind;
  tags: string[];
  constraints?: {
    max_bitrate_kbps?: number;
    max_size_kb?: number;
    max_resolution?: string;
    min_resolution?: string;
  };
  video?: VideoParams;
  image?: ImageParams;
  filters?: Record<string, unknown>;
  note?: string;
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface QueueItem {
  id: string;
  inputPath: string;
  name: string;
  presetId: string;
  status: JobStatus;
  progress: number; // 0-100
  inputSize: number; // bytes
  outputSize?: number;
  outputPath?: string;
  error?: string;
  /** 任务级编辑选项（截取/旋转/去黑边/裁剪） */
  edit?: EditOptions;
}

export interface ProgressEvent {
  jobId: string;
  progress: number;
}

export interface EngineInfo {
  ffmpegOk: boolean;
  ffmpegVersion?: string;
  engines: Record<string, boolean>; // mozjpeg / pngquant / libwebp / libavif
  hardware: {
    nvenc: boolean;
    qsv: boolean;
    videotoolbox: boolean;
  };
}

/** 应用设置（持久化到本地配置目录 settings.json） */
export interface AppSettings {
  outputDir?: string;
  renameTemplate?: string;
  watchDir?: string;
  watchPreset?: string;
}

/** 基础视频编辑选项（任务级，全部可选） */
export interface EditOptions {
  trimStart?: number; // 秒
  trimDuration?: number; // 秒（从 trimStart 起）
  rotate?: number; // 0/90/180/270 顺时针
  autocrop?: boolean; // 自动去黑边
  cropPercent?: number; // 居中裁剪百分比 0-100
}
