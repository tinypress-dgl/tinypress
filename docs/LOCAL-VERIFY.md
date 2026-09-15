# TinyPress 本机验证指南

> 目标：在你自己的电脑上把 TinyPress 跑起来，验证沙箱里无法验证的三件事——
> **① Tauri 壳能否编译运行；② NVENC/QSV 真实编码；③ 二进制下载脚本可用性**。
> 全程约 30–60 分钟（首次 Rust 编译较慢）。遇错直接把终端报错贴回对话即可。

## 0. 一句话流程

```
安装工具链 → npm install → 下载引擎二进制 → npm run tauri dev → 按清单验证 → npm run tauri build 打安装包
```

## 1. 安装前置软件（只需一次）

### Windows（首选平台）

| 软件 | 下载/安装 | 用途 |
|---|---|---|
| Rust（MSVC 工具链） | https://rustup.rs 下载 rustup-init.exe，默认选项 | 编译 Rust 后端 |
| Visual Studio 2022 Build Tools | https://visualstudio.microsoft.com/downloads/ → 勾选「使用 C++ 的桌面开发」工作负载 | MSVC 链接器 + Windows SDK（Rust 编译必需） |
| Node.js 20+ LTS | https://nodejs.org | 前端构建（Tauri CLI） |
| WebView2 Runtime | Win11 已内置；Win10 若无则装 https://developer.microsoft.com/microsoft-edge/webview2/ | Tauri 窗口渲染 |

装完后打开**新的** PowerShell，验证：

```powershell
rustc --version    # 应输出 rustc 1.7x
cargo --version
node --version     # 应 ≥ 20
npm --version
```

### macOS

```bash
xcode-select --install          # 命令行工具
# Rust + Node（或各自官网安装器）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Node: 下载 https://nodejs.org LTS 安装包
```

## 2. 构建与启动

### 2.0 一键环境自检（推荐先跑）

```bash
cd tinypress
npm install          # 若尚未安装依赖
node scripts/verify-env.mjs
```

脚本自动检测：Node/npm、Rust 工具链、前端依赖、Tauri 工程入口、6 个压缩引擎二进制、许可证目录、WebView2（Windows），
并生成 `verify-report.txt`。**把该文件内容贴回对话即可获得修复建议。**

```bash
cd tinypress          # 项目根目录（本指南所在目录的上级）
npm install
```

**下载压缩引擎二进制**（ffmpeg / cjpeg / pngquant / cwebp / avifenc → `src-tauri/bins/`）：

```bash
node scripts/fetch-bins.mjs
# 也可按需：node scripts/fetch-bins.mjs --only ffmpeg
```

> 若某项下载失败，脚本会打印来源与提示，可改用系统包管理器安装（见 README 兼容矩阵），
> 只要命令在 PATH 中即可被应用检测到。

**启动开发模式**：

```bash
npm run tauri dev
```

首次运行：Rust 全量编译 5–15 分钟，之后弹出「TinyPress 速压」窗口即成功。

## 3. 应用内验证清单

按顺序过一遍，每项通过就在前面打勾：

- [ ] **引擎状态**：窗口顶部状态栏显示 `FFmpeg <版本> · 图片引擎 4/4 就绪`，并根据你的显卡显示 `NVENC 可用`（N卡）/ `QSV 可用`（Intel 核显）/ `VideoToolbox 可用`（Mac）
- [ ] **视频压缩**：拖入一个视频 → 选「B站免二压 1080p」→ 开始 → 完成后对比预览显示体积下降
- [ ] **图片压缩**：拖入一张 JPG → 选「拼多多主图 ≤100KB」→ 压缩成功且体积达标
- [ ] **自定义预设持久化**：预设管理器 → 新建一个视频预设（如 `h264_nvenc`）→ 保存 → **完全退出并重启应用** → 预设仍在列表里（= 已写入本地 `custom-presets.json`）
- [ ] **硬件编码（关键）**：自定义预设里选 `h264_nvenc`（N卡）或 `h264_qsv`（核显）→ 对视频压缩 → 成功、无报错
- [ ] **文件夹监控**：设置里选监控目录 → 启动 → 往目录丢一个新视频 → 自动压缩到输出目录，且不重复处理
- [ ] **命名模板**：输出设置里填 `{name}-{kind}` → 压缩后文件名符合模板、无非法字符

## 4. 打安装包（验证发布链路）

```bash
npm run tauri build
```

产物：Windows `src-tauri/target/release/bundle/nsis/*.exe`（安装器）/ macOS `dmg`。
双击安装即可。**当前未做代码签名，Windows 会提示 SmartScreen「未知发布者」——点「更多信息 → 仍要运行」即可，属预期。**

## 5. 排错速查

| 报错 | 原因 | 处理 |
|---|---|---|
| `link.exe` / `link not found` | 缺 MSVC 链接器 | 装 VS Build Tools（含 C++ 桌面开发工作负载）后重启终端 |
| `rustc` 命令找不到 | PATH 未生效 | Windows 重开终端；macOS `source "$HOME/.cargo/env"` |
| WebView2 相关报错 | Runtime 缺失 | 装 WebView2 Runtime |
| 状态栏「FFmpeg 未就绪」 | bins 没下载成功或不在 PATH | 重跑 `node scripts/fetch-bins.mjs`，失败项手动下载放入 `src-tauri/bins/` |
| 端口 1420 被占用 | 另一个 vite 实例在跑 | 关闭占用进程后重试 |
| 首次编译极慢 | Rust 全量编译 | 正常；后续增量编译秒级 |
| `pngquant` 下载失败 | GitHub latest 链接偶发 403 | 手动到 https://github.com/kornelski/pngquant/releases 下载对应平台包放入 bins/ |

## 6. 开发环境已验证项（Linux x64）

> **Linux 运行要求**：需要 webkit2gtk-4.1 ≥ 2.40（Ubuntu 24.04+ 自带 2.44/2.48 ✓；Ubuntu 22.04 自带 2.36 不满足，需 `apt install --upgrade libwebkit2gtk-4.1-0` 或升级系统）。Windows/macOS 无此限制。

以下内容已在当前开发环境真实跑通，**不需要你重复验证**：

- [x] `verify-env.mjs` 环境自检（11 项：工具链/工程入口/许可证/引擎 + Linux Tauri 运行时库检测）
- [x] **Tauri 壳编译**：`cargo build` 通过（修复 3 个存量问题：`protocol-asset` feature、`list_presets` 重复定义、闭包 move 借用）
- [x] **应用启动冒烟**：`xvfb-run` 启动 25 秒无崩溃（仅无头环境 AT-SPI 警告，无害）
- [x] **引擎下载脚本**：Node 18+ fetch 流兼容、pngquant 官方源、清理容错
- [x] **6 引擎真实压缩**：x264 视频 10.8MB→4.05MB（码率 3.24Mbps 贴近 3000k 预设）/ cjpeg / pngquant / cwebp / avifenc 全部产出有效文件
- [x] **中英文落地页**双视口自检通过
- [x] **前后端字段命名对齐（重要修复）**：真机运行发现状态栏恒「FFmpeg 未就绪」——根因是 Rust 侧 `#[serde(rename_all="camelCase")]` 输出 `ffmpegOk`，前端读 `ffmpeg_ok` 为 undefined。已全前端字段系统性对齐（EngineInfo/AppSettings/QueueItem/ProgressEvent/CompressItem/EditOptions），`npm run build` 通过。
- [x] **前端全流程 UI 验证（11/11）**：`scripts/ui-e2e-check.py` 用官方 Tauri mocks + Playwright 在浏览器验证——引擎状态/预设渲染/拖放入队/对比面板/压缩调用与进度流转/设置 camelCase 保存/检查更新，全部通过且无 JS 错误。
- [x] **Release 真实运行验证**：webkit2gtk-4.1 2.50.4 运行时恢复后，`target/release/tinypress` 真机运行截图确认：状态栏 `FFmpeg 4.4.2-0ubuntu0.22.04.1 · 图片引擎 3/4 就绪 · NVENC可用`（引擎 3/4 因沙箱缺 cjpeg；产品无碍）、全部 13 个预设渲染、队列/设置面板正常。
- [x] **引擎定位跨形态修复**：`find()` 增加 deb 安装态 `/usr/lib/TinyPress/bins` 与 macOS `Contents/Resources/bins` 候选路径（此前只查 exe 旁 bins + PATH，deb 安装后引擎会找不到）；重新编译 + deb 重打包验证 6 引擎内嵌。
- [x] **deb 安装包**：`src-tauri/target/release/bundle/deb/TinyPress_0.1.0_amd64.deb`（含全部修复，3.27MB）

## 7. 仍需你在本机验证的点（有 GPU 的 Windows/Mac）

开发环境无独显与真实桌面会话，以下只能靠你的电脑：

1. `npm run tauri dev` 弹出窗口、界面操作（拖入/预设/队列/编辑面板）
2. **NVENC / QSV 真实硬件编码**（`h264_nvenc` / `h264_qsv` 预设成功且速度快于 CPU）
3. `npm run tauri build` 产出 Windows NSIS 安装包 / macOS DMG
4. Windows 上 WebView2 Runtime 是否就绪
5. 界面视觉/交互反馈（截图贴回）
6. 推 `v0.1.0` 标签触发 CI（tauri-action 自动构建 Windows/macOS 安装包并生成 Release 草稿）

## 8. 排错速查
