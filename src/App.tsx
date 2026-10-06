import { useEffect, useMemo, useRef, useState } from "react";
import BatchEditPanel from "./components/BatchEditPanel";
import CompareView from "./components/CompareView";
import AddFilesPanel from "./components/AddFilesPanel";
import CustomPresetEditor from "./components/CustomPresetEditor";
import DropZone from "./components/DropZone";
import QueueList from "./components/QueueList";
import SettingsPanel from "./components/SettingsPanel";
import {
  cancelJob,
  checkUpdate,
  compressFiles,
  getAppVersion,
  getEngineInfo,
  getQueue,
  getSettings,
  getWatchStatus,
  listPresets,
  onJobDone,
  onProgress,
  retryJob,
  saveSettings,
  startWatch,
  stopWatch,
} from "./api";
import { pickOutputDir, pickInputFiles } from "./api";
import type {
  EditOptions,
  EngineInfo,
  ImageEditOptions,
  Preset,
  QueueItem,
} from "./types";
import { setLang, t, useLang, type LangPref } from "./i18n";
import { notify } from "./notify";
import { getCurrentWindow } from "@tauri-apps/api/window";

let idSeq = 0;

type ActiveTab = "image" | "video";

/** 刷新预设列表；选中项/监控预设失效时回退到第一个有效预设 */
function refreshPresets(
  setPresets: (p: Preset[]) => void,
  selected: string,
  setSelected: (id: string) => void,
  watchPreset: string,
  setWatchPreset: (id: string) => void
) {
  listPresets().then((ps) => {
    setPresets(ps);
    if (!ps.some((p) => p.id === selected)) {
      const first = ps.find((p) => p.tags.includes("hot")) ?? ps[0];
      if (first) setSelected(first.id);
    }
    if (!ps.some((p) => p.id === watchPreset)) {
      const first = ps.find((p) => p.tags.includes("hot")) ?? ps[0];
      if (first) setWatchPreset(first.id);
    }
  });
}

/** 任务类型（按预设 kind 判定；pdf 归入视频） */
function taskKind(presets: Preset[], presetId: string): ActiveTab {
  const kind = presets.find((p) => p.id === presetId)?.kind;
  return kind === "image" ? "image" : "video"; // video + pdf + audio
}

export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  // 输出设置
  const [outputDir, setOutputDir] = useState("");
  const [outputMode, setOutputMode] = useState<"source" | "custom">("source");
  const [renameTemplate, setRenameTemplate] = useState("");
  // v0.6.0 分页
  const [activeTab, setActiveTab] = useState<ActiveTab>("image");
  // v0.6.0 界面语言
  const [langPref, setLangPref] = useState<LangPref>("system");
  // v0.3.0 批处理状态（面板开关；作用于队列中全部同类型任务）
  const [imageEdit, setImageEdit] = useState<ImageEditOptions | null>(null);
  const [videoContainer, setVideoContainer] = useState("");
  const [audioOnly, setAudioOnly] = useState("");
  // v0.4.0：图片转 PDF / 视频封面抽帧 / 替换源
  const [pdfMode, setPdfMode] = useState(false);
  const [coverAt, setCoverAt] = useState("");
  const [replaceSource, setReplaceSource] = useState(false);
  // v0.5.0：PDF 瘦身 / 字幕烧录 / OCR / 统一重命名模板
  const [pdfSlimMode, setPdfSlimMode] = useState(false);
  const [pdfSlimQuality, setPdfSlimQuality] = useState(5);
  const [subtitlePath, setSubtitlePath] = useState("");
  const [ocrMode, setOcrMode] = useState(false);
  const [batchRename, setBatchRename] = useState("");
  // 文件夹监控
  const [watchDir, setWatchDir] = useState("");
  const [watchPreset, setWatchPreset] = useState("");
  const [watchRunning, setWatchRunning] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  // 自动更新检测（静默）：新版本横幅
  const [updateInfo, setUpdateInfo] = useState<{ latest: string; url: string } | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  // 关于对话框
  const [aboutOpen, setAboutOpen] = useState(false);
  const queueRef = useRef<QueueItem[]>([]);
  const settingsLoaded = useRef(false);

  useLang();

  // 任务进行中/待处理时关闭窗口需确认（防止误关丢失压缩任务）
  useEffect(() => {
    try {
      const un = getCurrentWindow().onCloseRequested(async (e) => {
        const busy = queueRef.current.some(
          (x) => x.status === "running" || x.status === "queued"
        );
        if (!busy) return; // 无任务：直接放行
        e.preventDefault();
        if (window.confirm(t("app.confirmExit"))) {
          await getCurrentWindow().destroy();
        }
      });
      return () => {
        un.then((fn) => fn());
      };
    } catch {
      // 非 Tauri 运行环境（如浏览器预览）：无关闭拦截能力，静默跳过
      return () => {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  /** 简单语义化版本比较：latest > current 返回 true */
  function isNewer(latest: string, current: string): boolean {
    const pa = latest.replace(/^v/i, "").split(".").map(Number);
    const pb = current.replace(/^v/i, "").split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const a = pa[i] ?? 0;
      const b = pb[i] ?? 0;
      if (a !== b) return a > b;
    }
    return false;
  }

  // 初始加载：预设 + 引擎信息 + 监控状态 + 应用设置
  useEffect(() => {
    listPresets().then((ps) => {
      setPresets(ps);
      const first = ps.find((p) => p.tags.includes("hot")) ?? ps[0];
      if (first) {
        setSelectedPreset(first.id);
        setWatchPreset(first.id);
      }
    });
    getEngineInfo().then(setEngine).catch(() => setEngine(null));
    getWatchStatus()
      .then((s) => setWatchRunning(s.running))
      .catch(() => setWatchRunning(false));
    getAppVersion().then(setAppVersion).catch(() => setAppVersion(""));
    // 静默检查 GitHub 最新 Release：有新版本且比当前新 → 显示可关闭横幅（失败静默）
    (async () => {
      try {
        const r = await fetch(
          "https://api.github.com/repos/tinypress-dgl/tinypress/releases/latest",
          { headers: { Accept: "application/vnd.github+json" } }
        );
        if (!r.ok) return;
        const j = (await r.json()) as { tag_name?: string };
        const tag = j.tag_name ?? "";
        const cur = await getAppVersion().catch(() => "");
        if (tag && cur && isNewer(tag, cur)) {
          setUpdateInfo({
            latest: tag.replace(/^v/i, ""),
            url: `https://github.com/tinypress-dgl/tinypress/releases/tag/${tag}`,
          });
        }
      } catch {
        // 无网络/被墙：静默，不打扰用户
      }
    })();
    // 恢复上次会话的任务队列（未完成任务为 queued，可重新开始）
    getQueue()
      .then((items) =>
        setQueue(
          items.map((it) => ({
            ...it,
            name: it.inputPath.split(/[\\/]/).pop() ?? it.inputPath,
          }))
        )
      )
      .catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    try {
      const info = await checkUpdate();
      if (info.updateUrl) {
        alert(t("app.updateInfo", { v: info.current, u: info.updateUrl }));
      } else {
        alert(t("app.updateLatest", { v: info.current }));
      }
    } catch (e) {
      alert(t("app.updateFailed", { e: String(e) }));
    }
  };

  // 加载已保存的设置（输出目录/命名模板/监控配置/语言），加载完成前不触发保存
  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s.outputDir) {
          setOutputDir(s.outputDir);
          setOutputMode("custom");
        }
        if (s.renameTemplate) setRenameTemplate(s.renameTemplate);
        if (s.watchDir) setWatchDir(s.watchDir);
        if (s.watchPreset) setWatchPreset(s.watchPreset);
        if (s.language) {
          setLangPref(s.language as LangPref);
          setLang(s.language as LangPref);
        }
      })
      .catch(() => {})
      .finally(() => {
        settingsLoaded.current = true;
      });
  }, []);

  // 设置变更防抖保存（500ms），含语言
  useEffect(() => {
    if (!settingsLoaded.current) return;
    const t0 = setTimeout(() => {
      saveSettings({
        outputDir: outputMode === "custom" ? outputDir || undefined : undefined,
        renameTemplate: renameTemplate || undefined,
        watchDir: watchDir || undefined,
        watchPreset: watchPreset || undefined,
        language: langPref,
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(t0);
  }, [outputDir, outputMode, renameTemplate, watchDir, watchPreset, langPref]);

  // 订阅进度与完成事件
  useEffect(() => {
    const offs: (() => void)[] = [];
    onProgress(({ jobId, progress }) => {
      setQueue((q) =>
        q.map((it) =>
          it.id === jobId ? { ...it, status: "running", progress } : it
        )
      );
    }).then((fn) => offs.push(fn));
    onJobDone((done) => {
      setQueue((q) =>
        q.map((it) => (it.id === done.id ? { ...done, status: done.status } : it))
      );
      // 系统通知：单任务完成/失败 + 全部结束汇总（应用在后台也能收到提醒）
      const name = done.inputPath.split(/[\\/]/).pop() ?? done.inputPath;
      if (done.status === "done") {
        void notify(t("app.notifyDone"), name);
        const next = queueRef.current.map((it) =>
          it.id === done.id ? { ...it, status: done.status } : it
        );
        if (next.length > 0 && next.every((x) => x.status === "done" || x.status === "error")) {
          const ok = next.filter((x) => x.status === "done").length;
          const fail = next.length - ok;
          void notify(t("app.notifyAllDone", { ok, fail }));
        }
      } else if (done.status === "error") {
        void notify(t("app.notifyFail"), name);
      }
    }).then((fn) => offs.push(fn));
    return () => offs.forEach((fn) => fn());
  }, []);

  // 快捷键：Ctrl/Cmd+O 选择文件、Ctrl/Cmd+Enter 开始压缩
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        pickInputFiles()
          .then((files) => {
            if (files && files.length > 0) void handleFiles(files);
          })
          .catch(() => {});
      } else if (e.key === "Enter") {
        e.preventDefault();
        void handleCompressClick();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFiles = async (paths: string[]) => {
    if (!selectedPreset || paths.length === 0) return;
    const items = paths.map((p) => ({
      id: `job_${Date.now()}_${idSeq++}`,
      inputPath: p,
      name: p.split(/[\\/]/).pop() ?? p,
      presetId: selectedPreset,
      status: "queued" as const,
      progress: 0,
      inputSize: 0,
      edit: undefined,
    }));
    // 先入队（等待用户可编辑/确认），点「开始压缩」统一提交
    setQueue((q) => [...items, ...q]);
  };

  /** 图片编辑参数是否全空（全空时不下发，避免无意义复制） */
  const imageEditEmpty = useMemo(() => {
    if (!imageEdit) return true;
    return (
      imageEdit.scalePercent === undefined &&
      imageEdit.width === undefined &&
      imageEdit.height === undefined &&
      imageEdit.rotate === undefined &&
      imageEdit.cropPercent === undefined &&
      !imageEdit.watermarkText &&
      !imageEdit.watermarkImage
    );
  }, [imageEdit]);

  /** 当前页可见的任务（按类型过滤） */
  const visibleQueue = useMemo(() => {
    return queue.filter((it) => taskKind(presets, it.presetId) === activeTab);
  }, [queue, activeTab, presets]);

  /** 当前页待处理任务（分页内的 queued） */
  const pagePending = useMemo(
    () => visibleQueue.filter((x) => x.status === "queued"),
    [visibleQueue]
  );

  /** 提交前把编辑选项合并进 compress 请求；只提交当前页的 queued 任务 */
  const handleCompressClick = async () => {
    const pending = pagePending;
    if (pending.length === 0) return;
    const pendingIds = new Set(pending.map((x) => x.id));
    try {
      const snapshot = await compressFiles({
        items: pending.map((it) => {
          const isVideo =
            presets.find((p) => p.id === it.presetId)?.kind === "video";
          const isPdf = presets.find((p) => p.id === it.presetId)?.kind === "pdf";
          const coverNum = coverAt.trim() === "" ? undefined : Number(coverAt);
          return {
            inputPath: it.inputPath,
            presetId: it.presetId,
            outputDir:
              it.params?.outputDir ??
              (outputMode === "custom" ? outputDir.trim() || undefined : undefined),
            rename:
              batchRename.trim() ||
              it.params?.rename ||
              (renameTemplate.trim() || undefined),
            edit: it.edit ?? it.params?.edit,
            imageEdit:
              !isVideo && imageEdit && !imageEditEmpty && !pdfMode && !ocrMode
                ? imageEdit
                : undefined,
            container:
              isVideo && videoContainer && coverNum === undefined && !subtitlePath
                ? videoContainer
                : undefined,
            audioOnly:
              isVideo && audioOnly && coverNum === undefined && !subtitlePath
                ? audioOnly
                : undefined,
            pdf: !isVideo && pdfMode && !ocrMode ? true : undefined,
            pdfSlim: isPdf && pdfSlimMode ? pdfSlimQuality : undefined,
            subtitle: isVideo && subtitlePath ? subtitlePath : undefined,
            ocr: !isVideo && ocrMode ? true : undefined,
            coverAt: isVideo && coverNum !== undefined ? coverNum : undefined,
            replaceSource: replaceSource ? true : undefined,
          };
        }),
      });
      setQueue((q) => [
        ...snapshot.map((s) => ({
          ...s,
          name: s.inputPath.split(/[\\/]/).pop() ?? s.inputPath,
        })),
        ...q.filter((it) => !pendingIds.has(it.id)),
      ]);
    } catch (e) {
      console.error("compress_files failed", e);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelJob(id);
    } catch (e) {
      console.error("cancel_job failed", e);
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await retryJob(id);
    } catch (e) {
      console.error("retry_job failed", e);
    }
  };

  const handleEditChange = (id: string, edit: EditOptions | undefined) => {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, edit } : it)));
  };

  /** 清除本次会话中已结束（完成/失败/取消）的任务 */
  const handleClearFinished = () => {
    setQueue((q) =>
      q.filter((it) => it.status === "queued" || it.status === "running")
    );
  };

  /** queued 任务顺序调整（上移/下移一格） */
  const handleMove = (id: string, dir: -1 | 1) => {
    setQueue((q) => {
      const idx = q.findIndex((it) => it.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= q.length) return q;
      const next = [...q];
      const a = next[idx];
      next[idx] = next[target];
      next[target] = a;
      return next;
    });
  };

  const totalPending = useMemo(
    () =>
      queue.filter((x) => x.status === "queued" || x.status === "running").length,
    [queue]
  );

  /** 队列总体进度统计（商用：用户随时看清整体进度） */
  const queueStats = useMemo(() => {
    const s = { total: queue.length, queued: 0, running: 0, done: 0, error: 0 };
    for (const it of queue) {
      if (it.status in s) (s as Record<string, number>)[it.status]++;
    }
    return s;
  }, [queue]);
  const overallPercent =
    queueStats.total > 0
      ? Math.round((queueStats.done / queueStats.total) * 100)
      : 0;

  const handleStartWatch = async () => {
    if (!watchDir.trim() || !watchPreset) return;
    try {
      await startWatch({
        dir: watchDir.trim(),
        presetId: watchPreset,
        outputDir: outputDir.trim() || undefined,
        rename: renameTemplate.trim() || undefined,
      });
      setWatchRunning(true);
    } catch (e) {
      console.error("start_watch failed", e);
      alert(t("app.watchFailed", { e: String(e) }));
    }
  };

  const handleStopWatch = async () => {
    try {
      await stopWatch();
      setWatchRunning(false);
    } catch (e) {
      console.error("stop_watch failed", e);
    }
  };

  const handleLangChange = (v: LangPref) => {
    setLangPref(v);
    setLang(v);
  };

  // langPref 状态与 i18n 全局同步（覆盖初始值/设置加载两种入口）
  useEffect(() => {
    setLang(langPref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langPref]);

  return (
    <div className="flex h-full bg-slate-50 text-slate-800">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900">{t("app.title")}</h1>
            <p className="truncate text-[11px] text-slate-400">
              {engine
                ? engine.ffmpegOk
                  ? `FFmpeg ${(engine.ffmpegVersion ?? "")
                      .replace(/^ffmpeg\s+version\s+/i, "")
                      .split(" ")[0]} · ${t("app.engineReady", {
                      n: Object.values(engine.engines).filter(Boolean).length,
                    })}${
                      engine.hardware.nvenc
                        ? " · " + t("app.hwNvenc")
                        : engine.hardware.qsv
                          ? " · " + t("app.hwQsv")
                          : engine.hardware.videotoolbox
                            ? " · " + t("app.hwVtb")
                            : ""
                    }`
                  : t("app.ffmpegMissing")
                : t("app.engineChecking")}
            </p>
          </div>
          {/* 顶部导航：语言、图片、视频 */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-600">
              {t("settings.language")}
              <select
                value={langPref}
                onChange={(e) => handleLangChange(e.target.value as LangPref)}
                className="bg-transparent text-sm text-slate-700 focus:outline-none"
              >
                <option value="system">{t("settings.langSystem")}</option>
                <option value="zh">{t("settings.langZh")}</option>
                <option value="en">{t("settings.langEn")}</option>
              </select>
            </label>
            <nav className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("image")}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  activeTab === "image"
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("app.tabImages")}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("video")}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  activeTab === "video"
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t("app.tabVideos")}
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {totalPending > 0 && (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                {t("app.tasksRunning", { n: totalPending })}
              </span>
            )}
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              {t("common.localOnly")}
            </span>
            {appVersion && (
              <button
                type="button"
                onClick={() => setAboutOpen(true)}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
                title={t("about.title")}
              >
                v{appVersion}
              </button>
            )}
          </div>
        </header>

        {/* 自动更新横幅（发现新版本时可关闭） */}
        {updateInfo && !updateDismissed && (
          <div className="flex flex-wrap items-center gap-3 border-b border-blue-100 bg-blue-50 px-4 py-2">
            <span className="min-w-0 flex-1 text-xs text-blue-800">
              {t("app.updateBanner", { v: updateInfo.latest })}
            </span>
            <a
              href={updateInfo.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              {t("app.updateBannerBtn")}
            </a>
            <button
              type="button"
              onClick={() => setUpdateDismissed(true)}
              className="rounded-md px-1.5 py-0.5 text-xs text-blue-400 hover:bg-blue-100"
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        )}

        {/* 预设选择（v0.6.1 移到中间栏顶部）+ 工作区滚动 */}
        <div className="min-h-0 flex-1 overflow-auto">
          {/* 预设选择行 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
            <span className="text-xs font-medium text-slate-500">{t("ps.title")}</span>
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="min-w-56 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="">{t("ps.placeholder")}</option>
              {presets
                .filter((p) => (activeTab === "image" ? p.kind === "image" : p.kind === "video" || p.kind === "pdf"))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            {(() => {
              const cur = presets.find((p) => p.id === selectedPreset);
              if (!cur?.constraints) return null;
              return (
                <span className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                  {[
                    cur.constraints.max_size_kb && `≤${cur.constraints.max_size_kb}KB`,
                    cur.constraints.max_bitrate_kbps && `≤${cur.constraints.max_bitrate_kbps}kbps`,
                    cur.constraints.max_resolution && cur.constraints.max_resolution,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              );
            })()}
            {selectedPreset && (
              <button
                type="button"
                onClick={() => setSelectedPreset("")}
                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-50"
              >
                {t("ps.clear")}
              </button>
            )}
          </div>

          <div className="space-y-3 p-4">
            {/* ① 选择文件（上方）：自选文件 / 自选文件夹 / 粘贴路径 */}
            <AddFilesPanel onFiles={handleFiles} />
            {/* ② 拖入框（中间） */}
            <DropZone onFiles={handleFiles} />

            {pagePending.length > 0 && (
              <button
                type="button"
                onClick={handleCompressClick}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                {t("app.startCompress", { n: pagePending.length })}
              </button>
            )}

            {/* ③ 任务队列区（并入中间栏，无右侧独立任务区） */}
            {visibleQueue.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">
                    {t("app.stats", {
                      n: queueStats.total,
                      queued: queueStats.queued,
                      running: queueStats.running,
                      done: queueStats.done,
                      error: queueStats.error,
                    })}
                  </span>
                  <span className="text-xs font-medium text-slate-700">
                    {overallPercent}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${overallPercent}%` }}
                  />
                </div>
              </div>
            )}
            <QueueList
              items={visibleQueue}
              selectedId={selectedItem?.id}
              onSelect={(it) => setSelectedItem(it)}
              onEditChange={handleEditChange}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onClearFinished={handleClearFinished}
              onMove={handleMove}
            />

            {/* ④ 批处理工具箱：图片页只显示图片块，视频页只显示视频块+PDF瘦身 */}
            <BatchEditPanel
              imageEdit={imageEdit}
              onImageEdit={setImageEdit}
              container={videoContainer}
              onContainer={setVideoContainer}
              audioOnly={audioOnly}
              onAudioOnly={setAudioOnly}
              pdfMode={pdfMode}
              onPdfMode={setPdfMode}
              coverAt={coverAt}
              onCoverAt={setCoverAt}
              replaceSource={replaceSource}
              onReplaceSource={setReplaceSource}
              pdfSlimMode={pdfSlimMode}
              onPdfSlimMode={setPdfSlimMode}
              pdfSlimQuality={pdfSlimQuality}
              onPdfSlimQuality={setPdfSlimQuality}
              subtitlePath={subtitlePath}
              onSubtitlePath={setSubtitlePath}
              ocrMode={ocrMode}
              onOcrMode={setOcrMode}
              batchRename={batchRename}
              onBatchRename={setBatchRename}
              kind={activeTab}
            />

            {/* ⑤ 输出路径：源文件目录 / 自定义目录（保存设置放下面） */}
            <section className="rounded-xl border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                {t("out.title")}
              </h3>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="radio"
                    name="outputMode"
                    checked={outputMode === "source"}
                    onChange={() => setOutputMode("source")}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  {t("out.sourceDir")}
                  <span className="text-xs font-normal text-slate-400">
                    {t("out.sourceHint")}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="radio"
                    name="outputMode"
                    checked={outputMode === "custom"}
                    onChange={() => setOutputMode("custom")}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  {t("out.customDir")}
                </label>
                {outputMode === "custom" && (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      readOnly
                      value={outputDir}
                      placeholder={t("out.pick")}
                      className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 outline-none"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const dir = await pickOutputDir();
                        if (dir) {
                          setOutputDir(dir);
                          setOutputMode("custom");
                        }
                      }}
                      className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      {t("out.pick")}
                    </button>
                  </div>
                )}
                {outputMode === "custom" && outputDir && (
                  <p className="w-full truncate text-[11px] text-slate-400">
                    {t("out.current", { p: outputDir })}
                  </p>
                )}
              </div>
            </section>

            {/* ⑥ 输出与自动压缩设置（保存设置：目录/命名/监控） */}
            <SettingsPanel
              outputDir={outputDir}
              renameTemplate={renameTemplate}
              onOutputDirChange={(v) => {
                setOutputDir(v);
                if (v) setOutputMode("custom");
              }}
              onRenameTemplateChange={setRenameTemplate}
              watchDir={watchDir}
              watchPreset={watchPreset}
              watchRunning={watchRunning}
              onWatchDirChange={setWatchDir}
              onWatchPresetChange={setWatchPreset}
              onStartWatch={handleStartWatch}
              onStopWatch={handleStopWatch}
              presets={presets}
            />

            {/* ⑦ 预设管理器 */}
            <CustomPresetEditor
              presets={presets}
              onChanged={() =>
                refreshPresets(
                  setPresets,
                  selectedPreset,
                  setSelectedPreset,
                  watchPreset,
                  setWatchPreset
                )
              }
            />
          </div>
        </div>
      </main>

      <CompareView item={selectedItem} onClose={() => setSelectedItem(null)} />

      {/* 关于对话框 */}
      {aboutOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-slate-900">
              {t("about.title")}
            </h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-slate-500">{t("about.version")}</dt>
                <dd className="font-medium text-slate-800">
                  v{appVersion || "—"}
                  {updateInfo && !updateDismissed && (
                    <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-700">
                      v{updateInfo.latest}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-slate-500">{t("about.engine")}</dt>
                <dd className="text-right font-medium text-slate-800">
                  {engine
                    ? engine.ffmpegOk
                      ? `FFmpeg ${(engine.ffmpegVersion ?? "").split(" ")[1] ?? ""}`
                      : t("app.ffmpegMissing")
                    : t("app.engineChecking")}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-slate-500">{t("about.github")}</dt>
                <dd>
                  <a
                    href="https://github.com/tinypress-dgl/tinypress"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-blue-600 hover:underline"
                  >
                    tinypress-dgl/tinypress
                  </a>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-slate-500">{t("about.license")}</dt>
                <dd className="font-medium text-slate-800">MIT</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
              {t("about.local")}
            </p>
            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCheckUpdate}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                {t("app.checkUpdate")}
              </button>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                {t("about.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
