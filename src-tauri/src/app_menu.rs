// 应用菜单：跟随系统语言（macOS 系统菜单栏 / Windows / Linux 窗口菜单）
// 中文系统 → 中文菜单；英文系统 → 英文菜单
use tauri::Emitter;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

/// 用系统默认浏览器打开 URL（无 opener 插件依赖）
fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    let cmd = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let cmd = std::process::Command::new("cmd").args(["/c", "start", url]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = std::process::Command::new("xdg-open").arg(url).spawn();
    let _ = cmd;
}

/// 检测系统语言是否中文（macOS 用 AppleLanguages，其余平台用 LANG）
#[cfg(target_os = "macos")]
fn system_is_chinese() -> bool {
    let out = std::process::Command::new("/usr/bin/defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output();
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_lowercase().contains("zh"),
        Err(_) => false,
    }
}

#[cfg(not(target_os = "macos"))]
fn system_is_chinese() -> bool {
    std::env::var("LANG")
        .map(|l| l.to_lowercase().contains("zh"))
        .unwrap_or(false)
}

pub fn setup_menu(app: &tauri::App) -> tauri::Result<()> {
    let zh = system_is_chinese();
    let app_menu = build_app_menu(app, zh)?;
    app.set_menu(app_menu)?;
    // 监听菜单"打开文件"事件 → 转发前端执行原生文件对话框
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "open_files" {
            let _ = app.emit("menu-open-files", ());
        } else if event.id().as_ref() == "help_github" {
            open_url("https://github.com/tinypress-dgl/tinypress");
        }
    });
    Ok(())
}

fn build_app_menu(app: &tauri::App, zh: bool) -> tauri::Result<Menu<tauri::Wry>> {
    // macOS 首个子菜单为应用菜单（标题为应用名）
    let about_text = if zh { "关于 TinyPress 速压" } else { "About TinyPress" };
    let app_sub = Submenu::with_items(
        app,
        "TinyPress",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(about_text), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, if zh { Some("服务") } else { Some("Services") })?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, if zh { Some("隐藏") } else { Some("Hide") })?,
            &PredefinedMenuItem::hide_others(app, if zh { Some("隐藏其他") } else { Some("Hide Others") })?,
            &PredefinedMenuItem::show_all(app, if zh { Some("显示全部") } else { Some("Show All") })?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, if zh { Some("退出") } else { Some("Quit") })?,
        ],
    )?;

    // 文件：打开文件（Cmd/Ctrl+O，与前端快捷键一致）
    let file_sub = Submenu::with_items(
        app,
        if zh { "文件" } else { "File" },
        true,
        &[
            &MenuItem::with_id(
                app,
                "open_files",
                if zh { "打开文件…" } else { "Open Files…" },
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, if zh { Some("关闭窗口") } else { Some("Close Window") })?,
        ],
    )?;

    // 编辑：标准编辑项
    let edit_sub = Submenu::with_items(
        app,
        if zh { "编辑" } else { "Edit" },
        true,
        &[
            &PredefinedMenuItem::undo(app, if zh { Some("撤销") } else { Some("Undo") })?,
            &PredefinedMenuItem::redo(app, if zh { Some("重做") } else { Some("Redo") })?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, if zh { Some("剪切") } else { Some("Cut") })?,
            &PredefinedMenuItem::copy(app, if zh { Some("拷贝") } else { Some("Copy") })?,
            &PredefinedMenuItem::paste(app, if zh { Some("粘贴") } else { Some("Paste") })?,
            &PredefinedMenuItem::select_all(app, if zh { Some("全选") } else { Some("Select All") })?,
        ],
    )?;

    // 显示
    let view_sub = Submenu::with_items(
        app,
        if zh { "显示" } else { "View" },
        true,
        &[
            &PredefinedMenuItem::fullscreen(app, if zh { Some("切换全屏") } else { Some("Toggle Full Screen") })?,
        ],
    )?;

    // 窗口
    let window_sub = Submenu::with_items(
        app,
        if zh { "窗口" } else { "Window" },
        true,
        &[
            &PredefinedMenuItem::minimize(app, if zh { Some("最小化") } else { Some("Minimize") })?,
            &PredefinedMenuItem::maximize(app, if zh { Some("缩放") } else { Some("Zoom") })?,
        ],
    )?;

    // 帮助：GitHub 主页
    let help_item = MenuItem::with_id(
        app,
        "help_github",
        if zh { "GitHub 主页" } else { "GitHub Homepage" },
        true,
        None::<&str>,
    )?;
    let help_sub = Submenu::with_items(app, if zh { "帮助" } else { "Help" }, true, &[&help_item])?;

    Menu::with_items(
        app,
        &[&app_sub, &file_sub, &edit_sub, &view_sub, &window_sub, &help_sub],
    )
}
