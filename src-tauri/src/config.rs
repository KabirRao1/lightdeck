//! Persistent app configuration (`config.json` in the app config dir).
//!
//! The file is a single JSON document. The Rust side only interprets `settings.mode` and `window`; everything
//! else (device names, scenes, color presets, ...) belongs to the UI and is stored verbatim.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Lives on the desktop layer, below normal windows (survives "show desktop").
    Desktop,
    /// Floats above all windows.
    Top,
    /// Hidden until the tray icon is clicked; behaves like a flyout.
    Tray,
}

impl Mode {
    pub fn parse(s: &str) -> Mode {
        match s {
            "top" => Mode::Top,
            "tray" => Mode::Tray,
            _ => Mode::Desktop,
        }
    }
}

pub struct Config {
    path: PathBuf,
    value: Mutex<Value>,
    save_tx: Mutex<Sender<()>>,
}

pub type SharedConfig = Arc<Config>;

impl Config {
    pub fn load(app: &AppHandle) -> SharedConfig {
        let dir = app.path().app_config_dir().expect("no app config dir");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("config.json");
        let value = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .filter(|v| v.is_object())
            .unwrap_or_else(|| json!({}));

        let (tx, rx) = channel::<()>();
        let config = Arc::new(Config { path, value: Mutex::new(value), save_tx: Mutex::new(tx) });

        // Debounced writer: sleeps until a change arrives, coalesces bursts (e.g. window dragging), then writes.
        let writer = Arc::downgrade(&config);
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                std::thread::sleep(Duration::from_millis(800));
                while rx.try_recv().is_ok() {}
                match writer.upgrade() {
                    Some(cfg) => cfg.write_now(),
                    None => break,
                }
            }
        });
        config
    }

    pub fn get(&self) -> Value {
        self.value.lock().unwrap().clone()
    }

    /// Replace the UI-owned parts of the config, keeping the Rust-owned `window` position.
    pub fn replace(&self, mut new_value: Value) {
        let mut guard = self.value.lock().unwrap();
        if let (Some(obj), Some(window)) = (new_value.as_object_mut(), guard.get("window").cloned()) {
            obj.insert("window".into(), window);
        }
        *guard = new_value;
        drop(guard);
        self.schedule_save();
    }

    pub fn mode(&self) -> Mode {
        let guard = self.value.lock().unwrap();
        Mode::parse(guard.pointer("/settings/mode").and_then(Value::as_str).unwrap_or("desktop"))
    }

    pub fn set_mode(&self, mode: &str) {
        self.update(|v| {
            ensure_object(v, "settings")["mode"] = json!(mode);
        });
    }

    pub fn window_pos(&self) -> Option<(i32, i32)> {
        let guard = self.value.lock().unwrap();
        let x = guard.pointer("/window/x")?.as_i64()?;
        let y = guard.pointer("/window/y")?.as_i64()?;
        Some((x as i32, y as i32))
    }

    pub fn set_window_pos(&self, x: i32, y: i32) {
        self.update(|v| {
            let w = ensure_object(v, "window");
            w["x"] = json!(x);
            w["y"] = json!(y);
        });
    }

    pub fn flag(&self, name: &str) -> bool {
        self.value.lock().unwrap().pointer(&format!("/internal/{name}")).and_then(Value::as_bool).unwrap_or(false)
    }

    pub fn set_flag(&self, name: &str) {
        self.update(|v| {
            ensure_object(v, "internal")[name] = json!(true);
        });
    }

    fn update(&self, f: impl FnOnce(&mut Value)) {
        f(&mut self.value.lock().unwrap());
        self.schedule_save();
    }

    fn schedule_save(&self) {
        let _ = self.save_tx.lock().unwrap().send(());
    }

    pub fn write_now(&self) {
        let text = serde_json::to_string_pretty(&*self.value.lock().unwrap()).unwrap_or_default();
        let tmp = self.path.with_extension("json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }
}

fn ensure_object<'a>(v: &'a mut Value, key: &str) -> &'a mut Value {
    if !v.get(key).map(Value::is_object).unwrap_or(false) {
        v[key] = json!({});
    }
    &mut v[key]
}
