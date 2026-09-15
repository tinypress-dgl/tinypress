#!/usr/bin/env python3
"""TinyPress 前端全流程验证 v3（手写 internals mock + add_init_script）

验证：
1. 字段修复：状态栏「FFmpeg 5.1.4 · 图片引擎 4/4 就绪」（ffmpegOk 读取）
2. 预设渲染（listPresets）
3. 拖放入队（plugin:event|listen + tauri://drag-drop）
4. 队列项 → 对比面板
5. 开始压缩 → compress_files → compress_progress → compress_done 状态流转
6. 设置保存：save_settings 收到 camelCase
7. 检查更新 → check_update
"""
import sys
from playwright.sync_api import sync_playwright

INTERNALS = """
(() => {
  const callbacks = new Map();
  let nextId = 0;
  const listeners = {};
  const log = { invoke: [], saveArgs: [] };
  window.__mockLog = log;

  const fire = (event, payload) => {
    (listeners[event] || []).forEach((cbId) => {
      const cb = callbacks.get(cbId);
      if (cb) cb({ event, id: cbId, payload });
    });
  };

  const invoke = async (cmd, args) => {
    log.invoke.push(cmd);
    if (cmd === 'plugin:event|listen') {
      (listeners[args.event] = listeners[args.event] || []).push(args.handler);
      return args.handler;
    }
    if (cmd === 'plugin:event|unlisten') return undefined;
    if (cmd === 'save_settings') log.saveArgs.push(JSON.stringify(args.settings));
    switch (cmd) {
      case 'get_engine_info':
        return { ffmpegOk: true, ffmpegVersion: 'ffmpeg version 5.1.4', engines: { mozjpeg: true, pngquant: true, libwebp: true, libavif: true }, hardware: { nvenc: false, qsv: false, videotoolbox: false } };
      case 'list_presets':
        return [
          { id: 'bili1080', name: 'B站 1080P（免二压）', platform: 'B站', kind: 'video', tags: ['bili'], constraints: { maxBitrateKbps: 3000 }, video: { codec: 'libx264', crf: 23.5, preset: 'medium' }, filters: {}, note: 'test' },
          { id: 'pdd_main', name: '拼多多主图', platform: '拼多多', kind: 'image', tags: ['pdd'], constraints: { maxSizeKb: 100 }, image: { format: 'jpeg', engine: 'mozjpeg', quality: 80, maxSizeKb: 100, stripMetadata: true }, filters: {}, note: 'test' }
        ];
      case 'get_settings':
        return { outputDir: '/tmp/tp_out', renameTemplate: '{name}-{kind}', watchDir: '', watchPreset: '' };
      case 'get_app_version': return '0.1.0';
      case 'check_update': return { current: '0.1.0', updateUrl: undefined };
      case 'get_watch_status': return { running: false };
      case 'compress_files': {
        const items = (args && args.request && args.request.items) || [];
        return items.map((it, i) => ({ id: 'job_' + (i + 1), inputPath: it.inputPath, presetId: it.presetId, status: 'running', progress: 5, inputSize: 1048576, outputSize: undefined, outputPath: undefined, error: undefined }));
      }
      case 'start_watch': return undefined;
      case 'stop_watch': return undefined;
      default: return undefined;
    }
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (e, id) => callbacks.delete(id) };
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: (cb) => { const id = ++nextId; callbacks.set(id, cb); return id; },
    unregisterCallback: (id) => callbacks.delete(id),
  unregisterListener: (event, id) => callbacks.delete(id),
    runCallback: (id, data) => { const cb = callbacks.get(id); if (cb) cb(data); },
    convertFileSrc: (p) => 'asset://localhost/' + encodeURIComponent(p),
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    event: { listen: async (e, h) => { (listeners[e] = listeners[e] || []).push(h); return () => {}; } }
  };

  window.__triggerDrop = (paths) => fire('tauri://drag-drop', { type: 'drop', paths, position: { x: 10, y: 10 } });
  window.__triggerProgress = (jobId, progress) => fire('compress_progress', { jobId, progress });
  window.__triggerDone = (job) => fire('compress_done', job);
  window.__getMockLog = () => log;
})();
"""

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path="/opt/vm/preinstall/ms-playwright/chromium-1169/chrome-linux/chrome")
        page = b.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(INTERNALS)
        page.goto("http://localhost:1420/", wait_until="networkidle")
        page.wait_for_timeout(2500)

        results = []
        def check(name, cond, detail=""):
            results.append((name, bool(cond), detail))

        body = page.locator("body").inner_text()

        # 1. 引擎状态（核心：字段修复验证）
        status = [l for l in body.split("\n") if "FFmpeg" in l or "引擎" in l]
        check("状态栏 FFmpeg 就绪", "FFmpeg" in body and "5.1.4" in body and "图片引擎 4/4 就绪" in body, status[:2])

        # 2. 预设渲染
        check("预设列表渲染", "B站 1080P" in body and "拼多多主图" in body)

        # 3. 版本
        check("版本 v0.1.0", "v0.1.0" in body)

        # 4. 拖放入队
        page.evaluate("window.__triggerDrop(['/tmp/test.mp4','/tmp/pic.jpg'])")
        page.wait_for_timeout(1000)
        body2 = page.locator("body").inner_text()
        check("拖入后队列 2 项", "test.mp4" in body2 and "pic.jpg" in body2)

        # 5. 点击队列项 → 对比面板
        page.locator("text=test.mp4").first.click()
        page.wait_for_timeout(600)
        body3 = page.locator("body").inner_text()
        check("点击队列项出现对比面板", ("压缩前" in body3) or ("原始" in body3) or ("对比" in body3))

        # 6. 开始压缩 → 进度事件 → 完成事件
        start_btn = page.locator("text=开始压缩")
        check("存在开始压缩按钮", start_btn.count() > 0)
        if start_btn.count() > 0:
            start_btn.first.click()
            page.wait_for_timeout(1000)
            invokes = page.evaluate("window.__getMockLog().invoke")
            check("调用 compress_files", "compress_files" in invokes)
            # 触发进度与完成
            page.evaluate("window.__triggerProgress('job_1', 60)")
            page.wait_for_timeout(300)
            page.evaluate("window.__triggerDone({ id: 'job_1', inputPath: '/tmp/test.mp4', presetId: 'bili1080', status: 'done', progress: 100, inputSize: 1048576, outputSize: 524288, outputPath: '/tmp/tp_out/test_bili.mp4', error: undefined })")
            page.wait_for_timeout(800)
            body4 = page.locator("body").inner_text()
            check("任务状态流转为完成", "100%" in body4 or "完成" in body4 or "test_bili" in body4)

        # 7. 设置保存 camelCase
        try:
            page.locator("text=输出与自动压缩设置").first.click()
            page.wait_for_timeout(600)
            labels = page.locator("label")
            filled = False
            for i in range(labels.count()):
                t = labels.nth(i).inner_text()
                if "命名模板" in t:
                    inp = labels.nth(i).locator("input")
                    if inp.count():
                        inp.fill("{name}-v{kind}")
                        filled = True
                        break
            check("找到命名模板输入框", filled)
            page.wait_for_timeout(1500)
            save_args = page.evaluate("window.__getMockLog().saveArgs")
            check("save_settings 收到 camelCase",
                  len(save_args) > 0 and "outputDir" in save_args[-1] and "renameTemplate" in save_args[-1],
                  save_args[-1] if save_args else "无 save_settings")
        except Exception as e:
            check("设置保存验证", False, f"异常: {e}")

        # 8. 检查更新
        upd = page.locator("text=检查更新")
        if upd.count() > 0:
            upd.first.click()
            page.wait_for_timeout(500)
            invokes = page.evaluate("window.__getMockLog().invoke")
            check("检查更新调用 check_update", "check_update" in invokes)

        check("无页面 JS 错误", len(errors) == 0, str(errors[:3]) if errors else "")

        page.screenshot(path="/tmp/tp_ui_test.png", full_page=False)
        print("=" * 46)
        ok = sum(1 for _, c, _ in results if c)
        for name, c, detail in results:
            print(f"[{'✓' if c else '✗'}] {name}" + (f"  ← {detail}" if not c else ""))
        print(f"\n结论: {ok}/{len(results)} 通过")
        b.close()
        sys.exit(0 if ok == len(results) else 1)

if __name__ == "__main__":
    main()
