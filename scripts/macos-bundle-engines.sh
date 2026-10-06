#!/usr/bin/env bash
# macOS 引擎打包：把 brew 二进制 + 依赖 dylib 打进 src-tauri/bins/，ffmpeg/ffprobe 用 evermeet 静态版。
# 目标：Intel Mac (x86_64) 原生 + Apple Silicon (Rosetta) 通用。
set -euo pipefail

BINS="$(pwd)/src-tauri/bins"
mkdir -p "$BINS" "$BINS/lib"

# ---- 1) evermeet 静态 ffmpeg/ffprobe（x86_64，无 dylib 依赖） ----
curl -fsSL -o /tmp/ffmpeg.zip "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip?arch=amd64"
curl -fsSL -o /tmp/ffprobe.zip "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip?arch=amd64"
unzip -o /tmp/ffmpeg.zip -d "$BINS/"
unzip -o /tmp/ffprobe.zip -d "$BINS/"
chmod +x "$BINS/ffmpeg" "$BINS/ffprobe"

# ---- 2) brew 引擎：复制二进制 + 递归收集依赖 dylib 到 bins/lib，改 @loader_path ----
copy_with_libs() {
  local bin="$1"
  [ -x "$bin" ] || return 0
  local name; name="$(basename "$bin")"
  cp "$bin" "$BINS/$name"
  chmod +x "$BINS/$name"
  # 递归收集依赖（排除系统库与自身 brew 容器路径）
  local pending=("$bin")
  local seen=""
  for _ in $(seq 1 60); do
    local next=()
    for f in "${pending[@]:-}"; do
      [ -z "$f" ] && continue
      if echo "$seen" | grep -qF "$f"; then continue; fi
      seen="$seen $f"
      local deps; deps="$(otool -L "$f" 2>/dev/null | tail -n +2 | awk '{print $1}')"
      for d in $deps; do
        case "$d" in
          /usr/lib/*|/System/*|/usr/local/lib/libSystem*) continue ;;
          @loader_path/*|@rpath/*) continue ;;
          *) ;;
        esac
        if [ -f "$d" ]; then
          local dname; dname="$(basename "$d")"
          cp -f "$d" "$BINS/lib/$dname" 2>/dev/null || true
          next+=("$d")
        fi
      done
    done
    [ ${#next[@]} -eq 0 ] && break
    pending=("${next[@]}")
  done
  # 重写依赖路径为 @loader_path/lib/
  local names
  names="$(ls "$BINS/lib" 2>/dev/null || true)"
  for dylib in $names; do
    install_name_tool -id "@loader_path/lib/$dylib" "$BINS/lib/$dylib" 2>/dev/null || true
    for b in "$BINS"/*; do
      [ -f "$b" ] && install_name_tool -change "@rpath/$dylib" "@loader_path/lib/$dylib" "$b" 2>/dev/null || true
      [ -f "$b" ] && install_name_tool -change "/opt/homebrew/opt/$(echo "$dylib" | sed 's/\..*//')/lib/$dylib" "@loader_path/lib/$dylib" "$b" 2>/dev/null || true
      [ -f "$b" ] && install_name_tool -change "/usr/local/opt/$(echo "$dylib" | sed 's/\..*//')/lib/$dylib" "@loader_path/lib/$dylib" "$b" 2>/dev/null || true
    done
  done
  # 二进制自身引用的 dylib 统一改为 @loader_path/lib/
  for d in "$(otool -L "$BINS/$name" 2>/dev/null | tail -n +2 | awk '{print $1}')"; do
    case "$d" in
      /usr/lib/*|/System/*) continue ;;
      *) dname="$(basename "$d")"
         if [ -f "$BINS/lib/$dname" ]; then
           install_name_tool -change "$d" "@loader_path/lib/$dname" "$BINS/$name" 2>/dev/null || true
         fi ;;
    esac
  done
}

copy_with_libs "$(which cjpeg 2>/dev/null || echo /opt/homebrew/opt/jpeg-turbo/bin/cjpeg)"
copy_with_libs "$(which pngquant 2>/dev/null || true)"
copy_with_libs "$(which cwebp 2>/dev/null || true)"
copy_with_libs "$(which avifenc 2>/dev/null || true)"
copy_with_libs "$(which tesseract 2>/dev/null || true)"

# ---- 3) tessdata（eng + chi_sim） ----
BP="$(brew --prefix)"
mkdir -p "$BINS/tessdata"
cp "$BP/share/tessdata/eng.traineddata" "$BINS/tessdata/" 2>/dev/null || true
cp "$BP/share/tessdata/chi_sim.traineddata" "$BINS/tessdata/" 2>/dev/null || true

echo "=== bins 内容 ==="
ls -la "$BINS"
echo "=== ffmpeg 验证 ==="
"$BINS/ffmpeg" -version 2>&1 | head -1 || true
echo "=== dylib 依赖检查（应为 @loader_path 或系统库） ==="
for b in "$BINS"/cjpeg "$BINS"/pngquant "$BINS"/cwebp "$BINS"/avifenc "$BINS"/tesseract; do
  [ -f "$b" ] || continue
  echo "--- $(basename "$b")"
  otool -L "$b" 2>/dev/null | tail -n +2 | awk '{print $1}'
done
