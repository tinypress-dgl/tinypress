import { useState } from "react";
import type { Preset } from "../types";
import { platformLabel, t } from "../i18n";

export type MediaType = "image" | "video";

interface Props {
  presets: Preset[];
  selected: string;
  onSelect: (id: string) => void;
  /** v0.6.0 当前媒体类型（左侧类型导航选中项） */
  type: MediaType;
  onTypeChange: (v: MediaType) => void;
}

/** 分组头：可点击折叠/展开该分组下的预设列表 */
function GroupHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between px-2 pb-1 pt-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400 hover:text-slate-600"
    >
      <span>
        {label}（{count}）
      </span>
      <span className="text-[10px]">{open ? t("ps.groupCollapse") : t("ps.groupExpand")}</span>
    </button>
  );
}

export default function PresetSelector({ presets, selected, onSelect, type, onTypeChange }: Props) {
  const videos = presets.filter((p) => p.kind === "video" || p.kind === "pdf");
  const images = presets.filter((p) => p.kind === "image");
  const [videoOpen, setVideoOpen] = useState(true);
  const [imageOpen, setImageOpen] = useState(true);

  const renderItem = (p: Preset) => (
    <button
      key={p.id}
      onClick={() => onSelect(p.id)}
      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        selected === p.id
          ? "bg-blue-600 text-white"
          : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="truncate">{p.name}</span>
        <span
          className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
            selected === p.id
              ? "bg-white/20 text-white"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {platformLabel(p.platform)}
        </span>
      </div>
      {p.constraints && (
        <div
          className={`mt-0.5 truncate text-[11px] ${
            selected === p.id ? "text-blue-100" : "text-slate-400"
          }`}
        >
          {[
            p.constraints.max_size_kb && `≤${p.constraints.max_size_kb}KB`,
            p.constraints.max_bitrate_kbps && `≤${p.constraints.max_bitrate_kbps}kbps`,
            p.constraints.max_resolution && p.constraints.max_resolution,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </button>
  );

  const typeBtn = (id: MediaType, label: string) => (
    <button
      type="button"
      onClick={() => onTypeChange(id)}
      className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
        type === id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* v0.6.0 左侧媒体类型导航 */}
      <div className="border-b border-slate-100 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">{t("ps.title")}</h2>
        </div>
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {typeBtn("image", t("app.tabImages"))}
          {typeBtn("video", t("app.tabVideos"))}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {type === "image" && (
          <>
            <GroupHeader
              label={t("ps.image")}
              count={images.length}
              open={imageOpen}
              onToggle={() => setImageOpen((v) => !v)}
            />
            {imageOpen && images.map(renderItem)}
          </>
        )}
        {type === "video" && (
          <>
            <GroupHeader
              label={t("ps.video")}
              count={videos.length}
              open={videoOpen}
              onToggle={() => setVideoOpen((v) => !v)}
            />
            {videoOpen && videos.map(renderItem)}
          </>
        )}
      </div>
      <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        {t("ps.footer")}
      </div>
    </aside>
  );
}
