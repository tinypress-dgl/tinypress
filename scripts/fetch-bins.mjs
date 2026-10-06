#!/usr/bin/env node
/**
 * TinyPress 压缩引擎二进制下载脚本（Node 20+）
 *
 * 用法：
 *   node scripts/fetch-bins.mjs                # 自动检测平台下载全部引擎
 *   node scripts/fetch-bins.mjs --only ffmpeg  # 只下载指定引擎
 *
 * 输出：src-tauri/bins/（ffmpeg / cjpeg / pngquant / cwebp / avifenc）
 *
 * 版本说明：以下 URL 为各项目稳定发布入口；若 404 请到对应 Releases 页
 * 更新版本号，下载后人工核对文件可用性。
 */
import {
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINS_DIR = path.resolve(__dirname, "../src-tauri/bins");
const TMP_DIR = path.resolve(__dirname, "../.bins-tmp");
const PLATFORM = process.platform; // win32 | darwin | linux

const ENGINES = {
  ffmpeg: {
    // win32: gyan.dev release-essentials（稳定 URL，含 ffmpeg/ffprobe）
    // darwin: evermeet.cx 静态构建（x86_64，Intel + Apple Silicon(Rosetta) 通用）
    // linux: BtbN linux64-gpl
    urls: {
      win32: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
      darwin: "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip?arch=amd64", // basename 为 "zip"，需 archiveName
    archiveName: { darwin: "ffmpeg-evermeet.zip" },
      linux:
        "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz",
    },
    extract: "archive",
    pick: (files) =>
      files.find((f) => /(^|\/)ffmpeg(\.exe)?$/.test(f)) ||
      files.find((f) => /ffmpeg/.test(f)),
    extras: (files) =>
      [files.find((f) => /(^|\/)ffprobe(\.exe)?$/.test(f))].filter(Boolean),
  },
  cjpeg: {
    // Windows/macOS 暂无稳定预编译源：Windows 由 ffmpeg mjpeg 编码兜底，macOS 走 brew jpeg-turbo
    urls: {},
    altHint:
      "cjpeg 缺失时应用自动用 ffmpeg mjpeg 编码 JPEG；macOS 可 brew install jpeg-turbo；Linux 用 apt install libjpeg-turbo-progs",
    extract: "archive",
    pick: (files) =>
      files.find((f) => /(^|\/)cjpeg(\.exe)?$/.test(f)) ||
      files.find((f) => /cjpeg/.test(f)),
  },
  pngquant: {
    urls: {
      win32:
        "https://pngquant.org/pngquant-windows.zip",

      linux:
        "https://pngquant.org/pngquant-linux.tar.bz2",
    },
    extract: "archive",
    pick: (files) =>
      files.find((f) => /(^|\/)pngquant(\.exe)?$/.test(f)) ||
      files.find((f) => /pngquant/.test(f)),
  },
  cwebp: {
    urls: {
      win32:
        "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.4.0-windows-x64.zip",

      linux:
        "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.4.0-linux-x86-64.tar.gz",
    },
    extract: "archive",
    pick: (files) =>
      files.find((f) => /(^|\/)cwebp(\.exe)?$/.test(f)) ||
      files.find((f) => /cwebp/.test(f)),
  },
  avifenc: {
    // AVIF 编码：ffmpeg(libaom-av1) 兜底；macOS `brew install libavif` / Linux `apt install libavif-bin`
    urls: {},
    altHint:
      "avifenc 缺失时应用自动用 ffmpeg -c:v libaom-av1 编码 AVIF；macOS brew install libavif / Linux apt install libavif-bin",
    extract: "none",
    pick: (files) => files[0],
  },
};

const log = (msg) => console.log(`[fetch-bins] ${msg}`);

async function download(url, dest) {
  log(`下载 ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  const file = createWriteStream(dest);
  await new Promise((resolve, reject) => {
    // Node 18+ fetch body 是 Web Stream，需经 Readable.fromWeb 转 Node 流
    Readable.fromWeb(res.body).pipe(file);
    file.on("finish", resolve);
    file.on("error", reject);
  });
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} 退出码 ${r.status}`);
}

function runOut(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} 退出码 ${r.status}`);
  return r.stdout || "";
}

/**
 * 确保 tesseract + tessdata（eng/chi_sim）进入 bins/。
 * - win32：choco 静默安装 → 拷贝 tesseract.exe + 同目录 DLL + tessdata；chi_sim 由 tessdata_fast 兜底下载
 * - linux：apt 安装 tesseract-ocr(+chi-sim) → 拷贝 exe + 系统 tessdata
 * - darwin：由 macos-bundle-engines.sh 处理（brew tesseract-lang），此处仅兜底校验
 */
function ensureTesseract() {
  const tessdir = path.join(BINS_DIR, "tessdata");
  mkdirSync(tessdir, { recursive: true });
  const exe = path.join(BINS_DIR, binName("tesseract"));
  if (existsSync(exe)) {
    log("tesseract 已存在，跳过安装");
  } else if (PLATFORM === "win32") {
    log("安装 tesseract (choco) …");
    run("choco", ["install", "tesseract", "-y", "--no-progress"]);
    const candidates = [
      "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
      "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe",
    ];
    let srcExe = candidates.find((p) => existsSync(p));
    if (!srcExe) {
      const w = runOut("where", ["tesseract"]);
      srcExe = w.trim().split(/\r?\n/)[0] || null;
    }
    if (!srcExe) throw new Error("tesseract 安装后未找到可执行文件");
    copyFileSync(srcExe, exe);
    const instDir = path.dirname(srcExe);
    // tesseract 5 依赖同目录 DLL（libtesseract 等）→ 一并拷贝
    for (const e of readdirSync(instDir)) {
      if (e.endsWith(".dll") || e.endsWith(".traineddata")) {
        try {
          copyFileSync(path.join(instDir, e), path.join(BINS_DIR, e));
        } catch { /* 忽略单个失败 */ }
      }
    }
    if (existsSync(path.join(instDir, "tessdata"))) {
      cpSync(path.join(instDir, "tessdata"), tessdir, { recursive: true });
    }
  } else if (PLATFORM === "linux") {
    log("安装 tesseract (apt) …");
    run("sudo", ["apt-get", "update", "-qq"]);
    run("sudo", ["apt-get", "install", "-y", "-qq", "tesseract-ocr", "tesseract-ocr-chi-sim"]);
    copyFileSync("/usr/bin/tesseract", exe);
    // 系统 tessdata 目录版本不定：/usr/share/tesseract-ocr/{4,5}/tessdata
    const dirs = ["/usr/share/tesseract-ocr/5/tessdata", "/usr/share/tesseract-ocr/4/tessdata"];
    const src = dirs.find((d) => existsSync(d));
    if (src) cpSync(src, tessdir, { recursive: true });
  } else {
    // darwin：bundle 脚本已拷贝；这里仅校验（CI macOS 步骤顺序在 fetch 之后）
    log("darwin 平台 tesseract 由 Bundle engine binaries (macOS) 步骤处理");
  }
  // 兜底：保证 eng / chi_sim traineddata（tessdata_fast 精简版 ~4MB/份）
  for (const lang of ["eng", "chi_sim"]) {
    const target = path.join(tessdir, `${lang}.traineddata`);
    if (!existsSync(target)) {
      log(`下载 tessdata_fast/${lang}.traineddata …`);
      const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${lang}.traineddata`;
      const r = spawnSync("curl", ["-L", "-sS", "-o", target, url], { stdio: "inherit" });
      if (r.status !== 0) throw new Error(`下载 ${lang}.traineddata 失败`);
    }
  }
  if (!existsSync(exe)) throw new Error("tesseract 缺失（OCR 功能不可用）");
  log(`tesseract 就绪: ${exe}`);
}

function extract(archive, outDir) {
  mkdirSync(outDir, { recursive: true });
  const isWin = process.platform === "win32";
  if (archive.endsWith(".zip")) {
    // Windows 无 unzip，使用系统自带 tar（Win10 1803+ 内置，支持 zip）
    if (isWin) {
      run("tar", ["-xf", archive, "-C", outDir]);
    } else {
      run("unzip", ["-o", "-q", archive, "-d", outDir]);
    }
  } else if (
    archive.endsWith(".tar.xz") ||
    archive.endsWith(".tar.gz") ||
    archive.endsWith(".tar.bz2")
  ) {
    run("tar", ["-xf", archive, "-C", outDir]);
  } else {
    throw new Error(`未知压缩格式: ${archive}`);
  }
}

function listFiles(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listFiles(path.join(dir, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

const binName = (name) => (PLATFORM === "win32" ? `${name}.exe` : name);

async function main() {
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;
  const targets = only ? [only] : Object.keys(ENGINES);
  log(`平台: ${PLATFORM} · 目标: ${targets.join(", ")}`);
  mkdirSync(BINS_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  ensureTesseract();
  log("压缩引擎 + tesseract 全部就绪");

  let ok = 0;
  let fail = 0;
  for (const name of targets) {
    const def = ENGINES[name];
    if (!def) {
      log(`跳过未知引擎: ${name}`);
      continue;
    }
    try {
      const url = def.urls[PLATFORM];
      if (!url) {
        log(`跳过 ${name}：该平台无预编译包`);
        if (def.altHint) log(`  ${def.altHint}`);
        continue;
      }
      // URL 带 query（如 evermeet ?arch=amd64）时 path.basename 会含 query，导致扩展名判断失败 → 剥离 query
      const urlBase = url.split(/[?#]/)[0];
      const archiveName = def.archiveName ? def.archiveName[PLATFORM] : `${name}-${path.basename(urlBase)}`;
      const archive = path.join(TMP_DIR, archiveName);

      if (def.extract === "none") {
        await download(url, path.join(BINS_DIR, binName(name)));
      } else {
        await download(url, archive);
        const exDir = path.join(TMP_DIR, name);
        rmSync(exDir, { recursive: true, force: true });
        extract(archive, exDir);
        const files = listFiles(exDir);
        const pick = def.pick(files);
        if (!pick) throw new Error(`解压后未找到 ${name} 可执行文件`);
        copyFileSync(
          path.join(exDir, pick),
          path.join(BINS_DIR, binName(name))
        );
        for (const extra of def.extras ? def.extras(files) : []) {
          copyFileSync(
            path.join(exDir, extra),
            path.join(BINS_DIR, binName(extra.split("/").pop()))
          );
        }
      }
      log(`✓ ${name} -> ${BINS_DIR}`);
      ok++;
    } catch (e) {
      log(`✗ ${name}: ${e.message}`);
      fail++;
    }
  }

  // 清理临时目录（重试避免 ENOTEMPTY 偶发失败）
  try {
    rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
  } catch (e) {
    log(`提示：临时目录清理失败（不影响已下载产物）：${e.message}`);
  }
  log(`完成：成功 ${ok}，失败 ${fail}`);
  if (fail > 0) {
    log("提示：失败项请手动下载放入 src-tauri/bins/（来源见 README）");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[fetch-bins] 致命错误:", e.message);
  process.exit(1);
});
