#!/usr/bin/env bash
# TinyPress macOS universal dmg 一键本地打包（在 Mac 上运行）
# 用法：bash scripts/build-macos-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [1/5] 前端依赖"
npm ci

echo "==> [2/5] Rust universal 目标"
rustup target add aarch64-apple-darwin x86_64-apple-darwin

echo "==> [3/5] 引擎（Homebrew）"
brew install ffmpeg pngquant webp jpeg-turbo libavif tesseract tesseract-lang

echo "==> [4/5] 打包引擎进 bins（含 dylib）"
bash scripts/macos-bundle-engines.sh

echo "==> [5/5] Tauri universal 构建（含 dmg）"
npx tauri build --target universal-apple-darwin

DMG="$(ls -t src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg 2>/dev/null | head -1)"
echo ""
echo "构建完成：$DMG"
echo "（安装包已含全部压缩引擎，可直接分发/上传 GitHub Release）"
