import { useState } from "react";
import { deleteCustomPreset, saveCustomPreset } from "../api";
import type { Preset, PresetKind } from "../types";
import { t } from "../i18n";

interface Props {
  presets: Preset[];
  onChanged: () => void;
}

interface Draft {
  id: string; // 新建时为空串，保存前生成
  name: string;
  platform: string;
  kind: PresetKind;
  note: string;
  // video
  codec: string;
  crf: string;
  preset: string;
  level: string;
  keyint: string;
  audioBitrate: string;
  scale: string;
  maxBitrate: string;
  // image
  format: string;
  engine: string;
  quality: string;
  maxSizeKb: string;
  stripMetadata: boolean;
}

const emptyDraft = (kind: PresetKind): Draft => ({
  id: "",
  name: "",
  platform: "custom",
  kind,
  note: "",
  codec: "libx264",
  crf: "23.5",
  preset: "medium",
  level: "",
  keyint: "250",
  audioBitrate: "128",
  scale: "",
  maxBitrate: "",
  format: "jpeg",
  engine: "mozjpeg",
  quality: "80",
  maxSizeKb: "",
  stripMetadata: true,
});

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const labelCls = "mb-1 block text-xs font-medium text-slate-500";

/** 自定义预设管理器：新建 / 编辑 / 删除，保存到用户配置目录 */
export default function CustomPresetEditor({ presets, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const customs = presets.filter((p) => p.id.startsWith("custom-"));

  const startNew = (kind: PresetKind) => {
    setDraft(emptyDraft(kind));
    setMsg("");
  };

  const startEdit = (p: Preset) => {
    setDraft({
      id: p.id,
      name: p.name,
      platform: p.platform,
      kind: p.kind,
      note: p.note ?? "",
      codec: p.video?.codec ?? "libx264",
      crf: p.video ? String(p.video.crf) : "23.5",
      preset: p.video?.preset ?? "medium",
      level: p.video?.level ?? "",
      keyint: p.video?.keyint != null ? String(p.video.keyint) : "250",
      audioBitrate: p.video?.audio ? String(p.video.audio.bitrate_kbps) : "128",
      scale:
        typeof p.filters?.scale === "string" ? String(p.filters.scale) : "",
      maxBitrate:
        p.constraints?.max_bitrate_kbps != null
          ? String(p.constraints.max_bitrate_kbps)
          : "",
      format: p.image?.format ?? "jpeg",
      engine: p.image?.engine ?? "mozjpeg",
      quality: p.image?.quality != null ? String(p.image.quality) : "80",
      maxSizeKb:
        p.image?.max_size_kb != null ? String(p.image.max_size_kb) : "",
      stripMetadata: p.image?.strip_metadata ?? true,
    });
    setMsg("");
  };

  /** v0.6.0：从内置平台预设快速填充（保留可编辑，保存为新自定义预设） */
  const startFromPreset = (p: Preset) => {
    if (!p) return;
    setDraft({
      id: "",
      name: p.name + "（自定）",
      platform: p.platform,
      kind: p.kind,
      note: p.note ?? "",
      codec: p.video?.codec ?? "libx264",
      crf: p.video ? String(p.video.crf) : "23.5",
      preset: p.video?.preset ?? "medium",
      level: p.video?.level ?? "",
      keyint: p.video?.keyint != null ? String(p.video.keyint) : "250",
      audioBitrate: p.video?.audio ? String(p.video.audio.bitrate_kbps) : "128",
      scale:
        typeof p.filters?.scale === "string" ? String(p.filters.scale) : "",
      maxBitrate:
        p.constraints?.max_bitrate_kbps != null
          ? String(p.constraints.max_bitrate_kbps)
          : "",
      format: p.image?.format ?? "jpeg",
      engine: p.image?.engine ?? "mozjpeg",
      quality: p.image?.quality != null ? String(p.image.quality) : "80",
      maxSizeKb:
        p.image?.max_size_kb != null ? String(p.image.max_size_kb) : "",
      stripMetadata: p.image?.strip_metadata ?? true,
    });
    setMsg("");
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setMsg(t("pe.nameRequired"));
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const preset: Preset = {
        id:
          draft.id ||
          `custom-${draft.name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 24) || "preset"}`,
        name: draft.name.trim(),
        platform: draft.platform.trim() || "custom",
        kind: draft.kind,
        tags: ["custom"],
        note: draft.note.trim() || undefined,
        constraints:
          draft.maxBitrate || draft.scale
            ? {
                max_bitrate_kbps: draft.maxBitrate
                  ? Number(draft.maxBitrate)
                  : undefined,
                max_resolution: draft.scale
                  ? draft.scale.replace(":-2", "")
                  : undefined,
              }
            : undefined,
        filters: draft.scale ? { scale: draft.scale } : undefined,
        video:
          draft.kind === "video"
            ? {
                codec: draft.codec,
                crf: Number(draft.crf) || 23.5,
                preset: draft.preset.trim() || "medium",
                level: draft.level.trim() || undefined,
                keyint: draft.keyint ? Number(draft.keyint) : undefined,
                audio: draft.audioBitrate
                  ? { codec: "aac", bitrate_kbps: Number(draft.audioBitrate) || 128 }
                  : undefined,
              }
            : undefined,
        image:
          draft.kind === "image"
            ? {
                format: draft.format,
                engine: draft.engine,
                quality: draft.quality ? Number(draft.quality) : undefined,
                max_size_kb: draft.maxSizeKb
                  ? Number(draft.maxSizeKb)
                  : undefined,
                strip_metadata: draft.stripMetadata,
              }
            : undefined,
      };
      await saveCustomPreset(preset);
      setDraft(null);
      onChanged();
      setMsg(t("common.saved"));
    } catch (e) {
      setMsg(t("pe.saveFailed", { e: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Preset) => {
    if (!window.confirm(t("pe.confirmDelete", { n: p.name }))) return;
    try {
      await deleteCustomPreset(p.id);
      onChanged();
    } catch (e) {
      setMsg(t("pe.deleteFailed", { e: String(e) }));
    }
  };

  return (
    <div className="border-b border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span>✎ {t("pe.title", { n: customs.length })}</span>
        <span className="text-xs text-slate-400">{open ? t("common.collapse") : t("common.expand")}</span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => startNew("video")}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + {t("pe.newVideo")}
            </button>
            <button
              type="button"
              onClick={() => startNew("image")}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + {t("pe.newImage")}
            </button>
            {msg && <span className="self-center text-xs text-slate-500">{msg}</span>}
          </div>

          {/* v0.6.0 从内置平台预设快速填充 */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-2 text-xs font-medium text-slate-500">{t("pe.fillFromPreset")}</p>
            <select
              value=""
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (p) startFromPreset(p);
              }}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
            >
              <option value="">{t("pe.fillPlaceholder")}</option>
              {presets
                .filter((p) => p.kind === "video" || p.kind === "pdf")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {t("ps.video")} · {p.name}
                  </option>
                ))}
              {presets
                .filter((p) => p.kind === "image")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {t("ps.image")} · {p.name}
                  </option>
                ))}
            </select>
            <p className="mt-1.5 text-[11px] text-slate-400">{t("pe.customHint")}</p>
          </div>

          {customs.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {customs.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {p.name}
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {p.kind}
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {p.video
                        ? `${p.video.codec} · CRF ${p.video.crf} · ${p.video.preset}`
                        : p.image
                          ? `${p.image.engine} → ${p.image.format}`
                          : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50"
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {draft && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">
                  {draft.id ? t("pe.editPreset") : t("pe.newPreset")}（{draft.kind === "video" ? t("pe.kindVideo") : t("pe.kindImage")}）
                </span>
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  {t("common.cancel")}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block">
                  <span className={labelCls}>{t("pe.nameLabel")}</span>
                  <input
                    className={inputCls}
                    value={draft.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="如 我的抖音预设"
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>{t("pe.platformLabel")}</span>
                  <input
                    className={inputCls}
                    value={draft.platform}
                    onChange={(e) => set("platform", e.target.value)}
                    placeholder="douyin / 自定义"
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>{t("pe.noteLabel")}</span>
                  <input
                    className={inputCls}
                    value={draft.note}
                    onChange={(e) => set("note", e.target.value)}
                    placeholder="参数来源或用途"
                  />
                </label>

                {draft.kind === "video" ? (
                  <>
                    <label className="block">
                      <span className={labelCls}>{t("pe.codecLabel")}</span>
                      <select
                        className={inputCls}
                        value={draft.codec}
                        onChange={(e) => set("codec", e.target.value)}
                      >
                        <option value="libx264">{t("pe.codecX264")}</option>
                        <option value="libx265">{t("pe.codecX265")}</option>
                        <option value="libsvtav1">{t("pe.codecAv1")}</option>
                        <option value="h264_nvenc">{t("pe.codecNvencH264")}</option>
                        <option value="hevc_nvenc">{t("pe.codecNvencHevc")}</option>
                        <option value="h264_qsv">{t("pe.codecQsvH264")}</option>
                        <option value="hevc_qsv">{t("pe.codecQsvHevc")}</option>
                        <option value="h264_videotoolbox">{t("pe.codecVtbH264")}</option>
                        <option value="hevc_videotoolbox">{t("pe.codecVtbHevc")}</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelCls}>
                        {t("pe.crfLabel")}
                      </span>
                      <input
                        className={inputCls}
                        type="number"
                        min={0}
                        max={51}
                        step={0.5}
                        value={draft.crf}
                        onChange={(e) => set("crf", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.presetLabel")}</span>
                      <input
                        className={inputCls}
                        value={draft.preset}
                        onChange={(e) => set("preset", e.target.value)}
                        placeholder="medium / slow / p1-p7"
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.scaleLabel")}</span>
                      <input
                        className={inputCls}
                        value={draft.scale}
                        onChange={(e) => set("scale", e.target.value)}
                        placeholder="留空 = 不缩放"
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.keyintLabel")}</span>
                      <input
                        className={inputCls}
                        type="number"
                        value={draft.keyint}
                        onChange={(e) => set("keyint", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.audioLabel")}</span>
                      <input
                        className={inputCls}
                        type="number"
                        value={draft.audioBitrate}
                        onChange={(e) => set("audioBitrate", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.maxBitrateLabel")}</span>
                      <input
                        className={inputCls}
                        type="number"
                        value={draft.maxBitrate}
                        onChange={(e) => set("maxBitrate", e.target.value)}
                        placeholder="如 3000"
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.levelLabel")}</span>
                      <input
                        className={inputCls}
                        value={draft.level}
                        onChange={(e) => set("level", e.target.value)}
                        placeholder="如 4.1"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="block">
                      <span className={labelCls}>{t("pe.formatLabel")}</span>
                      <select
                        className={inputCls}
                        value={draft.format}
                        onChange={(e) => set("format", e.target.value)}
                      >
                        <option value="jpeg">JPEG</option>
                        <option value="png">PNG</option>
                        <option value="webp">WebP</option>
                        <option value="avif">AVIF</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.engineLabel")}</span>
                      <select
                        className={inputCls}
                        value={draft.engine}
                        onChange={(e) => set("engine", e.target.value)}
                      >
                        <option value="mozjpeg">{t("pe.engineMozjpeg")}</option>
                        <option value="pngquant">{t("pe.enginePngquant")}</option>
                        <option value="libwebp">{t("pe.engineWebp")}</option>
                        <option value="libavif">{t("pe.engineAvif")}</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.qualityLabel")}</span>
                      <input
                        className={inputCls}
                        type="number"
                        min={0}
                        max={100}
                        value={draft.quality}
                        onChange={(e) => set("quality", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t("pe.maxSizeLabel")}</span>
                      <input
                        className={inputCls}
                        type="number"
                        value={draft.maxSizeKb}
                        onChange={(e) => set("maxSizeKb", e.target.value)}
                        placeholder="如 100"
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <span className={labelCls}>{t("pe.stripMetaLabel")}</span>
                      <label className="flex items-center gap-2 pt-1 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={draft.stripMetadata}
                          onChange={(e) => set("stripMetadata", e.target.checked)}
                        />
                        {t("pe.stripMetaHint")}
                      </label>
                    </label>
                  </>
                )}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {saving ? t("pe.saving") : t("pe.savePreset")}
                </button>
                <span className="text-[11px] text-slate-400">
                  {t("pe.customHint")}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
