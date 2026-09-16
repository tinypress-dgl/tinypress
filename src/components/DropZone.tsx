import { useEffect, useState } from "react";
import { onFilesDropped } from "../api";

interface Props {
  onFiles: (paths: string[]) => void;
  disabled?: boolean;
}

/**
 * 拖入区：使用 Tauri 原生窗口级拖放事件（onDragDropEvent）。
 * 注意：不能在此处监听 HTML5 dragover/drop 并 preventDefault，
 * 那会拦截 WebView2 的原生文件拖放，导致 onDragDropEvent 不触发。
 */
export default function DropZone({ onFiles, disabled }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const unlisten = onFilesDropped((phase, paths) => {
      if (phase === "enter" || phase === "over") {
        if (!disabled) setActive(true);
      } else if (phase === "leave") {
        setActive(false);
      } else if (phase === "drop") {
        setActive(false);
        if (paths && paths.length > 0) onFiles(paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onFiles, disabled]);

  return (
    <div
      className={`flex h-40 flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${
        active
          ? "border-blue-500 bg-blue-50"
          : "border-slate-300 bg-slate-50 hover:border-blue-300"
      }`}
    >
      <div className="text-4xl">📦</div>
      <p className="mt-2 text-sm font-medium text-slate-700">
        拖入图片或视频文件（支持批量）
      </p>
      <p className="mt-1 text-xs text-slate-400">
        或直接拖入文件夹 · 全程本地处理，不上传
      </p>
    </div>
  );
}
