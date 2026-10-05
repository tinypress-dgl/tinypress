import { useState } from "react";
import { pickOutputDir } from "../api";
import type { Preset } from "../types";
import { t, useLang, type LangPref } from "../i18n";

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
  language: LangPref;
  onLanguageChange: (v: LangPref) => void;
}

/** 折叠式设置面板：界面语言 / 输出目录 / 命名模板 / 文件夹监控 */
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
  language,
  onLanguageChange,
}: Props) {
  const [open, setOpen] = useState(true);
  useLang();

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  return (
    <div className="border-b border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span>{t("settings.title")}</span>
        <span className="text-xs text-slate-400">
          {open ? t("common.collapse") : t("common.expand")}
        </span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          {/* 界面语言 */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-500">
              {t("settings.language")}
            </span>
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value as LangPref)}
              className="w-48 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500"
            >
              <option value="system">{t("settings.langSystem")}</option>
              <option value="zh">{t("settings.langZh")}</option>
              <option value="en">{t("settings.langEn")}</option>
            </select>
          </div>

          {/* 输出目录 + 命名模板 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {t("settings.outputDir")}
              </span>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="如 D:\compressed"
                  value={outputDir}
                  onChange={(e) => onOutputDirChange(e.target.value)}
                />
                <button
                  type="button"
                  onClick={async () => {
                    const dir = await pickOutputDir();
                    if (dir) onOutputDirChange(dir);
                  }}
                  className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  title={t("settings.folderPicker")}
                >
                  {t("common.choose")}
                </button>
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {t("settings.renameTemplate")}
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
                {t("settings.watchTitle")}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  watchRunning
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-200 text-slate-500"
                }`}
              >
                {watchRunning ? t("settings.watchRunning") : t("settings.watchStopped")}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  {t("settings.watchDir")}
                </span>
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    placeholder="如 D:\watch"
                    value={watchDir}
                    onChange={(e) => onWatchDirChange(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const dir = await pickOutputDir();
                      if (dir) onWatchDirChange(dir);
                    }}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                    title={t("settings.folderPicker")}
                  >
                    {t("common.choose")}
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  {t("settings.watchPreset")}
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
                    {t("settings.stopWatch")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onStartWatch}
                    disabled={!watchDir.trim()}
                    className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("settings.startWatch")}
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {t("settings.watchHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
