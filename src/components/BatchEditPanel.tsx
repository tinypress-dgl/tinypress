import { useState } from "react";
import type { ImageEditOptions } from "../types";
import { pickWatermarkImage } from "../api";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";
const labelCls = "block text-xs font-medium text-slate-500 mb-1";
const secCls = "mb-3 rounded-xl border border-slate-200 p-3";

/**
 * v0.3.0 全局批处理面板：
 *  - 图片批量编辑（尺寸/旋转/裁剪/文字水印/图片水印/输出格式），应用到队列中全部图片任务
 *  - 视频容器转换 / 音轨提取，应用到队列中全部视频任务
 * 与 WPS「图片批量工具箱 + 视频工具箱」对齐，纯本地处理不上传。
 */
export default function BatchEditPanel({
  imageEdit,
  onImageEdit,
  container,
  onContainer,
  audioOnly,
  onAudioOnly,
}: {
  imageEdit: ImageEditOptions | null;
  onImageEdit: (v: ImageEditOptions | null) => void;
  container: string;
  onContainer: (v: string) => void;
  audioOnly: string;
  onAudioOnly: (v: string) => void;
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
            批量处理工具箱
          </h3>
          <p className="text-xs text-slate-500">
            对队列中的全部任务统一生效 · 本地处理不上传
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
          {enabled ? "关闭批处理" : "启用批处理"}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
        {/* ===== 图片批量编辑 ===== */}
        <div className={secCls}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            图片批量编辑
          </h4>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {num("缩放 %", "scalePercent", "如 50=缩半", 1, 1, 1000)}
            {num("宽度 px", "width", "如 1920", 1, 1)}
            {num("高度 px", "height", "如 1080", 1, 1)}
            {num("旋转 °", "rotate", "0/90/180…", 90)}
            {num("裁剪 %", "cropPercent", "居中裁剪", 1, 1, 100)}
          </div>

          <h5 className="mb-1.5 text-xs font-medium text-slate-500">水印</h5>
          <label className="mb-2 block">
            <span className={labelCls}>文字水印</span>
            <input
              placeholder="如 TinyPress / 公司名"
              value={ie.watermarkText ?? ""}
              disabled={!enabled}
              className={inputCls}
              onChange={(e) => set("watermarkText", e.target.value || undefined)}
            />
          </label>
          <label className="mb-2 block">
            <span className={labelCls}>水印图片</span>
            <div className="flex gap-2">
              <input
                placeholder="选择 PNG/水印图"
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
                选择
              </button>
            </div>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {num("字号/宽", "watermarkSize", "32", 1, 1)}
            <label className="block">
              <span className={labelCls}>透明度 {(
                (ie.watermarkOpacity ?? 0.6) * 100
              ).toFixed(0)}
                %
              </span>
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
              <span className={labelCls}>位置</span>
              <select
                value={ie.watermarkPosition ?? "br"}
                disabled={!enabled}
                className={inputCls}
                onChange={(e) => set("watermarkPosition", e.target.value)}
              >
                <option value="tl">左上</option>
                <option value="tc">顶部居中</option>
                <option value="tr">右上</option>
                <option value="ml">左中</option>
                <option value="mc">正中</option>
                <option value="mr">右中</option>
                <option value="bl">左下</option>
                <option value="bc">底部居中</option>
                <option value="br">右下</option>
              </select>
            </label>
          </div>
          <label className="mt-2 block">
            <span className={labelCls}>输出格式</span>
            <select
              value={ie.format ?? ""}
              disabled={!enabled}
              className={inputCls}
              onChange={(e) => set("format", e.target.value || undefined)}
            >
              <option value="">保持源格式</option>
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WebP</option>
              <option value="bmp">BMP</option>
              <option value="avif">AVIF</option>
            </select>
          </label>
        </div>

        {/* ===== 视频批量处理 ===== */}
        <div className={secCls}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            视频批量处理
          </h4>
          <label className="mb-2 block">
            <span className={labelCls}>容器转换</span>
            <select
              value={container}
              disabled={audioOnly !== ""}
              className={inputCls}
              onChange={(e) => onContainer(e.target.value)}
            >
              <option value="">不转换容器</option>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
              <option value="avi">AVI</option>
              <option value="webm">WebM</option>
              <option value="mov">MOV</option>
              <option value="flv">FLV</option>
              <option value="ts">TS</option>
            </select>
          </label>
          <label className="mb-2 block">
            <span className={labelCls}>音轨提取</span>
            <select
              value={audioOnly}
              disabled={container !== ""}
              className={inputCls}
              onChange={(e) => onAudioOnly(e.target.value)}
            >
              <option value="">不提取音轨</option>
              <option value="mp3">提取为 MP3</option>
              <option value="wav">提取为 WAV</option>
            </select>
          </label>
          <p className="text-xs leading-5 text-slate-500">
            容器转换优先不重编码（秒完成、零画质损失），不兼容时自动回退转码；音轨提取只保留声音、不处理画面。
          </p>
        </div>
      </div>
    </section>
  );
}
