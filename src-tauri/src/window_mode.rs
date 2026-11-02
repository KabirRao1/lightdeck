//! Placement of the widget window for the three display modes.

use crate::config::Mode;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

pub const MARGIN: i32 = 12;

pub fn apply(window: &WebviewWindow, mode: Mode, show: bool) {
    match mode {
        Mode::Desktop => {
            let _ = window.set_always_on_top(false);
            platform::pin_to_desktop(window, true);
            if show {
                // Don't steal focus (e.g. at login): appear quietly behind whatever the user is doing.
                platform::show_no_activate(window);
            }
            platform::send_to_bottom(window);
        }
        Mode::Top => {
            platform::pin_to_desktop(window, false);
            let _ = window.set_always_on_top(true);
            if show {
                let _ = window.show();
            }
        }
        Mode::Tray => {
            platform::pin_to_desktop(window, false);
            let _ = window.set_always_on_top(true);
            let _ = window.hide();
        }
    }
}

/// Show the window. In tray mode it is anchored to the bottom-right corner of the work area (above the taskbar).
pub fn show(window: &WebviewWindow, mode: Mode) {
    if mode == Mode::Tray {
        anchor_to_tray(window);
    }
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn anchor_to_tray(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let area = monitor.work_area();
    let Ok(size) = window.outer_size() else { return };
    let mut right = area.position.x + area.size.width as i32;
    let mut bottom = area.position.y + area.size.height as i32;
    // With an auto-hiding taskbar the work area is the whole screen; keep clear of where the taskbar pops up.
    if let Some((l, t, r, b)) = platform::taskbar_rect() {
        let (mw, mh) = (monitor.size().width as i32, monitor.size().height as i32);
        let horizontal = (r - l) >= (b - t);
        if horizontal && t > monitor.position().y + mh / 2 {
            bottom = bottom.min(t);
        } else if !horizontal && l > monitor.position().x + mw / 2 {
            right = right.min(l);
        }
    }
    let x = right - size.width as i32 - MARGIN;
    let y = bottom - size.height as i32 - MARGIN;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Default position for a fresh install: top-right corner of the primary work area.
pub fn default_position(window: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = window.primary_monitor().ok()??;
    let area = monitor.work_area();
    let size = window.outer_size().ok()?;
    Some(PhysicalPosition::new(
        area.position.x + area.size.width as i32 - size.width as i32 - MARGIN * 2,
        area.position.y + MARGIN * 2,
    ))
}

/// Is the given position (top-left) still on a connected monitor? (Monitors may have been unplugged.)
pub fn is_on_screen(window: &WebviewWindow, x: i32, y: i32) -> bool {
    let Ok(monitors) = window.available_monitors() else { return true };
    monitors.iter().any(|m| {
        let p = m.position();
        let s: &PhysicalSize<u32> = m.size();
        x + 40 >= p.x && x + 40 < p.x + s.width as i32 && y + 10 >= p.y && y + 10 < p.y + s.height as i32
    })
}

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWLP_HWNDPARENT, HWND_BOTTOM, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
    };

    /// Screen rectangle (left, top, right, bottom) of the primary taskbar, even when it is auto-hidden.
    pub fn taskbar_rect() -> Option<(i32, i32, i32, i32)> {
        use windows_sys::Win32::UI::Shell::{SHAppBarMessage, ABM_GETTASKBARPOS, APPBARDATA};
        unsafe {
            let mut data: APPBARDATA = std::mem::zeroed();
            data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
            if SHAppBarMessage(ABM_GETTASKBARPOS, &mut data) == 0 {
                return None;
            }
            let r = data.rc;
            Some((r.left, r.top, r.right, r.bottom))
        }
    }

    pub fn show_no_activate(window: &WebviewWindow) {
        let Some(hwnd) = hwnd(window) else { return };
        unsafe {
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }

    /// Ask WebView2 to trim its memory while the widget isn't being used (it stays fully functional).
    pub fn set_memory_low(window: &WebviewWindow, low: bool) {
        let _ = window.with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            };
            use windows_core::Interface;
            if let Ok(core) = webview.controller().CoreWebView2() {
                if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                    let level = if low {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    };
                    let _ = core19.SetMemoryUsageTargetLevel(level);
                }
            }
        });
    }

    fn hwnd(window: &WebviewWindow) -> Option<HWND> {
        window.hwnd().ok().map(|h| h.0 as HWND)
    }

    /// Making the desktop's "Progman" window the owner keeps the widget on the desktop layer: it stays below
    /// normal windows and remains visible when the user presses Win+D / "Show desktop".
    pub fn pin_to_desktop(window: &WebviewWindow, pin: bool) {
        let Some(hwnd) = hwnd(window) else { return };
        unsafe {
            let owner = if pin {
                let class: Vec<u16> = "Progman\0".encode_utf16().collect();
                FindWindowW(class.as_ptr(), std::ptr::null())
            } else {
                std::ptr::null_mut()
            };
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner as isize);
        }
    }

    pub fn send_to_bottom(window: &WebviewWindow) {
        let Some(hwnd) = hwnd(window) else { return };
        unsafe {
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::WebviewWindow;
    pub fn pin_to_desktop(_window: &WebviewWindow, _pin: bool) {}
    pub fn send_to_bottom(_window: &WebviewWindow) {}
    pub fn show_no_activate(window: &WebviewWindow) {
        let _ = window.show();
    }
    pub fn set_memory_low(_window: &WebviewWindow, _low: bool) {}
    pub fn taskbar_rect() -> Option<(i32, i32, i32, i32)> {
        None
    }
}

pub use platform::{send_to_bottom, set_memory_low};
