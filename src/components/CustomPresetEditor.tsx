import { useState } from "react";
import { deleteCustomPreset, saveCustomPreset } from "../api";
import type { Preset, PresetKind } from "../types";

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

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setMsg("请填写预设名称");
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
      setMsg("已保存");
    } catch (e) {
      setMsg(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Preset) => {
    if (!window.confirm(`删除自定义预设「${p.name}」？`)) return;
    try {
      await deleteCustomPreset(p.id);
      onChanged();
    } catch (e) {
      setMsg(`删除失败：${String(e)}`);
    }
  };

  return (
    <div className="border-b border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span>✎ 预设管理器（{customs.length} 个自定义）</span>
        <span className="text-xs text-slate-400">{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => startNew("video")}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + 新建视频预设
            </button>
            <button
              type="button"
              onClick={() => startNew("image")}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + 新建图片预设
            </button>
            {msg && <span className="self-center text-xs text-slate-500">{msg}</span>}
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
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50"
                    >
                      删除
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
                  {draft.id ? "编辑预设" : "新建预设"}（{draft.kind === "video" ? "视频" : "图片"}）
                </span>
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  取消
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block">
                  <span className={labelCls}>预设名称 *</span>
                  <input
                    className={inputCls}
                    value={draft.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="如 我的抖音预设"
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>平台标签</span>
                  <input
                    className={inputCls}
                    value={draft.platform}
                    onChange={(e) => set("platform", e.target.value)}
                    placeholder="douyin / 自定义"
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>备注（可选）</span>
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
                      <span className={labelCls}>编码器</span>
                      <select
                        className={inputCls}
                        value={draft.codec}
                        onChange={(e) => set("codec", e.target.value)}
                      >
                        <option value="libx264">libx264（软件·兼容最好）</option>
                        <option value="libx265">libx265（软件·HEVC）</option>
                        <option value="libsvtav1">libsvtav1（软件·AV1）</option>
                        <option value="h264_nvenc">h264_nvenc（N卡硬编）</option>
                        <option value="hevc_nvenc">hevc_nvenc（N卡硬编 HEVC）</option>
                        <option value="h264_qsv">h264_qsv（Intel 核显）</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelCls}>
                        CRF / CQ（NVENC 用 -cq，QSV 用 -global_quality）
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
                      <span className={labelCls}>编码速度 preset</span>
                      <input
                        className={inputCls}
                        value={draft.preset}
                        onChange={(e) => set("preset", e.target.value)}
                        placeholder="medium / slow / p1-p7"
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>分辨率上限（如 1920:-2）</span>
                      <input
                        className={inputCls}
                        value={draft.scale}
                        onChange={(e) => set("scale", e.target.value)}
                        placeholder="留空 = 不缩放"
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>GOP 关键帧间隔（可选）</span>
                      <input
                        className={inputCls}
                        type="number"
                        value={draft.keyint}
                        onChange={(e) => set("keyint", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>音频码率 kbps（留空 = 去音频）</span>
                      <input
                        className={inputCls}
                        type="number"
                        value={draft.audioBitrate}
                        onChange={(e) => set("audioBitrate", e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>最大码率 kbps（可选）</span>
                      <input
                        className={inputCls}
                        type="number"
                        value={draft.maxBitrate}
                        onChange={(e) => set("maxBitrate", e.target.value)}
                        placeholder="如 3000"
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>H.264 level（可选）</span>
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
                      <span className={labelCls}>输出格式</span>
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
                      <span className={labelCls}>压缩引擎</span>
                      <select
                        className={inputCls}
                        value={draft.engine}
                        onChange={(e) => set("engine", e.target.value)}
                      >
                        <option value="mozjpeg">mozjpeg（JPEG）</option>
                        <option value="pngquant">pngquant（PNG）</option>
                        <option value="libwebp">libwebp（WebP）</option>
                        <option value="libavif">libavif（AVIF）</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelCls}>质量（可选，0-100）</span>
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
                      <span className={labelCls}>体积上限 KB（可选）</span>
                      <input
                        className={inputCls}
                        type="number"
                        value={draft.maxSizeKb}
                        onChange={(e) => set("maxSizeKb", e.target.value)}
                        placeholder="如 100"
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <span className={labelCls}>去除元数据</span>
                      <label className="flex items-center gap-2 pt-1 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={draft.stripMetadata}
                          onChange={(e) => set("stripMetadata", e.target.checked)}
                        />
                        压缩时剥离 EXIF 等元数据（更小体积）
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
                  {saving ? "保存中…" : "保存预设"}
                </button>
                <span className="text-[11px] text-slate-400">
                  自定义预设保存到本地配置目录，不随安装包分发
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
