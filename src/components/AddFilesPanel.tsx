import { useState } from "react";
import { pickInputFiles, pickOutputDir, resolveInputPaths } from "../api";
import { t } from "../i18n";

interface Props {
  onFiles: (paths: string[]) => void;
}

/** 通过路径/对话框添加源文件：支持文件、文件夹、粘贴多路径（换行或分号分隔） */
export default function AddFilesPanel({ onFiles }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const applyPaths = async (rawPaths: string[]) => {
    if (rawPaths.length === 0) return;
    setBusy(true);
    try {
      const resolved = await resolveInputPaths(rawPaths);
      if (resolved.length > 0) {
        onFiles(resolved);
      } else {
        alert(t("add.noMedia"));
      }
    } catch (e) {
      alert(t("add.pathFailed", { e: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const handleTextAdd = async () => {
    const raw = text
      .split(/[\n;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (raw.length === 0) {
      alert(t("add.pasteFirst"));
      return;
    }
    await applyPaths(raw);
    setText("");
  };

  const handlePickFiles = async () => {
    const files = await pickInputFiles();
    if (files && files.length > 0) onFiles(files);
  };

  const handlePickFolder = async () => {
    const dir = await pickOutputDir();
    if (dir) await applyPaths([dir]);
  };

  const btnCls =
    "shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-700">{t("add.title")}</span>
        <button
          type="button"
          onClick={handlePickFiles}
          disabled={busy}
          className={btnCls}
        >
          {t("add.pickFiles")}
        </button>
        <button
          type="button"
          onClick={handlePickFolder}
          disabled={busy}
          className={btnCls}
        >
          {t("add.pickFolder")}
        </button>
      </div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          placeholder={t("add.placeholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleTextAdd();
          }}
        />
        <button
          type="button"
          onClick={() => void handleTextAdd()}
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? t("add.busy") : t("add.add")}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        {t("add.hint")}
      </p>
    </div>
  );
}
