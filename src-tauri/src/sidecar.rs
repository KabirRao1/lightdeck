//! Supervises the Matter engine: a bundled Node.js runtime running `matter-sidecar.mjs` (matter.js).
//!
//! Talks JSON lines over stdin/stdout. Responses are matched to requests by id; events are forwarded to the UI as
//! the `matter://event` Tauri event. The engine is restarted automatically if it exits unexpectedly.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch};

type Pending = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

/// Strip the Windows verbatim prefix (`\\?\C:\...`) that Tauri's path APIs may return; Node.js can't load
/// scripts from such paths.
fn plain(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

pub struct Sidecar {
    app: AppHandle,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<Pending>,
    next_id: AtomicU64,
    ready_tx: watch::Sender<bool>,
    shutting_down: AtomicBool,
    restarts: AtomicU64,
}

impl Sidecar {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let (ready_tx, _) = watch::channel(false);
        Arc::new(Sidecar {
            app,
            stdin: Mutex::new(None),
            child: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            ready_tx,
            shutting_down: AtomicBool::new(false),
            restarts: AtomicU64::new(0),
        })
    }

    fn paths(&self) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
        let exe_dir = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("no exe dir")?
            .to_path_buf();
        let engine = exe_dir.join(if cfg!(windows) { "lightdeck-engine.exe" } else { "lightdeck-engine" });
        let script = self
            .app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("sidecar")
            .join("matter-sidecar.mjs");
        let storage = self.app.path().app_data_dir().map_err(|e| e.to_string())?.join("matter");
        let logs = self.app.path().app_log_dir().map_err(|e| e.to_string())?;
        Ok((plain(engine), plain(script), plain(storage), plain(logs)))
    }

    pub fn start(self: &Arc<Self>) -> Result<(), String> {
        let (engine, script, storage, logs) = self.paths()?;
        std::fs::create_dir_all(&storage).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&logs).map_err(|e| e.to_string())?;

        let mut cmd = Command::new(&engine);
        cmd.arg(&script)
            .arg("--storage")
            .arg(&storage)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not start the Matter engine ({}): {e}", engine.display()))?;

        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        *self.stdin.lock().unwrap() = child.stdin.take();
        *self.child.lock().unwrap() = Some(child);

        // stderr -> log file (truncated each start so it can never grow without bound).
        let log_path = logs.join("matter-engine.log");
        std::thread::spawn(move || {
            let mut file = std::fs::File::create(log_path).ok();
            let mut written = 0usize;
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Some(f) = file.as_mut() {
                    if written < 5_000_000 {
                        written += line.len() + 1;
                        let _ = writeln!(f, "{line}");
                    }
                }
            }
        });

        // stdout -> responses / events.
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                this.handle_line(&line);
            }
            this.on_exit();
        });
        Ok(())
    }

    fn handle_line(&self, line: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(line) else { return };
        if let Some(event) = msg.get("event").and_then(Value::as_str) {
            if event == "ready" {
                self.restarts.store(0, Ordering::Relaxed);
                let _ = self.ready_tx.send(true);
            }
            let _ = self.app.emit("matter://event", &msg);
            return;
        }
        let Some(id) = msg.get("id").and_then(Value::as_u64) else { return };
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let result = if msg.get("ok").and_then(Value::as_bool) == Some(true) {
                Ok(msg.get("result").cloned().unwrap_or(Value::Null))
            } else {
                Err(msg.get("error").and_then(Value::as_str).unwrap_or("Unknown error").to_string())
            };
            let _ = tx.send(result);
        }
    }

    fn on_exit(self: &Arc<Self>) {
        let _ = self.ready_tx.send(false);
        *self.stdin.lock().unwrap() = None;
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.wait();
        }
        for (_, tx) in self.pending.lock().unwrap().drain() {
            let _ = tx.send(Err("The Matter engine stopped unexpectedly".into()));
        }
        if self.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        let _ = self.app.emit("matter://event", json!({ "event": "stopped" }));
        // Restart with backoff: 1s, 2s, 4s ... capped at 60s.
        let attempt = self.restarts.fetch_add(1, Ordering::Relaxed);
        let delay = Duration::from_secs((1u64 << attempt.min(6)).min(60));
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            if !this.shutting_down.load(Ordering::SeqCst) {
                if let Err(e) = this.start() {
                    let _ = this.app.emit("matter://event", json!({ "event": "fatal", "data": { "error": e } }));
                }
            }
        });
    }

    pub async fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        // Wait for the engine to be ready (it may be starting or restarting).
        let mut ready = self.ready_tx.subscribe();
        tokio::time::timeout(Duration::from_secs(30), ready.wait_for(|r| *r))
            .await
            .map_err(|_| "The Matter engine is not responding".to_string())?
            .map_err(|_| "The Matter engine is not running".to_string())?;

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let line = json!({ "id": id, "method": method, "params": params }).to_string() + "\n";
        {
            let mut stdin = self.stdin.lock().unwrap();
            let Some(stdin) = stdin.as_mut() else {
                self.pending.lock().unwrap().remove(&id);
                return Err("The Matter engine is not running".into());
            };
            if let Err(e) = stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()) {
                self.pending.lock().unwrap().remove(&id);
                return Err(e.to_string());
            }
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("The Matter engine stopped unexpectedly".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("'{method}' timed out"))
            }
        }
    }

    /// Ask the engine to close cleanly (so matter.js flushes its storage), then make sure it is gone.
    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        if let Some(stdin) = self.stdin.lock().unwrap().as_mut() {
            let _ = stdin.write_all(b"{\"id\":0,\"method\":\"shutdown\",\"params\":{}}\n");
            let _ = stdin.flush();
        }
        let mut child = self.child.lock().unwrap().take();
        if let Some(child) = child.as_mut() {
            for _ in 0..30 {
                if let Ok(Some(_)) = child.try_wait() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = child.kill();
        }
    }
}
