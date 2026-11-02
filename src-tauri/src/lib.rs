mod config;
mod sidecar;
mod window_mode;

use config::{Config, Mode, SharedConfig};
use serde_json::Value;
use sidecar::Sidecar;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, RunEvent, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

const WIDTH: f64 = 340.0;

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show_widget(app: &AppHandle) {
    let (Some(window), Some(config)) = (main_window(app), app.try_state::<SharedConfig>()) else { return };
    window_mode::show(&window, config.mode());
    let _ = app.emit("widget://shown", ());
}

/// When the tray flyout was last hidden because it lost focus (milliseconds since the Unix epoch).
static LAST_BLUR_HIDE: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn toggle_widget(app: &AppHandle) {
    let (Some(window), Some(config)) = (main_window(app), app.try_state::<SharedConfig>()) else { return };
    let mode = config.mode();
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    // Clicking the tray icon while the flyout is open first blurs (and hides) it; don't immediately re-open it.
    if mode == Mode::Tray && !visible && now_ms().saturating_sub(LAST_BLUR_HIDE.load(Ordering::Relaxed)) < 400 {
        return;
    }
    if mode == Mode::Tray && visible {
        let _ = window.hide();
    } else if mode != Mode::Tray && visible && focused {
        // Clicking the tray while the widget is in front: put it back where it lives.
        if mode == Mode::Desktop {
            window_mode::send_to_bottom(&window);
        }
    } else {
        show_widget(app);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Commands exposed to the UI
// ---------------------------------------------------------------------------------------------------------------

#[tauri::command]
async fn matter(state: tauri::State<'_, Arc<Sidecar>>, method: String, params: Value) -> Result<Value, String> {
    let timeout = if method == "commission" { Duration::from_secs(150) } else { Duration::from_secs(25) };
    state.call(&method, params, timeout).await
}

#[tauri::command]
fn get_config(config: tauri::State<'_, SharedConfig>) -> Value {
    config.get()
}

#[tauri::command]
fn save_config(config: tauri::State<'_, SharedConfig>, value: Value) {
    config.replace(value);
}

#[tauri::command]
fn set_mode(app: AppHandle, config: tauri::State<'_, SharedConfig>, mode: String) {
    config.set_mode(&mode);
    if let Some(window) = main_window(&app) {
        let mode = config.mode();
        window_mode::apply(&window, mode, true);
        if mode == Mode::Tray {
            // Show the flyout once so the user sees where it went.
            window_mode::show(&window, mode);
        } else if let Some((x, y)) = config.window_pos() {
            if window_mode::is_on_screen(&window, x, y) {
                let _ = window.set_position(PhysicalPosition::new(x, y));
            }
        }
    }
}

/// Resize the window to fit the UI content. In tray mode the bottom edge stays anchored above the taskbar.
#[tauri::command]
fn fit_height(app: AppHandle, config: tauri::State<'_, SharedConfig>, height: f64) {
    let Some(window) = main_window(&app) else { return };
    let height = height.clamp(120.0, 720.0).round();
    let _ = window.set_size(LogicalSize::new(WIDTH, height));
    if config.mode() == Mode::Tray {
        window_mode::anchor_to_tray(&window);
    }
}

#[tauri::command]
fn hide_widget(app: AppHandle, config: tauri::State<'_, SharedConfig>) {
    let Some(window) = main_window(&app) else { return };
    match config.mode() {
        Mode::Desktop => window_mode::send_to_bottom(&window),
        _ => {
            let _ = window.hide();
        }
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn engine_log_path(app: AppHandle) -> Option<String> {
    app.path().app_log_dir().ok().map(|d| d.join("matter-engine.log").display().to_string())
}

// ---------------------------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------------------------

pub fn run() {
    let launched_at_login = std::env::args().any(|a| a == "--autostart");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_widget(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(move |app| {
            let handle = app.handle().clone();
            let config = Config::load(&handle);
            app.manage(config.clone());

            // Start with Windows by default (the user can turn this off in Settings).
            if !config.flag("autostartInitialized") {
                let _ = handle.autolaunch().enable();
                config.set_flag("autostartInitialized");
            }

            let sidecar = Sidecar::new(handle.clone());
            if let Err(e) = sidecar.start() {
                eprintln!("{e}");
            }
            app.manage(sidecar);

            // Tray icon + menu.
            let show_i = MenuItem::with_id(app, "show", "Show widget", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Lightdeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &PredefinedMenuItem::separator(app)?, &quit_i])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Lightdeck")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_widget(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } =
                        event
                    {
                        toggle_widget(tray.app_handle());
                    }
                })
                .build(app)?;

            // Initial placement.
            if let Some(window) = main_window(&handle) {
                let mode = config.mode();
                let pos = config
                    .window_pos()
                    .filter(|(x, y)| window_mode::is_on_screen(&window, *x, *y))
                    .map(|(x, y)| PhysicalPosition::new(x, y))
                    .or_else(|| window_mode::default_position(&window));
                if let (Some(pos), true) = (pos, mode != Mode::Tray) {
                    let _ = window.set_position(pos);
                }
                // In tray mode, stay hidden at login; otherwise show the widget.
                window_mode::apply(&window, mode, !(mode == Mode::Tray));
                if mode == Mode::Tray && !launched_at_login {
                    window_mode::show(&window, mode);
                }
                // Once the UI has loaded, drop WebView2 to its low-memory level until the user interacts.
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(4));
                    if !w.is_focused().unwrap_or(false) {
                        window_mode::set_memory_low(&w, true);
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let Some(config) = app.try_state::<SharedConfig>() else { return };
            match event {
                WindowEvent::Moved(pos) => {
                    if config.mode() != Mode::Tray && window.is_visible().unwrap_or(false) {
                        config.set_window_pos(pos.x, pos.y);
                    }
                }
                WindowEvent::Focused(false) => {
                    if let Some(w) = main_window(app) {
                        window_mode::set_memory_low(&w, true);
                    }
                    match config.mode() {
                    Mode::Tray => {
                        if window.is_visible().unwrap_or(false) {
                            LAST_BLUR_HIDE.store(now_ms(), Ordering::Relaxed);
                        }
                        let _ = window.hide();
                    }
                    Mode::Desktop => {
                        if let Some(w) = main_window(app) {
                            window_mode::send_to_bottom(&w);
                        }
                    }
                    Mode::Top => {}
                    }
                }
                WindowEvent::Focused(true) => {
                    if let Some(w) = main_window(app) {
                        window_mode::set_memory_low(&w, false);
                    }
                    let _ = app.emit("widget://shown", ());
                }
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            matter,
            get_config,
            save_config,
            set_mode,
            fit_height,
            hide_widget,
            quit,
            engine_log_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lightdeck");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(config) = app.try_state::<SharedConfig>() {
                config.write_now();
            }
            if let Some(sidecar) = app.try_state::<Arc<Sidecar>>() {
                sidecar.shutdown();
            }
        }
    });
}
