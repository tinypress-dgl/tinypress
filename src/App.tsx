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
import type {
  EditOptions,
  EngineInfo,
  ImageEditOptions,
  Preset,
  QueueItem,
} from "./types";

let idSeq = 0;

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

export default function App() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  // 输出设置
  const [outputDir, setOutputDir] = useState("");
  const [renameTemplate, setRenameTemplate] = useState("");
  // v0.3.0 批处理状态（面板开关；作用于队列中全部同类型任务）
  const [imageEdit, setImageEdit] = useState<ImageEditOptions | null>(null);
  const [videoContainer, setVideoContainer] = useState("");
  const [audioOnly, setAudioOnly] = useState("");
  // v0.4.0：图片转 PDF / 视频封面抽帧 / 替换源
  const [pdfMode, setPdfMode] = useState(false);
  const [coverAt, setCoverAt] = useState("");
  const [replaceSource, setReplaceSource] = useState(false);
  // 文件夹监控
  const [watchDir, setWatchDir] = useState("");
  const [watchPreset, setWatchPreset] = useState("");
  const [watchRunning, setWatchRunning] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const queueRef = useRef<QueueItem[]>([]);

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
        alert(
          `TinyPress 当前版本 ${info.current}\n更新/下载页：\n${info.updateUrl}`
        );
      } else {
        alert(`TinyPress ${info.current} —— 当前为最新版本`);
      }
    } catch (e) {
      alert(`检查更新失败：${String(e)}`);
    }
  };

  // 加载已保存的设置（输出目录/命名模板/监控配置），加载完成前不触发保存
  const settingsLoaded = useRef(false);
  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s.outputDir) setOutputDir(s.outputDir);
        if (s.renameTemplate) setRenameTemplate(s.renameTemplate);
        if (s.watchDir) setWatchDir(s.watchDir);
        if (s.watchPreset) setWatchPreset(s.watchPreset);
      })
      .catch(() => {})
      .finally(() => {
        settingsLoaded.current = true;
      });
  }, []);

  // 设置变更防抖保存（500ms）
  useEffect(() => {
    if (!settingsLoaded.current) return;
    const t = setTimeout(() => {
      saveSettings({
        outputDir: outputDir || undefined,
        renameTemplate: renameTemplate || undefined,
        watchDir: watchDir || undefined,
        watchPreset: watchPreset || undefined,
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [outputDir, renameTemplate, watchDir, watchPreset]);

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
        q.map((it) =>
          it.id === done.id
            ? { ...done, status: done.status }
            : it
        )
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

  /** 提交前把编辑选项合并进 compress 请求；
   *  恢复的任务（params）沿用持久化参数，提交成功后移除旧 queued 记录 */
  const handleCompressClick = async () => {
    const pending = queue.filter((x) => x.status === "queued");
    if (pending.length === 0) return;
    const pendingIds = new Set(pending.map((x) => x.id));
    try {
      const snapshot = await compressFiles({
        items: pending.map((it) => {
          const isVideo =
            presets.find((p) => p.id === it.presetId)?.kind === "video";
          const coverNum = coverAt.trim() === "" ? undefined : Number(coverAt);
          return {
            inputPath: it.inputPath,
            presetId: it.presetId,
            outputDir:
              it.params?.outputDir ?? (outputDir.trim() || undefined),
            rename: it.params?.rename ?? (renameTemplate.trim() || undefined),
            edit: it.edit ?? it.params?.edit,
            // v0.3.0：图片任务挂图片批量编辑；视频任务挂容器转换/音轨提取
            // v0.4.0：pdf 与 imageEdit 互斥（pdf 优先）；coverAt 与 container/audioOnly 互斥
            imageEdit:
              !isVideo && imageEdit && !imageEditEmpty && !pdfMode
                ? imageEdit
                : undefined,
            container:
              isVideo && videoContainer && coverNum === undefined
                ? videoContainer
                : undefined,
            audioOnly:
              isVideo && audioOnly && coverNum === undefined
                ? audioOnly
                : undefined,
            pdf: !isVideo && pdfMode ? true : undefined,
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
    () => queue.filter((x) => x.status === "queued" || x.status === "running").length,
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
      alert(`启动监控失败：${String(e)}`);
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

  return (
    <div className="flex h-full bg-slate-50 text-slate-800">
      <PresetSelector
        presets={presets}
        selected={selectedPreset}
        onSelect={setSelectedPreset}
      />

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <h1 className="text-base font-bold text-slate-900">TinyPress 速压</h1>
            <p className="text-[11px] text-slate-400">
              {engine
                ? engine.ffmpegOk
                  ? `FFmpeg ${(engine.ffmpegVersion ?? "").replace(/^ffmpeg\s+version\s+/i, "").split(" ")[0]} · 图片引擎 ${Object.values(engine.engines).filter(Boolean).length}/4 就绪${
                      engine.hardware.nvenc
                        ? " · NVENC 可用"
                        : engine.hardware.qsv
                          ? " · QSV 可用"
                          : engine.hardware.videotoolbox
                            ? " · VideoToolbox 可用"
                            : ""
                    }`
                  : "⚠ FFmpeg 未就绪，请检查依赖"
                : "引擎检测中…"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {totalPending > 0 && (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                {totalPending} 个任务进行中
              </span>
            )}
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
              本地处理 · 不上传
            </span>
            {appVersion && (
              <button
                type="button"
                onClick={handleCheckUpdate}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
                title="检查更新"
              >
                v{appVersion}
              </button>
            )}
          </div>
        </header>

        <SettingsPanel
          outputDir={outputDir}
          renameTemplate={renameTemplate}
          onOutputDirChange={setOutputDir}
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
          />
        </div>

        <div className="space-y-3 p-4">
          <DropZone onFiles={handleFiles} />
          <AddFilesPanel onFiles={handleFiles} />
          {queue.some((x) => x.status === "queued") && (
            <button
              type="button"
              onClick={handleCompressClick}
              className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              开始压缩（{queue.filter((x) => x.status === "queued").length}）—— 可先点队列项的「编辑」调整截取/旋转/去黑边
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 px-4 pb-4">
          <div className="flex min-h-0 flex-1 flex-col">
            <QueueList
              items={queue}
              selectedId={selectedItem?.id}
              onSelect={(it) => setSelectedItem(it)}
              onEditChange={handleEditChange}
              onCancel={handleCancel}
              onRetry={handleRetry}
            />
          </div>
          <CompareView item={selectedItem} />
        </div>
      </main>
    </div>
  );
}
