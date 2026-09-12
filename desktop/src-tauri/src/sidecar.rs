//! The Node sidecar: spawning it, talking to it, and making sure it dies.
//!
//! The runtime lives in a separate process for one reason that matters: the
//! WebView holds no filesystem or shell authority at all. It can only send
//! frames through Tauri's IPC to this host, which forwards them over a pipe.
//! There is no local port to find and no unauthenticated surface.
//!
//! Two things this module is careful about. Frames are validated here before
//! they are forwarded, because a check in the renderer is not a security
//! control. And the sidecar's whole process tree is terminated on exit, since a
//! runtime that outlives the window keeps holding the user's files open and
//! keeps whatever it spawned alive with it.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// The protocol version this host speaks. A frame that disagrees is refused
/// rather than forwarded and hoped about.
pub const PROTOCOL_VERSION: u64 = 1;

/// Requests the renderer is allowed to send. Anything else never reaches the
/// pipe. This list is duplicated from the Node side deliberately: two
/// independent checks, so adding a request in one place cannot silently widen
/// the surface in the other.
const ALLOWED: &[&str] = &[
    "session.create",
    "session.dispose",
    "turn.start",
    "turn.cancel",
    "permission.resolve",
    "question.answer",
    "provider.connect",
    "provider.disconnect",
];

pub struct Sidecar {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    alive: AtomicBool,
}

impl Sidecar {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            alive: AtomicBool::new(false),
        }
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Start the runtime and pump its output onto the event bus.
    pub fn start(self: &Arc<Self>, app: AppHandle, node: &str, script: &str) -> Result<u32, String> {
        if self.is_alive() {
            return Err("The runtime is already running.".into());
        }

        let mut cmd = Command::new(node);
        cmd.arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // No console window for the sidecar.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not start the runtime with {node}: {e}"))?;

        let pid = child.id();
        let stdout = child.stdout.take().ok_or("The runtime gave no stdout.")?;
        let stderr = child.stderr.take().ok_or("The runtime gave no stderr.")?;
        *self.stdin.lock().unwrap() = child.stdin.take();
        *self.child.lock().unwrap() = Some(child);
        self.alive.store(true, Ordering::SeqCst);

        // stdout carries the protocol, one JSON object per line.
        {
            let app = app.clone();
            let me = Arc::clone(self);
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<Value>(trimmed) {
                        Ok(frame) => {
                            let _ = app.emit("runtime://frame", frame);
                        }
                        Err(e) => {
                            // A line the host cannot parse is surfaced, not
                            // dropped: the renderer is waiting on a reply that
                            // would otherwise never arrive.
                            let _ = app.emit(
                                "runtime://frame",
                                serde_json::json!({
                                    "v": PROTOCOL_VERSION,
                                    "id": Value::Null,
                                    "type": "turn.failed",
                                    "payload": {
                                        "code": "bad_frame",
                                        "message": format!("The runtime emitted an unreadable line: {e}"),
                                    }
                                }),
                            );
                        }
                    }
                }
                // stdout closing means the sidecar is gone.
                me.alive.store(false, Ordering::SeqCst);
                let _ = app.emit(
                    "runtime://frame",
                    serde_json::json!({
                        "v": PROTOCOL_VERSION,
                        "id": Value::Null,
                        "type": "runtime.state",
                        "payload": {
                            "connected": false,
                            "fatal": true,
                            "error": {
                                "code": "sidecar_exited",
                                "message": "The runtime process stopped. Nothing is running."
                            }
                        }
                    }),
                );
            });
        }

        // stderr is diagnostics only. It is forwarded as a separate channel so
        // a crash reason reaches the user instead of vanishing, and in a debug
        // build it also goes to the host log: a sidecar that dies during
        // startup has no renderer listening yet, so that was the one place its
        // reason could be seen.
        {
            let app = app.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    crate::devlog(&format!("[sidecar] {line}"));
                    let _ = app.emit("runtime://log", line);
                }
            });
        }

        Ok(pid)
    }

    /// Validate and forward one frame from the renderer.
    pub fn send(&self, frame: Value) -> Result<(), String> {
        if !self.is_alive() {
            return Err("The runtime is not running.".into());
        }
        let obj = frame.as_object().ok_or("A frame must be a JSON object.")?;

        match obj.get("v").and_then(Value::as_u64) {
            Some(v) if v == PROTOCOL_VERSION => {}
            other => {
                return Err(format!(
                    "This host speaks protocol v{PROTOCOL_VERSION}; the frame said {other:?}."
                ))
            }
        }
        let id = obj.get("id").and_then(Value::as_str).unwrap_or("");
        if id.is_empty() {
            return Err("Every request needs a non-empty string id.".into());
        }
        let kind = obj.get("type").and_then(Value::as_str).unwrap_or("");
        if !ALLOWED.contains(&kind) {
            return Err(format!("{kind} is not a request this host forwards."));
        }

        let mut line = serde_json::to_string(&frame).map_err(|e| e.to_string())?;
        line.push('\n');

        let mut guard = self.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or("The runtime has no input pipe.")?;
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("Could not write to the runtime: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("Could not flush to the runtime: {e}"))
    }

    /// Close stdin, then make sure the whole tree is gone.
    ///
    /// Closing stdin is the polite path: the sidecar exits on end-of-input and
    /// stops its own children first. The kill is the guarantee, because a
    /// runtime that survives the window keeps files open and keeps whatever it
    /// spawned running.
    pub fn shutdown(&self) {
        *self.stdin.lock().unwrap() = None;

        let mut guard = self.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            let pid = child.id();
            for _ in 0..20 {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                    Err(_) => break,
                }
            }
            if matches!(child.try_wait(), Ok(None)) {
                kill_tree(pid);
                let _ = child.kill();
            }
            let _ = child.wait();
        }
        *guard = None;
        self.alive.store(false, Ordering::SeqCst);
    }
}

/// Terminate a process and everything it started.
///
/// `child.kill()` ends only the direct child. On Windows a Node process that
/// spawned a build or a test runner leaves those running, which is how a
/// "closed" application keeps compiling in the background.
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}
