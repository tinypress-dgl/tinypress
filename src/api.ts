import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppSettings,
  EditOptions,
  EngineInfo,
  Preset,
  ProgressEvent,
  QueueItem,
} from "./types";

/** 列出全部预设（内置 + 自定义，自定义按 id 覆盖内置） */
export function listPresets(): Promise<Preset[]> {
  return invoke<Preset[]>("list_presets");
}

/** 保存/更新一个自定义预设（id 以 custom- 前缀，按 id 覆盖） */
export function saveCustomPreset(preset: Preset): Promise<void> {
  return invoke("save_custom_preset", { preset });
}

/** 删除自定义预设（内置预设 id 会被后端忽略） */
export function deleteCustomPreset(id: string): Promise<void> {
  return invoke("delete_custom_preset", { id });
}

/** 读取应用设置（输出目录/命名模板/监控配置） */
export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

/** 保存应用设置（防抖后整体覆盖） */
export function saveSettings(settings: AppSettings): Promise<void> {
  return invoke("save_settings", { settings });
}

/** 应用当前版本 */
export function getAppVersion(): Promise<string> {
  return invoke<string>("get_app_version");
}

/** 原生文件夹选择对话框；用户取消时返回 null */
export function pickOutputDir(): Promise<string | null> {
  return invoke<string | null>("pick_output_dir");
}

/** 更新源配置（update-config.json 的 updateUrl；未配置 = undefined） */
export function checkUpdate(): Promise<{ current: string; updateUrl?: string }> {
  return invoke("check_update");
}

export interface CompressItem {
  inputPath: string;
  presetId: string;
  /** 输出目录，缺省 = 输入文件同目录 */
  outputDir?: string;
  /** 命名模板，缺省 `{name}.{kind}`（原名.video.mp4） */
  rename?: string;
  /** 基础编辑（截取/旋转/去黑边/裁剪） */
  edit?: EditOptions;
}

export interface CompressRequest {
  items: CompressItem[];
}

/** 提交压缩任务，返回任务队列快照 */
export function compressFiles(req: CompressRequest): Promise<QueueItem[]> {
  return invoke<QueueItem[]>("compress_files", { request: req });
}

/** 文件夹监控配置（目录 + 预设 + 输出目录 + 命名模板） */
export interface WatchRequest {
  dir: string;
  presetId: string;
  outputDir?: string;
  rename?: string;
}

export interface WatchStatus {
  running: boolean;
}

/** 启动文件夹监控（新文件自动按指定预设压缩） */
export function startWatch(req: WatchRequest): Promise<void> {
  return invoke("start_watch", { request: req });
}

/** 停止文件夹监控（进行中的任务继续跑完） */
export function stopWatch(): Promise<void> {
  return invoke("stop_watch");
}

/** 查询监控运行状态 */
export function getWatchStatus(): Promise<WatchStatus> {
  return invoke("get_watch_status");
}

export function getEngineInfo(): Promise<EngineInfo> {
  return invoke<EngineInfo>("get_engine_info");
}

/** 订阅压缩进度（jobId + progress） */
export async function onProgress(
  cb: (ev: ProgressEvent) => void
): Promise<() => void> {
  return listen<ProgressEvent>("compress_progress", (e) => cb(e.payload));
}

/** 订阅压缩完成/失败 */
export async function onJobDone(
  cb: (item: QueueItem) => void
): Promise<() => void> {
  return listen<QueueItem>("compress_done", (e) => cb(e.payload));
}

/** 窗口级拖放事件：phase 区分 enter/over/leave/drop，drop 时返回落盘文件路径列表 */
export async function onFilesDropped(
  cb: (phase: DragDropPhase, paths?: string[]) => void
): Promise<() => void> {
  return getCurrentWindow().onDragDropEvent((event) => {
    const type = event.payload.type;
    cb(type, type === "drop" ? event.payload.paths : undefined);
  });
}

export type DragDropPhase = "enter" | "over" | "drop" | "leave";

/** 打开文件所在目录（骨架阶段预留，P1 实现） */
export function revealInFolder(_path: string): Promise<void> {
  return invoke("reveal_in_folder", { path: _path });
}
