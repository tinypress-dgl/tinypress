import { useState } from "react";
import type { EditOptions, QueueItem } from "../types";
import { t } from "../i18n";

interface Props {
  items: QueueItem[];
  onSelect: (item: QueueItem | null) => void;
  selectedId?: string;
  /** 更新某个待处理任务的编辑选项（压缩开始后无效） */
  onEditChange?: (id: string, edit: EditOptions | undefined) => void;
  /** 取消 running/queued 任务 */
  onCancel?: (id: string) => void;
  /** 重试 error/cancelled 任务 */
  onRetry?: (id: string) => void;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const STATUS_META: Record<QueueItem["status"], { key: string; cls: string }> = {
  queued: { key: "q.statusQueued", cls: "bg-slate-100 text-slate-500" },
  running: { key: "q.statusRunning", cls: "bg-blue-100 text-blue-600" },
  done: { key: "q.statusDone", cls: "bg-green-100 text-green-600" },
  error: { key: "q.statusError", cls: "bg-red-100 text-red-600" },
  cancelled: { key: "q.statusCancelled", cls: "bg-slate-200 text-slate-500" },
};

function editSummary(e?: EditOptions): string {
  if (!e) return "";
  const parts: string[] = [];
  if (e.trimDuration) parts.push(t("q.trim", { s: e.trimDuration }));
  if (e.rotate) parts.push(t("q.rotate", { r: e.rotate }));
  if (e.autocrop) parts.push(t("q.autocrop"));
  if (e.cropPercent && e.cropPercent < 100) parts.push(t("q.crop", { p: e.cropPercent }));
  return parts.length ? parts.join(" · ") : "";
}

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-500";

/** 行内编辑表单（仅在 queued 状态可改） */
function EditForm({
  edit,
  onChange,
  onClose,
}: {
  edit: EditOptions;
  onChange: (e: EditOptions) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<EditOptions>) => onChange({ ...edit, ...patch });
  return (
    <div
      className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-2"
      onClick={(ev) => ev.stopPropagation()}
    >
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-slate-500">{t("q.trimStart")}</span>
        <input
          className={inputCls}
          type="number"
          min={0}
          step={0.1}
          value={edit.trimStart ?? ""}
          placeholder="0"
          onChange={(ev) =>
            set({
              trimStart: ev.target.value === "" ? undefined : Number(ev.target.value),
            })
          }
        />
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-slate-500">{t("q.trimDuration")}</span>
        <input
          className={inputCls}
          type="number"
          min={0}
          step={0.1}
          value={edit.trimDuration ?? ""}
          placeholder={t("q.noTrim")}
          onChange={(ev) =>
            set({
              trimDuration: ev.target.value === "" ? undefined : Number(ev.target.value),
            })
          }
        />
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-slate-500">{t("q.rotateLabel")}</span>
        <select
          className={inputCls}
          value={edit.rotate ?? 0}
          onChange={(ev) => set({ rotate: Number(ev.target.value) })}
        >
          <option value={0}>{t("q.noRotate")}</option>
          <option value={90}>{t("q.rotCw90")}</option>
          <option value={180}>{t("q.rot180")}</option>
          <option value={270}>{t("q.rotCw270")}</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-slate-500">{t("q.cropCenter")}</span>
        <input
          className={inputCls}
          type="number"
          min={1}
          max={100}
          value={edit.cropPercent ?? 100}
          placeholder="100"
          onChange={(ev) =>
            set({
              cropPercent: ev.target.value === "" ? undefined : Number(ev.target.value),
            })
          }
        />
      </label>
      <label className="col-span-2 flex items-center gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={edit.autocrop ?? false}
          onChange={(ev) => set({ autocrop: ev.target.checked })}
        />
        {t("q.autocropLabel")}
      </label>
      <div className="col-span-2 flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-white"
          onClick={onClose}
        >
          {t("common.done")}
        </button>
      </div>
    </div>
  );
}

export default function QueueList({
  items,
  onSelect,
  selectedId,
  onEditChange,
  onCancel,
  onRetry,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {t("q.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {items.map((it) => {
        const meta = STATUS_META[it.status];
        const ratio =
          it.outputSize !== undefined && it.inputSize > 0
            ? ((it.outputSize / it.inputSize) * 100).toFixed(0)
            : null;
        const editable = it.status === "queued";
        const editing = editingId === it.id;
        const summary = editSummary(it.edit);
        return (
          <div
            key={it.id}
            onClick={() => onSelect(it.id === selectedId ? null : it)}
            className={`border-b border-slate-100 px-4 py-3 transition-colors ${
              selectedId === it.id ? "bg-blue-50" : "hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium text-slate-800">
                {it.name}
              </span>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${meta.cls}`}
              >
                {t(meta.key)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="truncate">
                {formatSize(it.inputSize)}
                {it.outputSize !== undefined && (
                  <>
                    {" → "}
                    <span className="text-slate-600">
                      {formatSize(it.outputSize)}
                    </span>
                    {ratio !== null && (
                      <span className="ml-1 text-green-600">
                        -{100 - Number(ratio)}%
                      </span>
                    )}
                  </>
                )}
                {summary && <span className="ml-2 text-blue-500">{summary}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {it.error && (
                  <span className="truncate text-red-400">{it.error}</span>
                )}
                {it.status === "running" && onCancel && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onCancel(it.id);
                    }}
                    className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-white"
                  >
                    {t("q.cancel")}
                  </button>
                )}
                {(it.status === "error" || it.status === "cancelled") &&
                  onRetry && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onRetry(it.id);
                      }}
                      className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100"
                    >
                      {t("q.retry")}
                    </button>
                  )}
                {editable && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setEditingId(editing ? null : it.id);
                    }}
                    className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-white"
                  >
                    {editing ? t("q.collapse") : t("common.edit")}
                  </button>
                )}
              </span>
            </div>
            {it.warning && (
              <div className="mt-1 truncate text-[11px] text-amber-600">
                ⚠ {it.warning}
              </div>
            )}
            {editing && editable && (
              <EditForm
                edit={it.edit ?? it.params?.edit ?? {}}
                onChange={(e) => onEditChange?.(it.id, e)}
                onClose={() => setEditingId(null)}
              />
            )}
            {it.status === "running" && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-blue-500 transition-all"
                  style={{ width: `${it.progress}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
