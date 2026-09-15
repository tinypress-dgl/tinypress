# TinyPress 第三方许可证目录

> 本目录随安装包分发，满足各第三方组件的许可证义务。
> 由 `scripts/gen-licenses.mjs` 生成（打包前重跑：`node scripts/gen-licenses.mjs`）。
> 生成日期：2026-09-15

## 一、外部二进制（子进程调用，不链接，随包分发）

| 二进制 | 用途 | 许可证 | 许可证全文 | 源码/版权声明 |
|---|---|---|---|---|
| ffmpeg（GPL 构建，含 libx264/libx265/SVT-AV1） | 视频压缩 | GPLv3 | `standard/GPL-3.0.txt` | Copyright (c) 2000-2026 the FFmpeg developers。源码：https://ffmpeg.org/download.html（或本构建来源 https://www.gyan.dev/ffmpeg/builds/ 、BtbN https://github.com/BtbN/FFmpeg-Builds） |
| mozjpeg (cjpeg) | JPEG 感知压缩 | BSD-3-Clause | `standard/BSD-3-Clause.txt` | Copyright (c) 2014, Mozilla Corporation 与 libjpeg-turbo Project。源码：https://github.com/mozilla/mozjpeg |
| pngquant | PNG 压缩 | GPLv3（或商业授权） | `standard/GPL-3.0.txt` | Copyright (c) 1989, 1991 Free Software Foundation, Inc.；pngquant 作者 Kornel Lesiński。源码：https://github.com/kornelski/pngquant |
| libwebp (cwebp) | WebP 压缩 | BSD-3-Clause | `standard/BSD-3-Clause.txt` | Copyright (c) 2010, Google Inc.。源码：https://chromium.googlesource.com/webm/libwebp |
| libavif (avifenc) | AVIF 压缩 | BSD-2-Clause | `standard/BSD-2-Clause.txt` | Copyright (c) 2017, Alliance for Open Media 等。源码：https://github.com/AOMediaCodec/libavif |

> 特别说明（GPL 合规）：ffmpeg 与 pngquant 以**独立子进程**方式调用，TinyPress 本体不链接其代码，无 GPL 传染；随包附本目录全文并保留源码可得性链接，符合 GPLv3 第 5-6 条对二进制分发的义务。如用户希望规避 GPL，可改用 FFmpeg LGPL 构建或取得商业授权（发布时在官网说明）。

## 二、前端依赖（npm）

| 包 | 许可证 | 全文 |
|---|---|---|
| react / react-dom | MIT | `standard/MIT.txt`（版权：Meta Platforms, Inc. and affiliates） |
| @tauri-apps/api / cli | MIT + Apache-2.0 | `standard/MIT.txt` / `standard/Apache-2.0.txt`（版权：Tauri Programme within The Commons Conservancy） |
| vite | MIT | `standard/MIT.txt`（版权：Vite contributors） |
| typescript | Apache-2.0 | `standard/Apache-2.0.txt`（版权：Microsoft Corporation） |
| tailwindcss | MIT | `standard/MIT.txt`（版权：Tailwind Labs Inc.） |
| @vitejs/plugin-react / postcss / autoprefixer | MIT | `standard/MIT.txt`（版权：各项目 contributors） |

## 三、Rust 依赖（cargo）

| crate | 许可证 | 全文 |
|---|---|---|
| tauri / tauri-build | MIT + Apache-2.0 | `standard/MIT.txt` / `standard/Apache-2.0.txt` |
| serde / serde_json | MIT + Apache-2.0 | `standard/MIT.txt` / `standard/Apache-2.0.txt` |
| tokio | MIT | `standard/MIT.txt`（版权：Tokio Contributors） |

## 四、素材

| 素材 | 许可证 | 全文 |
|---|---|---|
| Noto Sans SC（落地页字体） | SIL OFL 1.1 | `standard/OFL-1.1.txt`（版权：Google Inc.） |
| 图标（内联 SVG） | 原创 | 无第三方义务 |

## 五、预设参数来源声明

`src-tauri/src/presets/presets.json` 中的编码参数（CRF/码率/keyint/level 等）属功能性技术参数，不受版权保护；其中 B 站免二压参数（crf 23.5 / preset slow / level 4.1 / keyint 590）来源于社区公开数据（小丸工具箱社区），已通过 `note` 字段在预设中保留来源标注。

## 六、合规红线（维护提醒）

1. 新增任何依赖 → 同步更新 `docs/COMPLIANCE.md` 与本目录
2. 禁止把 GPL 代码复制进 TinyPress 源码（保持子进程调用隔离）
3. 发布打包最后一步重跑 `node scripts/gen-licenses.mjs` 校验全部文件存在
