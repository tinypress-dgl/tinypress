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
  createWriteStream,
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
    urls: {
      win32:
        "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
      darwin: "https://evermeet.cx/ffmpeg/getrelease/zip",
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
    urls: {
      win32:
        "https://github.com/mozilla/mozjpeg/releases/download/v4.1.1/mozjpeg-4.1.1-windows-x64.zip",
      darwin:
        "https://github.com/mozilla/mozjpeg/releases/download/v4.1.1/mozjpeg-4.1.1-release-mac64.zip",
    },
    altHint:
      "Linux 请用 `sudo apt install mozjpeg`（含 cjpeg），确保在 PATH 中",
    extract: "archive",
    pick: (files) =>
      files.find((f) => /(^|\/)cjpeg(\.exe)?$/.test(f)) ||
      files.find((f) => /cjpeg/.test(f)),
  },
  pngquant: {
    urls: {
      win32:
        "https://pngquant.org/pngquant-windows.zip",
      darwin:
        "https://github.com/kornelski/pngquant/releases/download/3.0.3/pngquant-3.0.3-macos-arm64.zip",
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
      darwin:
        "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.4.0-mac-12.3-arm64.tar.gz",
      linux:
        "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.4.0-linux-x86-64.tar.gz",
    },
    extract: "archive",
    pick: (files) =>
      files.find((f) => /(^|\/)cwebp(\.exe)?$/.test(f)) ||
      files.find((f) => /cwebp/.test(f)),
  },
  avifenc: {
    // Windows 直接下载官方构建；macOS/Linux 建议走系统包管理器
    urls: {
      win32:
        "https://github.com/link-u/avif-win-builds/releases/download/v1.0.1/avifenc.exe",
    },
    altHint:
      "avifenc 请用包管理器安装：macOS `brew install libavif` / Linux `sudo apt install libavif-bin`，并确保在 PATH 中",
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
      const archive = path.join(TMP_DIR, `${name}-${path.basename(url)}`);

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
