import { useSyncExternalStore } from "react";

/**
 * v0.6.0 多语言系统：
 *  - 语言值：system（跟随系统）/ zh / en
 *  - 跟随系统时按 navigator.language 前缀判断（zh* → 中文，其余 → English）
 *  - 设置变化通过 setLang 通知，组件用 useLang() 订阅重渲染
 */

export type LangPref = "system" | "zh" | "en";
export type Lang = "zh" | "en";

let pref: LangPref = "system";

function systemLang(): Lang {
  try {
    const nav = navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage || "";
    return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}

export function resolveLang(p: LangPref): Lang {
  return p === "system" ? systemLang() : p;
}

const listeners = new Set<() => void>();

export function setLang(p: LangPref): void {
  pref = p;
  listeners.forEach((fn) => fn());
}

export function getPref(): LangPref {
  return pref;
}

export function getLang(): Lang {
  return resolveLang(pref);
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getLang
  );
}

type Dict = Record<string, { zh: string; en: string }>;

const d: Dict = {
  // ===== 通用 =====
  "common.collapse": { zh: "收起 ▲", en: "Collapse ▲" },
  "common.expand": { zh: "展开 ▼", en: "Expand ▼" },
  "common.close": { zh: "关闭", en: "Close" },
  "common.choose": { zh: "选择…", en: "Choose…" },
  "common.cancel": { zh: "取消", en: "Cancel" },
  "common.done": { zh: "完成", en: "Done" },
  "common.edit": { zh: "编辑", en: "Edit" },
  "common.delete": { zh: "删除", en: "Delete" },
  "common.save": { zh: "保存", en: "Save" },
  "common.saved": { zh: "已保存", en: "Saved" },
  "common.localOnly": { zh: "本地处理 · 不上传", en: "Local only · No upload" },

  // ===== App 顶栏 =====
  "app.title": { zh: "TinyPress 速压", en: "TinyPress" },
  "app.engineReady": {
    zh: "图片引擎 {n}/4 就绪",
    en: "Image engines {n}/4 ready",
  },
  "app.ffmpegMissing": { zh: "⚠ FFmpeg 未就绪，请检查依赖", en: "⚠ FFmpeg unavailable, check dependencies" },
  "app.engineChecking": { zh: "引擎检测中…", en: "Checking engines…" },
  "app.hwNvenc": { zh: "NVENC 可用", en: "NVENC ready" },
  "app.hwQsv": { zh: "QSV 可用", en: "QSV ready" },
  "app.hwVtb": { zh: "VideoToolbox 可用", en: "VideoToolbox ready" },
  "app.tasksRunning": { zh: "{n} 个任务进行中", en: "{n} tasks running" },
  "app.checkUpdate": { zh: "检查更新", en: "Check update" },
  "app.updateInfo": {
    zh: "TinyPress 当前版本 {v}\n更新/下载页：\n{u}",
    en: "TinyPress current version {v}\nUpdate / download:\n{u}",
  },
  "app.updateLatest": { zh: "TinyPress {v} —— 当前为最新版本", en: "TinyPress {v} — you are up to date" },
  "app.updateFailed": { zh: "检查更新失败：{e}", en: "Update check failed: {e}" },
  "app.startCompress": {
    zh: "开始压缩（{n}）—— 可先点队列项的「编辑」调整截取/旋转/去黑边",
    en: "Start compression ({n}) — click an item to edit trim/rotate/crop first",
  },
  "app.watchFailed": { zh: "启动监控失败：{e}", en: "Failed to start watcher: {e}" },
  "app.tabImages": { zh: "图片", en: "Images" },
  "app.tabVideos": { zh: "视频", en: "Videos" },
  "app.tabAudio": { zh: "音频", en: "Audio" },
  "app.tabAll": { zh: "全部任务", en: "All tasks" },

  // ===== 输出路径 =====
  "out.title": { zh: "处理后文件保存到", en: "Save output to" },
  "out.sourceDir": { zh: "源文件所在目录", en: "Source file folder" },
  "out.customDir": { zh: "自定义目录", en: "Custom folder" },
  "out.pick": { zh: "选择目录…", en: "Pick folder…" },
  "out.current": { zh: "当前输出目录：{p}", en: "Output folder: {p}" },
  "out.sourceHint": { zh: "输出文件与源文件放在同一目录（原名后缀标记）", en: "Output files are saved next to the source files (with suffix)" },

  // ===== 设置面板 =====
  "settings.title": { zh: "⚙ 输出与自动压缩设置", en: "⚙ Output & Auto-compress Settings" },
  "settings.language": { zh: "界面语言", en: "Language" },
  "settings.langSystem": { zh: "跟随系统", en: "Follow system" },
  "settings.langZh": { zh: "简体中文", en: "Chinese (Simplified)" },
  "settings.langEn": { zh: "English", en: "English" },
  "settings.outputDir": { zh: "输出目录（留空 = 与源文件同目录）", en: "Output directory (empty = same folder as source)" },
  "settings.renameTemplate": {
    zh: "命名模板（支持 {name} {kind} {ext}，缺省 {name}.{kind}）",
    en: "Name template ({name} {kind} {ext}, default {name}.{kind})",
  },
  "settings.folderPicker": { zh: "打开文件夹选择器", en: "Open folder picker" },
  "settings.watchTitle": { zh: "文件夹监控：新文件自动压缩", en: "Folder watch: auto-compress new files" },
  "settings.watchRunning": { zh: "监控中", en: "Watching" },
  "settings.watchStopped": { zh: "未运行", en: "Stopped" },
  "settings.watchDir": { zh: "监控目录", en: "Watch folder" },
  "settings.watchPreset": { zh: "使用的预设", en: "Preset to use" },
  "settings.stopWatch": { zh: "停止监控", en: "Stop watch" },
  "settings.startWatch": { zh: "启动监控", en: "Start watch" },
  "settings.watchHint": {
    zh: "监控目录内新增的图片/视频将自动按所选预设压缩；启动前已存在的文件不会重复处理。",
    en: "New images/videos in the watch folder are compressed automatically with the selected preset; files already present at startup are skipped.",
  },

  // ===== 预设管理器 =====
  "pe.title": { zh: "✎ 预设管理器（{n} 个自定义）", en: "✎ Preset Manager ({n} custom)" },
  "pe.newVideo": { zh: "+ 新建视频预设", en: "+ New video preset" },
  "pe.newImage": { zh: "+ 新建图片预设", en: "+ New image preset" },
  "pe.nameRequired": { zh: "请填写预设名称", en: "Preset name is required" },
  "pe.saveFailed": { zh: "保存失败：{e}", en: "Save failed: {e}" },
  "pe.deleteFailed": { zh: "删除失败：{e}", en: "Delete failed: {e}" },
  "pe.confirmDelete": { zh: "删除自定义预设「{n}」？", en: "Delete custom preset “{n}”?" },
  "pe.editPreset": { zh: "编辑预设", en: "Edit preset" },
  "pe.newPreset": { zh: "新建预设", en: "New preset" },
  "pe.kindVideo": { zh: "视频", en: "Video" },
  "pe.kindImage": { zh: "图片", en: "Image" },
  "pe.nameLabel": { zh: "预设名称 *", en: "Preset name *" },
  "pe.platformLabel": { zh: "平台标签", en: "Platform tag" },
  "pe.noteLabel": { zh: "备注（可选）", en: "Note (optional)" },
  "pe.codecLabel": { zh: "编码器", en: "Encoder" },
  "pe.codecX264": { zh: "libx264（软件·兼容最好）", en: "libx264 (software, best compatibility)" },
  "pe.codecX265": { zh: "libx265（软件·HEVC）", en: "libx265 (software, HEVC)" },
  "pe.codecAv1": { zh: "libsvtav1（软件·AV1）", en: "libsvtav1 (software, AV1)" },
  "pe.codecNvencH264": { zh: "h264_nvenc（N卡硬编）", en: "h264_nvenc (NVIDIA HW)" },
  "pe.codecNvencHevc": { zh: "hevc_nvenc（N卡硬编 HEVC）", en: "hevc_nvenc (NVIDIA HW HEVC)" },
  "pe.codecQsvH264": { zh: "h264_qsv（Intel 核显）", en: "h264_qsv (Intel iGPU)" },
  "pe.codecQsvHevc": { zh: "hevc_qsv（Intel 核显 HEVC）", en: "hevc_qsv (Intel iGPU HEVC)" },
  "pe.codecVtbH264": { zh: "h264_videotoolbox（macOS 硬编）", en: "h264_videotoolbox (macOS HW)" },
  "pe.codecVtbHevc": { zh: "hevc_videotoolbox（macOS 硬编 HEVC）", en: "hevc_videotoolbox (macOS HW HEVC)" },
  "pe.crfLabel": { zh: "CRF / CQ（NVENC 用 -cq，QSV 用 -global_quality）", en: "CRF / CQ (NVENC: -cq, QSV: -global_quality)" },
  "pe.presetLabel": { zh: "编码速度 preset", en: "Encoder speed preset" },
  "pe.scaleLabel": { zh: "分辨率上限（如 1920:-2）", en: "Max resolution (e.g. 1920:-2)" },
  "pe.keyintLabel": { zh: "GOP 关键帧间隔（可选）", en: "GOP keyframe interval (optional)" },
  "pe.audioLabel": { zh: "音频码率 kbps（留空 = 去音频）", en: "Audio bitrate kbps (empty = drop audio)" },
  "pe.maxBitrateLabel": { zh: "最大码率 kbps（可选）", en: "Max bitrate kbps (optional)" },
  "pe.levelLabel": { zh: "H.264 level（可选）", en: "H.264 level (optional)" },
  "pe.formatLabel": { zh: "输出格式", en: "Output format" },
  "pe.engineLabel": { zh: "压缩引擎", en: "Compression engine" },
  "pe.engineMozjpeg": { zh: "mozjpeg（JPEG）", en: "mozjpeg (JPEG)" },
  "pe.enginePngquant": { zh: "pngquant（PNG）", en: "pngquant (PNG)" },
  "pe.engineWebp": { zh: "libwebp（WebP）", en: "libwebp (WebP)" },
  "pe.engineAvif": { zh: "libavif（AVIF）", en: "libavif (AVIF)" },
  "pe.qualityLabel": { zh: "质量（可选，0-100）", en: "Quality (optional, 0-100)" },
  "pe.maxSizeLabel": { zh: "体积上限 KB（可选）", en: "Max size KB (optional)" },
  "pe.stripMetaLabel": { zh: "去除元数据", en: "Strip metadata" },
  "pe.stripMetaHint": { zh: "压缩时剥离 EXIF 等元数据（更小体积）", en: "Strip EXIF and other metadata during compression (smaller files)" },
  "pe.saving": { zh: "保存中…", en: "Saving…" },
  "pe.savePreset": { zh: "保存预设", en: "Save preset" },
  "pe.customHint": { zh: "自定义预设保存到本地配置目录，不随安装包分发", en: "Custom presets are stored in the local config folder and not shipped with the installer" },
  "pe.fillFromPreset": { zh: "从平台预设快速填充", en: "Fill from platform preset" },
  "pe.fillPlaceholder": { zh: "选择内置预设（参数自动填入，可再修改保存）", en: "Pick a built-in preset (params auto-filled, editable)" },

  // ===== 批处理面板 =====
  "batch.title": { zh: "批量处理工具箱", en: "Batch Toolbox" },
  "batch.subtitle": { zh: "对队列中的全部任务统一生效 · 本地处理不上传", en: "Applies to all tasks in the queue · Local only" },
  "batch.enable": { zh: "启用批处理", en: "Enable batch" },
  "batch.disable": { zh: "关闭批处理", en: "Disable batch" },
  "batch.imageTitle": { zh: "图片批量编辑", en: "Image Batch Edit" },
  "batch.toPdf": { zh: "转 PDF", en: "To PDF" },
  "batch.ocr": { zh: "OCR 识别文字", en: "OCR Text" },
  "batch.pdfHint": { zh: "转 PDF 开启：全部图片任务输出单页 PDF（JPEG 直嵌，A4 适配），编辑参数不生效", en: "To PDF: all image tasks output single-page PDFs (JPEG embedded, A4-fit); edit options ignored" },
  "batch.ocrHint": { zh: "OCR 开启：全部图片任务识别文字并输出 .txt（本地 Tesseract，中文+英文）", en: "OCR: all image tasks extract text to .txt (local Tesseract, Chinese + English)" },
  "batch.scalePercent": { zh: "缩放 %", en: "Scale %" },
  "batch.width": { zh: "宽度 px", en: "Width px" },
  "batch.height": { zh: "高度 px", en: "Height px" },
  "batch.rotate": { zh: "旋转 °", en: "Rotate °" },
  "batch.cropPercent": { zh: "裁剪 %", en: "Crop %" },
  "batch.watermark": { zh: "水印", en: "Watermark" },
  "batch.wmText": { zh: "文字水印", en: "Text watermark" },
  "batch.wmImage": { zh: "水印图片", en: "Watermark image" },
  "batch.wmPick": { zh: "选择 PNG/水印图", en: "Pick PNG/watermark" },
  "batch.opacity": { zh: "透明度 {p}%", en: "Opacity {p}%" },
  "batch.position": { zh: "位置", en: "Position" },
  "batch.posTl": { zh: "左上", en: "Top-left" },
  "batch.posTc": { zh: "顶部居中", en: "Top-center" },
  "batch.posTr": { zh: "右上", en: "Top-right" },
  "batch.posMl": { zh: "左中", en: "Middle-left" },
  "batch.posMc": { zh: "正中", en: "Center" },
  "batch.posMr": { zh: "右中", en: "Middle-right" },
  "batch.posBl": { zh: "左下", en: "Bottom-left" },
  "batch.posBc": { zh: "底部居中", en: "Bottom-center" },
  "batch.posBr": { zh: "右下", en: "Bottom-right" },
  "batch.outFormat": { zh: "输出格式", en: "Output format" },
  "batch.keepFormat": { zh: "保持源格式", en: "Keep source format" },
  "batch.videoTitle": { zh: "视频批量处理", en: "Video Batch" },
  "batch.coverFrame": { zh: "封面抽帧", en: "Cover frame" },
  "batch.container": { zh: "容器转换", en: "Container convert" },
  "batch.noContainer": { zh: "不转换容器", en: "No container change" },
  "batch.audioExtract": { zh: "音轨提取", en: "Extract audio" },
  "batch.noAudio": { zh: "不提取音轨", en: "No audio extract" },
  "batch.audioMp3": { zh: "提取为 MP3", en: "Extract MP3" },
  "batch.audioWav": { zh: "提取为 WAV", en: "Extract WAV" },
  "batch.audioM4a": { zh: "提取为 M4A", en: "Extract M4A" },
  "batch.audioFlac": { zh: "提取为 FLAC", en: "Extract FLAC" },
  "batch.audioOgg": { zh: "提取为 OGG", en: "Extract OGG" },
  "batch.burnSubtitle": { zh: "烧录字幕（硬字幕）", en: "Burn subtitles (hard)" },
  "batch.subtitlePick": { zh: "选择 .srt 字幕文件", en: "Pick .srt subtitle file" },
  "batch.coverAt": { zh: "封面时间点（秒）", en: "Cover time (seconds)" },
  "batch.videoHint": {
    zh: "容器转换优先不重编码（秒完成、零画质损失），不兼容时自动回退转码；音轨提取只保留声音；封面抽帧从指定时间点取一帧输出 JPG。",
    en: "Container conversion avoids re-encoding when possible (instant, lossless); falls back to transcoding when incompatible. Audio extract keeps sound only. Cover frame exports one JPG at the given time.",
  },
  "batch.pdfSlim": {
    zh: "PDF 瘦身（选择「PDF 瘦身」预设时生效：解码逐页重压后重建，适合扫描/图片型 PDF）",
    en: "PDF slim (applies to the “PDF Slim” preset: re-encode every page and rebuild, best for scanned/image PDFs)",
  },
  "batch.pdfSlimQuality": { zh: "质量", en: "Quality" },
  "batch.pdfSlimLabel": { zh: "清晰度 {c} / 压缩度 {s}", en: "Quality {c} / Compression {s}" },
  "batch.renameTemplate": { zh: "统一重命名模板（覆盖队列全部任务）", en: "Batch rename template (overrides all tasks)" },
  "batch.renamePlaceholder": { zh: "如 照片_{seq}_{name}，支持 {seq} 序号 / {date} 日期 / {time} 时间", en: "e.g. photo_{seq}_{name}; supports {seq} / {date} / {time}" },
  "batch.replaceSource": { zh: "输出后替换源文件", en: "Replace source after output" },
  "batch.replaceHint": { zh: "（原文件将被输出覆盖，操作不可撤销）", en: "(source files will be overwritten, irreversible)" },

  // ===== 拖放/添加 =====
  "drop.hint": { zh: "拖入图片或视频文件（支持批量）", en: "Drop images or videos (batch supported)" },
  "drop.hint2": { zh: "或拖入文件夹 · 也可用下方「添加文件」按钮或粘贴路径", en: "or drop a folder · or use “Add files” below / paste paths" },
  "add.title": { zh: "添加文件", en: "Add files" },
  "add.pickFiles": { zh: "选择文件…", en: "Pick files…" },
  "add.pickFolder": { zh: "选择文件夹…", en: "Pick folder…" },
  "add.placeholder": { zh: "粘贴文件/文件夹路径，多个用换行、逗号或分号分隔", en: "Paste file/folder paths, separated by newline, comma or semicolon" },
  "add.busy": { zh: "解析中…", en: "Resolving…" },
  "add.add": { zh: "添加", en: "Add" },
  "add.noMedia": { zh: "未识别到可压缩的图片/视频文件", en: "No compressible image/video files found" },
  "add.pathFailed": { zh: "解析路径失败：{e}", en: "Failed to resolve paths: {e}" },
  "add.pasteFirst": { zh: "请先粘贴文件或文件夹路径", en: "Paste file or folder paths first" },
  "add.hint": { zh: "文件夹会自动递归收集其中的图片/视频；粘贴多路径时建议直接拖入文件夹更快捷。", en: "Folders are scanned recursively for media; dropping a folder is usually faster than pasting paths." },

  // ===== 预设选择 =====
  "ps.title": { zh: "场景预设", en: "Presets" },
  "ps.subtitle": { zh: "平台硬约束，非瞎填参数", en: "Platform constraints, not guesses" },
  "ps.video": { zh: "视频", en: "Video" },
  "ps.image": { zh: "图片", en: "Image" },
  "ps.footer": { zh: "预设库 JSON 热更新 · v1", en: "Presets hot-reload from JSON · v1" },
  "ps.groupCollapse": { zh: "收起 ▲", en: "Collapse ▲" },
  "ps.groupExpand": { zh: "展开 ▼", en: "Expand ▼" },
  "ps.placeholder": { zh: "选择处理预设…", en: "Pick a preset…" },
  "ps.clear": { zh: "清除", en: "Clear" },
  "ps.hint": { zh: "预设决定压缩参数与平台硬约束；可在下方预设管理器自定义并保存", en: "Presets set compression params & platform limits; customize & save below" },
  "ps.platformBilibili": { zh: "B站", en: "Bilibili" },
  "ps.platformDouyin": { zh: "抖音", en: "Douyin" },
  "ps.platformShipinhao": { zh: "视频号", en: "WeChat Channels" },
  "ps.platformPdd": { zh: "拼多多", en: "Pinduoduo" },
  "ps.platformTaobao": { zh: "淘宝", en: "Taobao" },
  "ps.platformXhs": { zh: "小红书", en: "Xiaohongshu" },
  "ps.platformWechat": { zh: "微信", en: "WeChat" },
  "ps.platformYoutube": { zh: "YouTube", en: "YouTube" },
  "ps.platformGeneric": { zh: "通用", en: "Generic" },

  // ===== 队列 =====
  "q.empty": { zh: "队列为空 —— 拖入文件后选择预设开始压缩", en: "Queue is empty — drop files, pick a preset, then compress" },
  "q.statusQueued": { zh: "等待中", en: "Queued" },
  "q.statusRunning": { zh: "压缩中", en: "Compressing" },
  "q.statusDone": { zh: "完成", en: "Done" },
  "q.statusError": { zh: "失败", en: "Failed" },
  "q.statusCancelled": { zh: "已取消", en: "Cancelled" },
  "q.trim": { zh: "截取 {s}s", en: "Trim {s}s" },
  "q.rotate": { zh: "旋转{r}°", en: "Rotate {r}°" },
  "q.autocrop": { zh: "去黑边", en: "Auto-crop" },
  "q.crop": { zh: "裁切 {p}%", en: "Crop {p}%" },
  "q.trimStart": { zh: "截取起点（秒）", en: "Trim start (s)" },
  "q.trimDuration": { zh: "截取时长（秒）", en: "Trim duration (s)" },
  "q.noTrim": { zh: "留空=不截取", en: "empty = no trim" },
  "q.rotateLabel": { zh: "旋转", en: "Rotate" },
  "q.noRotate": { zh: "不旋转", en: "No rotation" },
  "q.rotCw90": { zh: "顺时针 90°", en: "90° clockwise" },
  "q.rot180": { zh: "180°", en: "180°" },
  "q.rotCw270": { zh: "顺时针 270°", en: "270° clockwise" },
  "q.cropCenter": { zh: "居中裁切（%）", en: "Center crop (%)" },
  "q.autocropLabel": { zh: "自动去黑边（检测上下黑边后裁剪）", en: "Auto-crop black bars (detect and crop)" },
  "q.cancel": { zh: "取消", en: "Cancel" },
  "q.retry": { zh: "重试", en: "Retry" },
  "q.collapse": { zh: "收起", en: "Collapse" },

  // ===== 对比预览 =====
  "c.empty": { zh: "点击队列中的任务，查看压缩前后对比与预览", en: "Select a task to compare before/after and preview" },
  "c.before": { zh: "压缩前", en: "Before" },
  "c.after": { zh: "压缩后", en: "After" },
  "c.saved": { zh: "节省", en: "Saved" },
  "c.failed": { zh: "压缩失败", en: "Compression failed" },
  "c.videoPreview": { zh: "压缩后 · 视频预览", en: "After · video preview" },
  "c.imagePreview": { zh: "压缩后 · 可放大对比画质", en: "After · click to zoom for quality check" },
  "c.original": { zh: "原始文件 · 对比参考", en: "Original · for comparison" },
  "c.running": { zh: "压缩中… {p}%", en: "Compressing… {p}%" },
  "c.waiting": { zh: "等待任务完成", en: "Waiting for completion" },
};

const dict: Record<Lang, Record<string, string>> = {
  zh: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.zh])),
  en: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.en])),
};

/** 取当前语言文案；支持 {placeholder} 插值 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dict[getLang()][key] ?? dict.zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** 预设平台中文标签（历史语义，en 下用平台原标识） */
export function platformLabel(platform: string): string {
  if (getLang() === "en") return platform;
  const map: Record<string, string> = {
    bilibili: t("ps.platformBilibili"),
    douyin: t("ps.platformDouyin"),
    shipinhao: t("ps.platformShipinhao"),
    pinduoduo: t("ps.platformPdd"),
    taobao: t("ps.platformTaobao"),
    xiaohongshu: t("ps.platformXhs"),
    wechat: t("ps.platformWechat"),
    youtube: t("ps.platformYoutube"),
    generic: t("ps.platformGeneric"),
  };
  return map[platform] ?? platform;
}
