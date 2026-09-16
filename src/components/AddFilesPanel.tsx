import { useState } from "react";
import { pickInputFiles, pickOutputDir, resolveInputPaths } from "../api";

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
        alert("未识别到可压缩的图片/视频文件");
      }
    } catch (e) {
      alert(`解析路径失败：${String(e)}`);
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
      alert("请先粘贴文件或文件夹路径");
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
        <span className="text-xs font-semibold text-slate-700">添加文件</span>
        <button
          type="button"
          onClick={handlePickFiles}
          disabled={busy}
          className={btnCls}
        >
          选择文件…
        </button>
        <button
          type="button"
          onClick={handlePickFolder}
          disabled={busy}
          className={btnCls}
        >
          选择文件夹…
        </button>
      </div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          placeholder="粘贴文件/文件夹路径，多个用换行、逗号或分号分隔"
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
          {busy ? "解析中…" : "添加"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        文件夹会自动递归收集其中的图片/视频；粘贴多路径时建议直接拖入文件夹更快捷。
      </p>
    </div>
  );
}
