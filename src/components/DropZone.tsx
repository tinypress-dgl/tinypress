import { useEffect, useRef, useState } from "react";
import { onFilesDropped, onNativeFilesDropped } from "../api";

interface Props {
  onFiles: (paths: string[]) => void;
  disabled?: boolean;
}

/**
 * 拖入区：双通道接收系统文件拖放——
 * 1) Rust 原生层 on_drag_drop_event 转发（native-files-dropped，主通道，最可靠）
 * 2) 前端窗口 API onDragDropEvent（备份通道）
 * 两条通道收到相同 drop 时按时间窗口去重，避免重复入队。
 */
export default function DropZone({ onFiles, disabled }: Props) {
  const [active, setActive] = useState(false);
  const lastDropRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  const handleDropPaths = (paths: string[]) => {
    if (!paths || paths.length === 0) return;
    setActive(false);
    const key = paths.slice(0, 3).join("|");
    const now = Date.now();
    // 200ms 内相同路径只处理一次（双通道去重）
    if (key === lastDropRef.current.key && now - lastDropRef.current.at < 200) {
      return;
    }
    lastDropRef.current = { key, at: now };
    onFiles(paths);
  };

  useEffect(() => {
    const offs: (() => void)[] = [];
    // 主通道：Rust 原生转发
    onNativeFilesDropped((paths) => {
      if (!disabled) handleDropPaths(paths);
    }).then((fn) => offs.push(fn));
    // 备份通道：前端窗口 API
    onFilesDropped((phase, paths) => {
      if (phase === "enter" || phase === "over") {
        if (!disabled) setActive(true);
      } else if (phase === "leave") {
        setActive(false);
      } else if (phase === "drop") {
        if (!disabled && paths) handleDropPaths(paths);
      }
    }).then((fn) => offs.push(fn));
    return () => offs.forEach((fn) => fn());
  }, [onFiles, disabled]);

  return (
    <div
      className={`flex h-32 flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${
        active
          ? "border-blue-500 bg-blue-50"
          : "border-slate-300 bg-slate-50 hover:border-blue-300"
      }`}
    >
      <div className="text-4xl">📦</div>
      <p className="mt-1 text-sm font-medium text-slate-700">
        拖入图片或视频文件（支持批量）
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        或拖入文件夹 · 也可用下方「添加文件」按钮或粘贴路径
      </p>
    </div>
  );
}
