# TinyPress 速压

本地优先的**图片 + 视频压缩**桌面工具：选平台 → 拖入 → 出符合平台硬约束的文件。
不学参数、不上传、无账号，买断制产品（对标调研详见 `docs/`）。

## 目录结构

```
tinypress/
├── docs/
│   ├── MVP-PLAN.md        # MVP 产品方案（功能/技术/排期/定价）
│   ├── GO-TO-MARKET.md    # 验证与发布方案（演示视频脚本/投放/门槛）
│   └── LOCAL-VERIFY.md    # 本机验证指南（安装/启动/验证清单/排错）
├── src/                   # React + TypeScript 前端
│   ├── App.tsx            # 主界面：预设选择 + 拖入 + 队列
│   ├── api.ts             # Tauri invoke/事件封装
│   └── components/        # DropZone / PresetSelector / QueueList
└── src-tauri/             # Rust 后端
    ├── src/
    │   ├── commands.rs    # Tauri 命令入口
    │   ├── engine/
    │   │   ├── video.rs   # FFmpeg 视频压缩（含进度解析）
    │   │   ├── image.rs   # 图片压缩（mozjpeg/pngquant/webp/avif + 目标大小二分）
    │   │   └── queue.rs   # 任务队列
    │   └── presets/       # 预设库（JSON 热更新设计）
    └── tauri.conf.json
```

## 环境要求

- Node.js ≥ 18（前端）
- Rust 工具链（后端，`rustup` 安装：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`）
- Windows 构建：VS Build Tools（含 C++）；macOS：Xcode Command Line Tools

## 运行

```bash
npm install
node scripts/verify-env.mjs    # 一键环境自检（生成 verify-report.txt，有问题贴回即可）
node scripts/fetch-bins.mjs    # 下载压缩引擎二进制
npm run tauri dev              # 开发模式（详见 docs/LOCAL-VERIFY.md）
```

打包：

```bash
npm run tauri build      # 产出 Windows NSIS 安装包 / macOS DMG
```

## 外部二进制（bins/）

压缩引擎通过**子进程**调用外部二进制（不链接，规避 GPL 传染），开发/打包时放入可执行文件旁的 `bins/` 目录，可用脚本拉取：

```bash
node scripts/fetch-bins.mjs          # 自动下载全部引擎（按当前平台）
node scripts/fetch-bins.mjs --only ffmpeg
```

| 二进制 | 用途 | 来源建议 |
|---|---|---|
| ffmpeg | 视频压缩/转码（含 libx264/libx265/SVT-AV1） | BtbN builds（Windows）/ evermeet（macOS） |
| cjpeg | 图片质量优先压缩 | mozjpeg 官方构建（Linux: `apt install mozjpeg`） |
| pngquant | PNG 量化 | kornelski/pngquant Releases |
| cwebp | WebP 压缩 | libwebp 官方构建 |
| avifenc | AVIF 压缩 | Windows: link-u/avif-win-builds；macOS/Linux: `brew install libavif` / `apt install libavif-bin` |

> 若脚本下载 404：对应项目 Releases 页资产名可能更新，复制最新资产 URL 替换 `scripts/fetch-bins.mjs` 中的地址即可。
> 许可证：随包分发时需附带各二进制许可证文本与源码可得性说明（业界通行做法）。

## 预设库

`src-tauri/src/presets/presets.json` 是唯一事实来源，平台规则变更只改 JSON 不发版。
P0 预设：B站 1080P 免二压 / 抖音竖屏 / 视频号 / 朋友圈(≤25MB) / 拼多多主图(≤100KB) / 证件照(≤200KB)。
抖音、视频号的硬约束数字为占位，发布前需对照平台官方规则核实。

## 合规与许可证

**代码全部原创；开源组件可用但须守许可证。** 完整第三方组件清单、许可证与分发义务见 [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md)。
新增依赖/素材前必须先读该文件并登记。

## 骨架现状与 TODO

- [x] 项目骨架、预设库、压缩引擎（视频/图片）、任务队列、进度事件
- [x] bins/ 二进制下载脚本（`scripts/fetch-bins.mjs`，URL 失效时按 README 提示更新）
- [x] 对比预览视图（前后大小 + 压缩率 + 本地预览）
- [x] 输出目录自定义 / 命名模板（`{name}` `{kind}` `{ext}` 占位符，非法字符清洗防路径穿越）
- [x] 文件夹监控自动压缩（轮询式零依赖实现，启动后新增文件自动按预设压缩，带去重）
- [x] 预设自定义编辑器（新建/编辑/删除，存用户配置目录 custom-presets.json，按 id 覆盖内置）
- [x] 硬件加速参数适配（NVENC 用 -cq/p1-p7、QSV 用 -global_quality；引擎状态显示可用编码器；真实编码需本地 GPU 验证）
- [x] 限码率硬约束接入（预设 constraints.max_bitrate_kbps → -maxrate/-bufsize，B站免二压等平台规则真实生效）
- [x] 预设库扩充至 13 个平台预设（B站/抖音/视频号横竖屏/小红书视频+封面/淘宝主图+白底图/YouTube/TikTok/朋友圈/拼多多/证件照，约束均按 2026-09 公开规则核实并注明来源）
- [x] 设置持久化（输出目录/命名模板/监控配置记住，存 settings.json，防抖保存）
- [x] 基础视频编辑（队列项级：截取起止/旋转 90·180·270/自动去黑边(cropdetect 探测)/居中裁剪；拖入先入队，编辑后统一开始）
- [x] 应用图标（已由 `tauri icon` 生成全套：ico/icns/多尺寸 PNG，源图 `assets/app-icon-1024.png`；落地页 favicon 已内嵌）
- [x] `licenses/` 许可证目录（GPL-3.0/Apache-2.0/MIT/BSD-2/BSD-3/OFL-1.1 全文 + 组件映射说明；打包前重跑 `node scripts/gen-licenses.mjs` 校验）
- [x] CI 自动打包（`.github/workflows/build-release.yml`：打 `v*` 标签或手动触发 → Windows NSIS + macOS DMG 双平台构建 → 自动挂到 GitHub Release 草稿）
- [x] 落地页中英文双语（`landing/index.html` 中文版 ¥199/内测限50名；`landing/index-en.html` 英文版 $59 买断·海外市场，海外平台预设 YouTube/TikTok/IG/X/Discord/Email，表单端点 FORM_ENDPOINT 配置式）
- [x] 应用版本显示与更新检查骨架（header 显示 vX.Y.Z；`app_config_dir/update-config.json` 配置 `{ "update_url": "..." }` 后点击可跳转更新页）
- [x] 本机一键环境自检（`scripts/verify-env.mjs`，检测工具链/引擎/工程完整性，生成 verify-report.txt）
- [x] 引擎下载脚本修复（Node 18+ fetch 流兼容、pngquant 官方源、临时目录清理容错；Linux 图片引擎建议 `apt install libjpeg-turbo-progs libavif-bin`）
- [x] Tauri 壳在 Linux 全链路验证（cargo build debug/release 通过、xvfb 启动冒烟无崩溃、`npm run tauri build` 产出 deb 安装包 3.3MB 含桌面启动器与图标；修复 protocol-asset feature / list_presets 重复 / 闭包 move 三个存量问题，identifier 改为 com.tinypress.desktop 消除 macOS .app 冲突警告）
- [x] 6 引擎真实压缩全链路验证（x264 视频 10.8MB→4.05MB 码率贴近 3000k 预设；cjpeg/pngquant/cwebp/avifenc 产出有效文件）
- [x] 前后端字段命名对齐（真机运行发现状态栏恒「FFmpeg 未就绪」：Rust camelCase 序列化 vs 前端 snake_case 读取不一致；全前端字段系统性对齐 EngineInfo/AppSettings/QueueItem/ProgressEvent/CompressItem/EditOptions 后构建通过）
- [x] 前端全流程 UI 验证 11/11（scripts/ui-e2e-check.py：官方 Tauri mocks + Playwright，引擎状态/预设/拖放入队/对比面板/压缩流转/设置 camelCase 保存，无 JS 错误）
- [x] Release 真机运行验证（webkit2gtk-4.1 运行时恢复后截图确认：状态栏 `FFmpeg 4.4.2 · 图片引擎 3/4 就绪 · NVENC可用`、13 预设渲染正常；deb 安装包重打包 3.27MB 含全部修复）
- [ ] 代码签名（Windows SmartScreen / macOS notarize）
