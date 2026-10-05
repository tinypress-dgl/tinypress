import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { QueueItem } from "../types";
import { t } from "../i18n";

interface Props {
  item: QueueItem | null;
  /** 关闭对比浮层 */
  onClose: () => void;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function isVideo(path: string): boolean {
  return /\.(mp4|mov|mkv|webm|avi|flv|m4v)$/i.test(path);
}

/**
 * 通过 IPC 读取文件为 data URL（绕开 asset:// 协议，
 * 规避 macOS WebKit URL scheme handler 在内存压力下 panic 崩溃）。
 */
function useDataUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    setUrl(null);
    invoke<string>("file_to_data_url", { path })
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}

/** 对比预览面板：点击队列任务时以浮层弹出（v0.6.2 不再占右侧固定栏位） */
export default function CompareView({ item, onClose }: Props) {
  const outUrl = useDataUrl(item?.outputPath ?? null);
  const inUrl = useDataUrl(
    item?.status === "done" ? item.inputPath : null
  );

  // 无选中任务：完全不占界面空间
  if (!item) {
    return null;
  }

  const { inputSize, outputSize } = item;
  const ratio =
    outputSize !== undefined && inputSize > 0
      ? Math.max(0, Math.round((1 - outputSize / inputSize) * 100))
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-800">
              {item.name}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">{item.presetId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
          >
            {t("common.close")}
          </button>
        </div>

      {/* 大小对比 */}
      <div className="grid grid-cols-3 gap-2 border-b border-slate-100 p-4 text-center">
        <div>
          <p className="text-[11px] text-slate-400">{t("c.before")}</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">
            {formatSize(inputSize)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-400">{t("c.after")}</p>
          <p className="mt-1 text-sm font-semibold text-blue-600">
            {formatSize(outputSize)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-400">{t("c.saved")}</p>
          <p className="mt-1 text-sm font-bold text-green-600">
            {ratio !== null ? `-${ratio}%` : "—"}
          </p>
        </div>
      </div>

      {/* 预览区 */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {item.status === "error" && (
          <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600">
            {item.error ?? t("c.failed")}
          </div>
        )}

        {outUrl && isVideo(item.outputPath!) && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <video src={outUrl} controls className="max-h-64 w-full" />
            <p className="px-3 py-2 text-[11px] text-slate-400">{t("c.videoPreview")}</p>
          </div>
        )}

        {outUrl && !isVideo(item.outputPath!) && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <img
              src={outUrl}
              alt={t("c.imagePreview")}
              className="mx-auto max-h-64 w-auto object-contain"
            />
            <p className="px-3 py-2 text-[11px] text-slate-400">{t("c.imagePreview")}</p>
          </div>
        )}

        {inUrl && item.status === "done" && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {isVideo(item.inputPath) ? (
              <video src={inUrl} controls className="max-h-48 w-full" />
            ) : (
              <img
                src={inUrl}
                alt={t("c.original")}
                className="mx-auto max-h-48 w-auto object-contain"
              />
            )}
            <p className="px-3 py-2 text-[11px] text-slate-400">{t("c.original")}</p>
          </div>
        )}

        {!outUrl && item.status !== "error" && (
          <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
            {item.status === "running"
              ? t("c.running", { p: item.progress })
              : t("c.waiting")}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
