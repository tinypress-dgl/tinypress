import { useState } from "react";
import type { Preset } from "../types";

interface Props {
  outputDir: string;
  renameTemplate: string;
  onOutputDirChange: (v: string) => void;
  onRenameTemplateChange: (v: string) => void;
  watchDir: string;
  watchPreset: string;
  watchRunning: boolean;
  onWatchDirChange: (v: string) => void;
  onWatchPresetChange: (v: string) => void;
  onStartWatch: () => void;
  onStopWatch: () => void;
  presets: Preset[];
}

/** 折叠式设置面板：输出目录 / 命名模板 / 文件夹监控 */
export default function SettingsPanel({
  outputDir,
  renameTemplate,
  onOutputDirChange,
  onRenameTemplateChange,
  watchDir,
  watchPreset,
  watchRunning,
  onWatchDirChange,
  onWatchPresetChange,
  onStartWatch,
  onStopWatch,
  presets,
}: Props) {
  const [open, setOpen] = useState(false);

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  return (
    <div className="border-b border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span>⚙ 输出与自动压缩设置</span>
        <span className="text-xs text-slate-400">{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          {/* 输出目录 + 命名模板 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                输出目录（留空 = 与源文件同目录）
              </span>
              <input
                className={inputCls}
                placeholder="如 D:\compressed"
                value={outputDir}
                onChange={(e) => onOutputDirChange(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                命名模板（支持 {"{name}"} {"{kind}"} {"{ext}"}，缺省 {"{name}.{kind}"}）
              </span>
              <input
                className={inputCls}
                placeholder="{name}.{kind}"
                value={renameTemplate}
                onChange={(e) => onRenameTemplateChange(e.target.value)}
              />
            </label>
          </div>

          {/* 文件夹监控 */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                文件夹监控：新文件自动压缩
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  watchRunning
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-200 text-slate-500"
                }`}
              >
                {watchRunning ? "监控中" : "未运行"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  监控目录
                </span>
                <input
                  className={inputCls}
                  placeholder="如 D:\watch"
                  value={watchDir}
                  onChange={(e) => onWatchDirChange(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  使用的预设
                </span>
                <select
                  className={inputCls}
                  value={watchPreset}
                  onChange={(e) => onWatchPresetChange(e.target.value)}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                {watchRunning ? (
                  <button
                    type="button"
                    onClick={onStopWatch}
                    className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100"
                  >
                    停止监控
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onStartWatch}
                    disabled={!watchDir.trim()}
                    className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    启动监控
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              监控目录内新增的图片/视频将自动按所选预设压缩；启动前已存在的文件不会重复处理。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
