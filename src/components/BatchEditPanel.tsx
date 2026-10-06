import { useState } from "react";
import type { ImageEditOptions } from "../types";
import { pickSubtitleFile, pickWatermarkImage } from "../api";
import { t } from "../i18n";


/**
 * v0.4.0/v0.5.0 全局批处理面板：
 *  - 图片批量编辑（尺寸/旋转/裁剪/文字水印/图片水印/输出格式），应用到队列中全部图片任务
 *  - 图片转 PDF / OCR 识别文字（互斥）
 *  - 视频容器转换 / 音轨提取 / 封面抽帧 / 烧录字幕（互斥）
 *  - PDF 瘦身（PDF 任务）
 *  - 统一重命名模板（{seq}/{date}/{time} 等变量）
 *  - 替换源文件（全局）
 * 与 WPS「图片批量工具箱 + 视频工具箱」对齐，纯本地处理不上传。
 */
export default function BatchEditPanel({
  imageEdit,
  onImageEdit,
  container,
  onContainer,
  audioOnly,
  onAudioOnly,
  pdfMode,
  onPdfMode,
  coverAt,
  onCoverAt,
  replaceSource,
  onReplaceSource,
  pdfSlimMode,
  onPdfSlimMode,
  pdfSlimQuality,
  onPdfSlimQuality,
  subtitlePath,
  onSubtitlePath,
  ocrMode,
  onOcrMode,
  batchRename,
  onBatchRename,
  kind = "all",
}: {
  imageEdit: ImageEditOptions | null;
  onImageEdit: (v: ImageEditOptions | null) => void;
  container: string;
  onContainer: (v: string) => void;
  audioOnly: string;
  onAudioOnly: (v: string) => void;
  pdfMode: boolean;
  onPdfMode: (v: boolean) => void;
  coverAt: string;
  onCoverAt: (v: string) => void;
  replaceSource: boolean;
  onReplaceSource: (v: boolean) => void;
  pdfSlimMode: boolean;
  onPdfSlimMode: (v: boolean) => void;
  pdfSlimQuality: number;
  onPdfSlimQuality: (v: number) => void;
  subtitlePath: string;
  onSubtitlePath: (v: string) => void;
  ocrMode: boolean;
  onOcrMode: (v: boolean) => void;
  batchRename: string;
  onBatchRename: (v: string) => void;
  /** v0.6.0 分页：image 只显示图片块 / video 只显示视频块+PDF瘦身 / all 全显示 */
  kind?: "image" | "video" | "all";
}) {
  const [ie, setIe] = useState<ImageEditOptions>(
    imageEdit ?? {
      watermarkSize: 32,
      watermarkOpacity: 0.6,
      watermarkPosition: "br",
      watermarkRotate: 0,
    }
  );
  const enabled = imageEdit !== null;

  const set = <K extends keyof ImageEditOptions>(
    k: K,
    v: ImageEditOptions[K]
  ) => {
    const next = { ...ie, [k]: v };
    setIe(next);
    onImageEdit(next);
  };

  const pickWm = async () => {
    const p = await pickWatermarkImage();
    if (p) set("watermarkImage", p);
  };

  return (
    <section className="rounded-xl border border-slate-100 bg-white">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2">
        {/* 标题 */}
        <div className="w-32 shrink-0">
          <h3 className="whitespace-nowrap text-[13px] font-semibold text-slate-800">{t("batch.title")}</h3>
        </div>

        {/* 第 1 行：图片功能（图片页显示） */}
        {kind !== "video" && (
          <>
            <span className="whitespace-nowrap text-xs font-semibold text-slate-600">{t("batch.imageTitle")}</span>
            <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-600">
              <input type="checkbox" checked={pdfMode} onChange={(e) => {
                onPdfMode(e.target.checked); if (e.target.checked) onAudioOnly(""); if (e.target.checked) onOcrMode(false);
              }} className="h-3 w-3 accent-blue-600" />
              {t("batch.toPdf")}
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-600">
              <input type="checkbox" checked={ocrMode} onChange={(e) => {
                onOcrMode(e.target.checked); if (e.target.checked) onPdfMode(false); if (e.target.checked) onImageEdit(null);
              }} className="h-3 w-3 accent-blue-600" />
              {t("batch.ocr")}
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.scalePercent")}</span>
              <input type="number" placeholder="50" step={1} min={1} max={1000} value={(ie.scalePercent as number | undefined) ?? ""} disabled={!enabled} className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-100" onChange={(e) => { const v = e.target.value; set("scalePercent", v === "" ? undefined : Number(v)); }} />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.width")}</span>
              <input type="number" placeholder="1920" step={1} min={1} value={(ie.width as number | undefined) ?? ""} disabled={!enabled} className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-100" onChange={(e) => { const v = e.target.value; set("width", v === "" ? undefined : Number(v)); }} />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.height")}</span>
              <input type="number" placeholder="1080" step={1} min={1} value={(ie.height as number | undefined) ?? ""} disabled={!enabled} className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-100" onChange={(e) => { const v = e.target.value; set("height", v === "" ? undefined : Number(v)); }} />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.rotate")}</span>
              <input type="number" placeholder="0" step={90} value={(ie.rotate as number | undefined) ?? ""} disabled={!enabled} className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-100" onChange={(e) => { const v = e.target.value; set("rotate", v === "" ? undefined : Number(v)); }} />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.cropPercent")}</span>
              <input type="number" placeholder="100" step={1} min={1} max={100} value={(ie.cropPercent as number | undefined) ?? ""} disabled={!enabled} className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-100" onChange={(e) => { const v = e.target.value; set("cropPercent", v === "" ? undefined : Number(v)); }} />
            </label>
            <label className="flex min-w-[120px] flex-1 items-center gap-1">
              <span className="shrink-0 text-[11px] text-slate-500">{t("batch.wmText")}</span>
              <input placeholder={t("batch.wmPick")} value={ie.watermarkText ?? ""} disabled={!enabled} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-100" onChange={(e) => set("watermarkText", e.target.value || undefined)} />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.wmImage")}</span>
              <button type="button" disabled={!enabled} onClick={pickWm} className="shrink-0 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400">{t("common.choose")}</button>
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.fontSize")}</span>
              <input type="number" placeholder="32" step={1} min={1} value={(ie.watermarkSize as number | undefined) ?? ""} disabled={!enabled} className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-100" onChange={(e) => { const v = e.target.value; set("watermarkSize", v === "" ? undefined : Number(v)); }} />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.opacity", { p: Math.round((ie.watermarkOpacity ?? 0.6) * 100) })}</span>
              <input type="range" min={0.1} max={1} step={0.05} value={ie.watermarkOpacity ?? 0.6} disabled={!enabled} className="w-16 accent-blue-600" onChange={(e) => set("watermarkOpacity", Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.position")}</span>
              <select value={ie.watermarkPosition ?? "br"} disabled={!enabled} className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none disabled:bg-slate-100" onChange={(e) => set("watermarkPosition", e.target.value)}>
                <option value="tl">{t("batch.posTl")}</option><option value="tc">{t("batch.posTc")}</option><option value="tr">{t("batch.posTr")}</option>
                <option value="ml">{t("batch.posMl")}</option><option value="mc">{t("batch.posMc")}</option><option value="mr">{t("batch.posMr")}</option>
                <option value="bl">{t("batch.posBl")}</option><option value="bc">{t("batch.posBc")}</option><option value="br">{t("batch.posBr")}</option>
              </select>
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.outFormat")}</span>
              <select value={ie.format ?? ""} disabled={!enabled} className="w-16 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none disabled:bg-slate-100" onChange={(e) => set("format", e.target.value || undefined)}>
                <option value="">{t("batch.keepFormat")}</option><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option><option value="bmp">BMP</option><option value="avif">AVIF</option>
              </select>
            </label>
          </>
        )}

        {/* 视频页第 1 行中部提示（不占宽度，吸收空白） */}
        {kind === "video" && (
          <p className="min-w-0 flex-1 text-[11px] text-slate-500">{t("batch.subtitle")}</p>
        )}
        {/* 启用批处理按钮 */}
        <button type="button" onClick={() => { if (enabled) { onImageEdit(null); } else { onImageEdit({ ...ie }); onAudioOnly(""); } }} className={
          enabled ? "ml-auto shrink-0 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100" : "ml-auto shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
        }>
          {enabled ? t("batch.disable") : t("batch.enable")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 px-3 py-2">
        {/* 第 2 行：视频功能（视频页显示）+ PDF 瘦身 + 全局 */}
        {kind !== "image" && (
          <>
            <span className="whitespace-nowrap text-xs font-semibold text-slate-600">{t("batch.videoTitle")}</span>
            <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-600">
              <input type="checkbox" checked={coverAt !== ""} disabled={subtitlePath !== ""} onChange={(e) => {
                if (e.target.checked) { onCoverAt(coverAt || "1"); onContainer(""); onAudioOnly(""); onSubtitlePath(""); } else { onCoverAt(""); }
              }} className="h-3 w-3 accent-blue-600" />
              {t("batch.coverFrame")}
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.container")}</span>
              <select value={container} disabled={audioOnly !== "" || coverAt !== "" || subtitlePath !== ""} className="w-16 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none disabled:bg-slate-100" onChange={(e) => onContainer(e.target.value)}>
                <option value="">{t("batch.noContainer")}</option><option value="mp4">MP4</option><option value="mkv">MKV</option><option value="avi">AVI</option><option value="webm">WebM</option><option value="mov">MOV</option><option value="flv">FLV</option><option value="ts">TS</option><option value="m4v">M4V</option><option value="ogv">OGV</option><option value="wmv">WMV</option>
              </select>
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.audioExtract")}</span>
              <select value={audioOnly} disabled={container !== "" || coverAt !== "" || subtitlePath !== ""} className="w-16 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none disabled:bg-slate-100" onChange={(e) => onAudioOnly(e.target.value)}>
                <option value="">{t("batch.noAudio")}</option><option value="mp3">{t("batch.audioMp3")}</option><option value="wav">{t("batch.audioWav")}</option><option value="m4a">{t("batch.audioM4a")}</option><option value="flac">{t("batch.audioFlac")}</option><option value="ogg">{t("batch.audioOgg")}</option>
              </select>
            </label>
            <label className="flex min-w-[120px] flex-1 items-center gap-1">
              <span className="shrink-0 text-[11px] text-slate-500">{t("batch.burnSubtitle")}</span>
              <input placeholder={t("batch.subtitlePick")} value={subtitlePath} disabled={container !== "" || audioOnly !== "" || coverAt !== ""} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-100" onChange={(e) => onSubtitlePath(e.target.value)} />
              <button type="button" disabled={container !== "" || audioOnly !== "" || coverAt !== ""} onClick={async () => { const p = await pickSubtitleFile(); if (p) { onSubtitlePath(p); onContainer(""); onAudioOnly(""); onCoverAt(""); } }} className="shrink-0 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400">{t("common.choose")}</button>
            </label>
            <label className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[11px] text-slate-500">{t("batch.coverAt")}</span>
              <input type="number" min={0} step={0.5} value={coverAt} disabled={coverAt === ""} className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none disabled:bg-slate-100" onChange={(e) => onCoverAt(e.target.value)} />
            </label>
          </>
        )}

        {/* PDF 瘦身 */}
        <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-600" title={t("batch.pdfSlimHint")}>
          <input type="checkbox" checked={pdfSlimMode} onChange={(e) => onPdfSlimMode(e.target.checked)} className="h-3 w-3 accent-blue-600" />
          {t("batch.pdfSlim")}
        </label>
        <label className={"flex items-center gap-1 whitespace-nowrap " + (pdfSlimMode ? "" : "pointer-events-none opacity-40")}>
          <span className="text-[11px] text-slate-500">{t("batch.pdfSlimQuality")}</span>
          <input type="range" min={1} max={10} value={pdfSlimQuality} disabled={!pdfSlimMode} className="w-20 accent-blue-600" onChange={(e) => onPdfSlimQuality(Number(e.target.value))} />
          <span className="text-[11px] text-slate-600">{t("batch.pdfSlimLabel", { c: 11 - pdfSlimQuality, s: pdfSlimQuality })}</span>
        </label>

        {/* 全局：重命名 + 替换源 */}
        <label className="flex min-w-[120px] flex-1 items-center gap-1">
          <span className="shrink-0 text-[11px] text-slate-500">{t("batch.renameTemplate")}</span>
          <input placeholder={t("batch.renamePlaceholder")} value={batchRename} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500" onChange={(e) => onBatchRename(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-600">
          <input type="checkbox" checked={replaceSource} onChange={(e) => onReplaceSource(e.target.checked)} className="h-3 w-3 accent-blue-600" />
          {t("batch.replaceSource")}
          <span className="text-[11px] font-normal text-slate-500">{t("batch.replaceHint")}</span>
        </label>
      </div>
    </section>
  );
}
