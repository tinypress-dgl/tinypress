import { useEffect, useMemo, useRef, useState } from "react";
import BatchEditPanel from "./components/BatchEditPanel";
import CompareView from "./components/CompareView";
import AddFilesPanel from "./components/AddFilesPanel";
import CustomPresetEditor from "./components/CustomPresetEditor";
import DropZone from "./components/DropZone";
import PresetSelector from "./components/PresetSelector";
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
import { pickOutputDir } from "./api";
import type {
  EditOptions,
  EngineInfo,
  ImageEditOptions,
  Preset,
  QueueItem,
} from "./types";
import { setLang, t, useLang, type LangPref } from "./i18n";

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
  const queueRef = useRef<QueueItem[]>([]);
  const settingsLoaded = useRef(false);

  useLang();

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

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
    }).then((fn) => offs.push(fn));
    return () => offs.forEach((fn) => fn());
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

  const totalPending = useMemo(
    () =>
      queue.filter((x) => x.status === "queued" || x.status === "running").length,
    [queue]
  );

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

  return (
    <div className="flex h-full bg-slate-50 text-slate-800">
      <PresetSelector
        presets={presets}
        selected={selectedPreset}
        onSelect={setSelectedPreset}
        type={activeTab}
        onTypeChange={setActiveTab}
      />

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
                onClick={handleCheckUpdate}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
                title={t("app.checkUpdate")}
              >
                v{appVersion}
              </button>
            )}
          </div>
        </header>

        {/* 工作区：上下/左右可滚动，任何屏幕尺寸都显示齐全 */}
        <div className="min-h-0 flex-1 overflow-auto">
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
            language={langPref}
            onLanguageChange={handleLangChange}
          />

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

          <div className="space-y-3 p-4">
            {/* 批处理工具箱：图片页只显示图片块，视频页只显示视频块+PDF瘦身 */}
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

            {/* 输出路径：源文件目录 / 自定义目录 */}
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

            {/* 文件入口：拖入框内 / 自选文件 / 自选文件夹 / 粘贴路径 */}
            <DropZone onFiles={handleFiles} />
            <AddFilesPanel onFiles={handleFiles} />

            {pagePending.length > 0 && (
              <button
                type="button"
                onClick={handleCompressClick}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                {t("app.startCompress", { n: pagePending.length })}
              </button>
            )}

            <QueueList
              items={visibleQueue}
              selectedId={selectedItem?.id}
              onSelect={(it) => setSelectedItem(it)}
              onEditChange={handleEditChange}
              onCancel={handleCancel}
              onRetry={handleRetry}
            />
          </div>
        </div>
      </main>

      <CompareView item={selectedItem} />
    </div>
  );
}
