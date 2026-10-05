import { useState } from "react";
import type { ImageEditOptions } from "../types";
import { pickSubtitleFile, pickWatermarkImage } from "../api";
import { t } from "../i18n";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";
const labelCls = "block text-xs font-medium text-slate-500 mb-1";
const secCls = "mb-3 rounded-xl border border-slate-200 p-3";

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

  const num = (
    label: string,
    key: keyof ImageEditOptions,
    placeholder: string,
    step?: number,
    min?: number,
    max?: number
  ) => (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input
        type="number"
        placeholder={placeholder}
        step={step}
        min={min}
        max={max}
        value={(ie[key] as number | undefined) ?? ""}
        disabled={!enabled}
        className={inputCls}
        onChange={(e) => {
          const v = e.target.value;
          set(key, v === "" ? undefined : Number(v));
        }}
      />
    </label>
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            {t("batch.title")}
          </h3>
          <p className="text-xs text-slate-500">
            {t("batch.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (enabled) {
              onImageEdit(null);
            } else {
              onImageEdit({ ...ie });
              onAudioOnly("");
            }
          }}
          className={
            enabled
              ? "rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100"
              : "rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          }
        >
          {enabled ? t("batch.disable") : t("batch.enable")}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
        {/* ===== 图片批量编辑（图片页显示） ===== */}
        {kind !== "video" && (
        <div className={secCls}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t("batch.imageTitle")}
            </h4>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={pdfMode}
                onChange={(e) => {
                  onPdfMode(e.target.checked);
                  if (e.target.checked) onAudioOnly("");
                  if (e.target.checked) onOcrMode(false);
                }}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              {t("batch.toPdf")}
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={ocrMode}
                onChange={(e) => {
                  onOcrMode(e.target.checked);
                  if (e.target.checked) onPdfMode(false);
                  if (e.target.checked) onImageEdit(null);
                }}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              {t("batch.ocr")}
            </label>
          </div>
          <p className={pdfMode ? "mb-2 text-xs text-amber-600" : "hidden"}>
            {t("batch.pdfHint")}
          </p>
          <p className={ocrMode ? "mb-2 text-xs text-amber-600" : "hidden"}>
            {t("batch.ocrHint")}
          </p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {num(t("batch.scalePercent"), "scalePercent", "如 50=缩半", 1, 1, 1000)}
            {num(t("batch.width"), "width", "如 1920", 1, 1)}
            {num(t("batch.height"), "height", "如 1080", 1, 1)}
            {num(t("batch.rotate"), "rotate", "0/90/180…", 90)}
            {num(t("batch.cropPercent"), "cropPercent", "居中裁剪", 1, 1, 100)}
          </div>

          <h5 className="mb-1.5 text-xs font-medium text-slate-500">{t("batch.watermark")}</h5>
          <label className="mb-2 block">
            <span className={labelCls}>{t("batch.wmText")}</span>
            <input
              placeholder="如 TinyPress / 公司名"
              value={ie.watermarkText ?? ""}
              disabled={!enabled}
              className={inputCls}
              onChange={(e) => set("watermarkText", e.target.value || undefined)}
            />
          </label>
          <label className="mb-2 block">
            <span className={labelCls}>{t("batch.wmImage")}</span>
            <div className="flex gap-2">
              <input
                placeholder={t("batch.wmPick")}
                value={ie.watermarkImage ?? ""}
                disabled={!enabled}
                className={inputCls}
                onChange={(e) =>
                  set("watermarkImage", e.target.value || undefined)
                }
              />
              <button
                type="button"
                disabled={!enabled}
                onClick={pickWm}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {t("common.choose")}
              </button>
            </div>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {num("字号/宽", "watermarkSize", "32", 1, 1)}
            <label className="block">
              <span className={labelCls}>{t("batch.opacity", { p: Math.round((ie.watermarkOpacity ?? 0.6) * 100) })}</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={ie.watermarkOpacity ?? 0.6}
                disabled={!enabled}
                className="w-full accent-blue-600"
                onChange={(e) => set("watermarkOpacity", Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className={labelCls}>{t("batch.position")}</span>
              <select
                value={ie.watermarkPosition ?? "br"}
                disabled={!enabled}
                className={inputCls}
                onChange={(e) => set("watermarkPosition", e.target.value)}
              >
                <option value="tl">{t("batch.posTl")}</option>
                <option value="tc">{t("batch.posTc")}</option>
                <option value="tr">{t("batch.posTr")}</option>
                <option value="ml">{t("batch.posMl")}</option>
                <option value="mc">{t("batch.posMc")}</option>
                <option value="mr">{t("batch.posMr")}</option>
                <option value="bl">{t("batch.posBl")}</option>
                <option value="bc">{t("batch.posBc")}</option>
                <option value="br">{t("batch.posBr")}</option>
              </select>
            </label>
          </div>
          <label className="mt-2 block">
            <span className={labelCls}>{t("batch.outFormat")}</span>
            <select
              value={ie.format ?? ""}
              disabled={!enabled}
              className={inputCls}
              onChange={(e) => set("format", e.target.value || undefined)}
            >
              <option value="">{t("batch.keepFormat")}</option>
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
              <option value="bmp">BMP</option>
              <option value="avif">AVIF</option>
            </select>
          </label>
        </div>
        )}

        {/* ===== 视频批量处理（视频页显示） ===== */}
        {kind !== "image" && (
        <div className={secCls}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              {t("batch.videoTitle")}
            </h4>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={coverAt !== ""}
                disabled={subtitlePath !== ""}
                onChange={(e) => {
                  if (e.target.checked) {
                    onCoverAt(coverAt || "1");
                    onContainer("");
                    onAudioOnly("");
                    onSubtitlePath("");
                  } else {
                    onCoverAt("");
                  }
                }}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              {t("batch.coverFrame")}
            </label>
          </div>
          <label className="mb-2 block">
            <span className={labelCls}>{t("batch.container")}</span>
            <select
              value={container}
              disabled={audioOnly !== "" || coverAt !== "" || subtitlePath !== ""}
              className={inputCls}
              onChange={(e) => onContainer(e.target.value)}
            >
              <option value="">{t("batch.noContainer")}</option>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
              <option value="avi">AVI</option>
              <option value="webm">WebM</option>
              <option value="mov">MOV</option>
              <option value="flv">FLV</option>
              <option value="ts">TS</option>
              <option value="m4v">M4V</option>
              <option value="ogv">OGV</option>
              <option value="wmv">WMV</option>
            </select>
          </label>
          <label className="mb-2 block">
            <span className={labelCls}>{t("batch.audioExtract")}</span>
            <select
              value={audioOnly}
              disabled={container !== "" || coverAt !== "" || subtitlePath !== ""}
              className={inputCls}
              onChange={(e) => onAudioOnly(e.target.value)}
            >
              <option value="">{t("batch.noAudio")}</option>
              <option value="mp3">{t("batch.audioMp3")}</option>
              <option value="wav">{t("batch.audioWav")}</option>
              <option value="m4a">{t("batch.audioM4a")}</option>
              <option value="flac">{t("batch.audioFlac")}</option>
              <option value="ogg">{t("batch.audioOgg")}</option>
            </select>
          </label>
          <label className="mb-2 block">
            <span className={labelCls}>{t("batch.burnSubtitle")}</span>
            <div className="flex gap-2">
              <input
                placeholder={t("batch.subtitlePick")}
                value={subtitlePath}
                disabled={container !== "" || audioOnly !== "" || coverAt !== ""}
                className={inputCls}
                onChange={(e) => onSubtitlePath(e.target.value)}
              />
              <button
                type="button"
                disabled={container !== "" || audioOnly !== "" || coverAt !== ""}
                onClick={async () => {
                  const p = await pickSubtitleFile();
                  if (p) {
                    onSubtitlePath(p);
                    onContainer("");
                    onAudioOnly("");
                    onCoverAt("");
                  }
                }}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
              >
                {t("common.choose")}
              </button>
            </div>
          </label>
          <label
            className={
              coverAt !== "" ? "mb-2 block" : "pointer-events-none mb-2 block opacity-40"
            }
          >
            <span className={labelCls}>{t("batch.coverAt")}</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={coverAt}
              disabled={coverAt === ""}
              className={inputCls}
              onChange={(e) => onCoverAt(e.target.value)}
            />
          </label>
          <p className="text-xs leading-5 text-slate-500">
            {t("batch.videoHint")}
          </p>
        </div>
        )}
      </div>

      {/* ===== v0.5.0 PDF 瘦身（PDF 任务） ===== */}
      <div className="mb-3 rounded-xl border border-slate-200 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={pdfSlimMode}
            onChange={(e) => onPdfSlimMode(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          {t("batch.pdfSlim")}
        </label>
        <div
          className={
            pdfSlimMode
              ? "mt-2 flex items-center gap-3"
              : "pointer-events-none mt-2 flex items-center gap-3 opacity-40"
          }
        >
          <span className="text-xs font-medium text-slate-500">{t("batch.pdfSlimQuality")}</span>
          <input
            type="range"
            min={1}
            max={10}
            value={pdfSlimQuality}
            disabled={!pdfSlimMode}
            className="w-40 accent-blue-600"
            onChange={(e) => onPdfSlimQuality(Number(e.target.value))}
          />
          <span className="text-xs text-slate-600">
            {t("batch.pdfSlimLabel", {
              c: 11 - pdfSlimQuality,
              s: pdfSlimQuality,
            })}
          </span>
        </div>
      </div>

      {/* ===== 全局 ===== */}
      <div className="border-t border-slate-200 px-4 py-2.5">
        <label className="mb-2 block">
          <span className={labelCls}>{t("batch.renameTemplate")}</span>
          <input
            placeholder={t("batch.renamePlaceholder")}
            value={batchRename}
            className={inputCls}
            onChange={(e) => onBatchRename(e.target.value)}
          />
        </label>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={replaceSource}
              onChange={(e) => onReplaceSource(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            {t("batch.replaceSource")}
            <span className="text-xs font-normal text-slate-500">
              {t("batch.replaceHint")}
            </span>
          </label>
        </div>
      </div>
    </section>
  );
}
