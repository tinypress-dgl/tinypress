#!/usr/bin/env node
/**
 * TinyPress 本机验证前置环境自检（跨平台）
 *
 * 用法：
 *   node scripts/verify-env.mjs          # 全量自检并输出报告
 *   node scripts/verify-env.mjs --json   # 输出 JSON（方便贴回/解析）
 *
 * 检测项：Node/npm/Rust 工具链、前端依赖、Tauri 壳入口、
 *        引擎二进制（bins/ 或 PATH）、许可证目录。
 * 报告同时写入 verify-report.txt，可直接贴回对话。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BINS = path.join(ROOT, "src-tauri", "bins");
const JSON_MODE = process.argv.includes("--json");

const results = [];
const add = (name, ok, detail = "") =>
  results.push({ name, ok, detail });

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 15000 }).trim();
  } catch {
    return null;
  }
}

/** 优先 PATH，其次 ~/.cargo/bin（rustup 默认安装位置） */
function runTool(bin, args) {
  const direct = run(bin, args);
  if (direct) return direct;
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const alt = path.join(home, ".cargo", "bin", bin + (process.platform === "win32" ? ".exe" : ""));
  if (existsSync(alt)) return run(alt, args);
  return null;
}

// 1. Node / npm
const node = run(process.platform === "win32" ? "node.exe" : "node", ["--version"]);
add("Node.js (≥20)", !!node, node ?? "未安装");
const npm = run(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"]);
add("npm (≥10)", !!npm, npm ?? "未安装");

// 2. Rust 工具链
const cargo = runTool("cargo", ["--version"]);
add("cargo", !!cargo, cargo ?? "未安装（rustup：https://rustup.rs）");
const rustc = runTool("rustc", ["--version"]);
add("rustc", !!rustc, rustc ?? "未安装");

// 3. 前端依赖
add(
  "前端依赖 node_modules",
  existsSync(path.join(ROOT, "node_modules")),
  existsSync(path.join(ROOT, "node_modules"))
    ? "已安装（若之前 npm install 过旧版本可重跑）"
    : "运行 npm install"
);

// 4. Tauri 壳入口完整性
const mainRs = path.join(ROOT, "src-tauri", "src", "main.rs");
const libRs = path.join(ROOT, "src-tauri", "src", "lib.rs");
const tauriConf = path.join(ROOT, "src-tauri", "tauri.conf.json");
const cargoToml = path.join(ROOT, "src-tauri", "Cargo.toml");
add(
  "Tauri 工程入口完整",
  existsSync(mainRs) && existsSync(libRs) && existsSync(tauriConf) && existsSync(cargoToml),
  existsSync(mainRs) && existsSync(libRs) && existsSync(tauriConf) && existsSync(cargoToml)
    ? "main.rs / lib.rs / tauri.conf.json / Cargo.toml 齐备"
    : "缺少文件，请确认 tinypress/src-tauri 完整"
);

// 5. 引擎二进制（bins/ 目录）
const need = ["ffmpeg", "ffprobe", "cjpeg", "pngquant", "cwebp", "avifenc"];
const exeExt = process.platform === "win32" ? ".exe" : "";
const inBins = (name) => existsSync(path.join(BINS, name + exeExt));
const inPath = (name) => run(process.platform === "win32" ? "where" : "which", [name]) !== null;
const engineRows = need.map((n) => {
  const inB = inBins(n);
  const inP = inPath(n);
  return { n, inB, inP };
});
const engineOk = engineRows.every((r) => r.inB || r.inP);
add(
  "压缩引擎二进制",
  engineOk,
  engineRows
    .map((r) => `${r.n}${r.inB ? "(bins/✓)" : r.inP ? "(PATH✓)" : "(✗缺失)"}`)
    .join(" ")
);
if (!engineOk) {
  add("提示", true, "运行 node scripts/fetch-bins.mjs 下载；失败项手动放入 src-tauri/bins/（见 README 兼容矩阵）");
}

// 6. 许可证目录
const licOk = existsSync(path.join(ROOT, "licenses", "standard", "GPL-3.0.txt"));
add("licenses/ 许可证目录", licOk, licOk ? "完整" : "运行 node scripts/gen-licenses.mjs --fix");

// 7. 平台专检
if (process.platform === "win32") {
  const wv = run("reg", [
    "query",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "/v",
    "pv",
  ]);
  add("WebView2 Runtime", !!wv, wv ? "已安装" : "未检测到，请安装（Win11 通常已内置）");
} else if (process.platform === "linux") {
  // Linux 专检：Tauri 运行时库（webkit2gtk + gtk3 + soup3）
  const so = ["libwebkit2gtk-4.1.so.0", "libgtk-3.so.0", "libsoup-3.0.so.0"];
  const ldconfig = run("ldconfig", ["-p"]) || "";
  const missing = so.filter((n) => !ldconfig.includes(n));
  add(
    "Tauri 运行时库",
    missing.length === 0,
    missing.length === 0
      ? so.join(" / ") + " 就绪"
      : "缺失: " + missing.join(", ") + "（sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libsoup-3.0-0）"
  );
} else {
  add("WebView2 Runtime", true, "非 Windows/Linux 跳过");
}

// 8. 打包命令预检（不真正打包）
add(
  "打包命令可用",
  existsSync(path.join(ROOT, "node_modules", "@tauri-apps", "cli")),
  "npm run tauri build（首次较慢，产物在 src-tauri/target/release/bundle/）"
);

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

const report = [
  "=== TinyPress 本机验证环境自检 ===",
  `平台: ${process.platform} ${process.arch}`,
  "",
  ...results.map((r) => `[${r.ok ? "✓" : "✗"}] ${r.name}${r.detail ? " — " + r.detail : ""}`),
  "",
  `结论: ${passed} 项通过 / ${failed.length} 项未通过`,
  ...(failed.length
    ? ["未通过项请按上面对应提示处理；也可直接贴回本报告获取修复建议。"]
    : ["全部就绪，可执行: npm run tauri dev"]),
].join("\n");

writeFileSync(path.join(ROOT, "verify-report.txt"), report + "\n");
console.log(JSON_MODE ? JSON.stringify(results, null, 2) : report);
process.exit(failed.length ? 1 : 0);
