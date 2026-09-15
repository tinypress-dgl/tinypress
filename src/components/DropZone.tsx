import { useEffect, useState } from "react";
import { onFilesDropped } from "../api";

interface Props {
  onFiles: (paths: string[]) => void;
  disabled?: boolean;
}

/** 拖入区：支持窗口级拖放（Tauri onDragDropEvent） */
export default function DropZone({ onFiles, disabled }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const unlisten = onFilesDropped((paths) => {
      setActive(false);
      onFiles(paths);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onFiles]);

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        if (!disabled) setActive(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setActive(false)}
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
