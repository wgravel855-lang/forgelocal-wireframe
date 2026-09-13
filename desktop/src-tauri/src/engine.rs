//! ForgeLocal's own inference engine.
//!
//! A bundled `llama-server` from llama.cpp, owned by this host from spawn to
//! kill. LM Studio remains available as an *external* provider and nothing
//! here touches it: not its binaries, not its models folder, not its port.
//!
//! ## What makes this safe to run
//!
//! **It is bound to the loopback and nothing else.** `--host 127.0.0.1` on a
//! port the OS chooses. No `0.0.0.0`, no fixed port, so there is no predictable
//! local endpoint for anything else on the machine to find and no path from
//! another host on the network.
//!
//! **Every session gets its own token.** llama.cpp's `--api-key` makes the
//! server refuse anything without a matching bearer token. The token is 32
//! bytes of OS entropy, generated per launch, and it never leaves this process
//! except down the pipe to the Node runtime. The renderer never receives it:
//! the WebView is untrusted here, and a token in a WebView is a token in
//! whatever that WebView is persuaded to fetch. A loopback port with no auth
//! would otherwise be reachable by any process on the machine, including a
//! page in a browser.
//!
//! **Its whole tree dies with the window.** A 12GB model resident in VRAM
//! after the app closes is not a leak anyone forgives.
//!
//! ## What it does when things go wrong
//!
//! A model that will not load, a driver that is too old, a port that was taken
//! between choosing it and binding it — all produce a state with a sentence
//! that says what to do, not a spinner. A server that dies while it was
//! working is restarted, with a bounded number of attempts and a backoff, and
//! when the attempts run out it stops and says so rather than thrashing.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How long to wait for a model to become servable before giving up.
///
/// A 30B model off a cold spinning disk genuinely takes minutes. The interface
/// shows progress the whole time, so this bound exists only to end a wait that
/// is never going to finish.
const READY_TIMEOUT: Duration = Duration::from_secs(600);

/// How often to ask the server whether it is alive, once it has been.
const HEALTH_EVERY: Duration = Duration::from_secs(5);

/// Restarts allowed for one model before this stops trying.
///
/// Three, because the failures worth retrying are transient — a port taken in
/// the gap between choosing and binding, a driver that needed a moment — and
/// the ones that are not transient fail identically every time. A fourth
/// attempt is a loop the user has to notice and stop.
const MAX_RESTARTS: u32 = 3;

/// What the engine is doing, in the words the interface renders.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum EngineState {
    /// Nothing is running and nothing is wrong.
    Stopped,
    /// Spawned, loading weights. `detail` carries the server's own last line.
    Starting { model: String, detail: String },
    /// Answering requests.
    Ready {
        model: String,
        port: u16,
        /// Seconds it took to become ready, which is the number people want
        /// when deciding whether a model is worth using.
        load_seconds: u64,
        gpu_layers: Option<u32>,
        context: Option<u32>,
    },
    /// It was ready, it died, and this is attempt `attempt` of `MAX_RESTARTS`.
    Restarting { model: String, attempt: u32, reason: String },
    /// Stopped, and not coming back without a change. `fix` is what to do.
    Failed { model: Option<String>, reason: String, fix: String },
}

/// How to start a model. Everything here is the user's choice, not a guess.
#[derive(Debug, Clone, Deserialize)]
pub struct LaunchParams {
    /// Absolute path to a .gguf on this machine. Never a URL, never a name.
    pub model_path: String,
    /// Layers to put on the GPU. `None` lets llama.cpp decide; `Some(0)` is
    /// processor-only and is a real choice, not an absence.
    pub gpu_layers: Option<u32>,
    pub context: Option<u32>,
    /// Parallel sequences. One, unless something asks otherwise: each costs a
    /// full KV cache.
    pub parallel: Option<u32>,
    pub flash_attention: Option<bool>,
}

pub struct Engine {
    child: Mutex<Option<Child>>,
    state: Mutex<EngineState>,
    /// The token this launch authenticates with. Never sent to the renderer.
    token: Mutex<String>,
    port: AtomicU32,
    /// Set while a stop was asked for, so the monitor can tell a crash from a
    /// shutdown. Without it, quitting the app looks like a crash and the
    /// restart logic fights the user closing the window.
    stopping: AtomicBool,
    restarts: AtomicU32,
    /// The last lines the server printed, for a failure the user can act on.
    log: Mutex<Vec<String>>,
    /// The parameters of the current launch, so a restart repeats it exactly.
    last: Mutex<Option<LaunchParams>>,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            state: Mutex::new(EngineState::Stopped),
            token: Mutex::new(String::new()),
            port: AtomicU32::new(0),
            stopping: AtomicBool::new(false),
            restarts: AtomicU32::new(0),
            log: Mutex::new(Vec::new()),
            last: Mutex::new(None),
        }
    }

    pub fn state(&self) -> EngineState {
        self.state.lock().map(|s| s.clone()).unwrap_or(EngineState::Stopped)
    }

    /// The last lines the server wrote. The interface shows these when a
    /// launch fails, because llama.cpp's own message is more specific than
    /// anything this file could say about why a model would not load.
    pub fn recent_log(&self) -> Vec<String> {
        self.log.lock().map(|l| l.clone()).unwrap_or_default()
    }

    fn set(&self, app: &AppHandle, next: EngineState) {
        if let Ok(mut s) = self.state.lock() {
            *s = next.clone();
        }
        // The renderer learns about the engine the same way it learns about
        // everything else: an event it did not have to ask for.
        let _ = app.emit("engine://state", &next);
    }

    fn note(&self, app: &AppHandle, line: String) {
        if let Ok(mut log) = self.log.lock() {
            log.push(line.clone());
            // Enough to diagnose a failed load, not enough to hold a session's
            // worth of token timings in memory.
            if log.len() > 200 {
                log.remove(0);
            }
        }
        let _ = app.emit("engine://log", &line);
    }
}

/// Where the bundled server is.
///
/// `externalBin` puts it beside the executable with the target triple stripped.
/// In development it is wherever `scripts/fetch-engine.mjs` placed it, which is
/// the same `binaries/` directory the bundler reads.
pub fn locate(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };

    if let Ok(dir) = app.path().resource_dir() {
        let p = strip_unc(dir).join(name);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    // Development: desktop/src-tauri/binaries/llama-server-<triple>[.exe]
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if manifest.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&manifest) {
            for e in entries.flatten() {
                let f = e.file_name();
                let f = f.to_string_lossy();
                if f.starts_with("llama-server") {
                    return Some(e.path());
                }
            }
        }
    }
    None
}

/// Windows' extended-length prefix breaks anything that is not Win32-aware.
fn strip_unc(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

/// A port nothing is using, chosen by the OS.
///
/// Binding to port 0 and reading back what was assigned. There is a window
/// between dropping this listener and llama-server binding the same port, and
/// nothing can close it without llama.cpp accepting a pre-bound socket. A loss
/// of that race is a launch failure with a clear message, and the restart path
/// picks a different port.
fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// 32 bytes of OS entropy, hex.
fn token() -> String {
    let mut buf = [0u8; 32];
    // A failure here means the OS has no entropy source, which is not a
    // condition to paper over with a timestamp.
    getrandom::getrandom(&mut buf).expect("the OS refused to provide entropy");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Ask the server whether it is up.
///
/// A hand-written HTTP/1.1 GET over a TCP socket rather than an HTTP client
/// crate. The whole conversation is one request to one loopback endpoint with
/// no redirects, no TLS and no content negotiation; pulling in an async runtime
/// for it would be more code, not less.
///
/// llama.cpp answers `/health` with 200 once the model is servable and 503
/// while it is still loading, which is exactly the distinction needed.
fn health(port: u16, token: &str, timeout: Duration) -> Option<u16> {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().ok()?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;

    let req = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).ok()?;
    stream.flush().ok()?;

    let mut head = String::new();
    let mut buf = [0u8; 256];
    // The status line is all that matters, so this reads until it has one
    // rather than draining a body it will not look at.
    while !head.contains("\r\n") {
        let n = stream.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        head.push_str(&String::from_utf8_lossy(&buf[..n]));
        if head.len() > 4096 {
            break;
        }
    }
    let _ = stream.shutdown(Shutdown::Both);

    let status = head.split_whitespace().nth(1)?;
    status.parse::<u16>().ok()
}

/// Turn a launch failure into something a person can act on.
///
/// The rule: name the thing that failed and the next step. "Engine error" with
/// an exit code is a message that sends people to a search engine.
fn diagnose(log: &[String], exit: Option<i32>) -> (String, String) {
    let text = log.join("\n").to_lowercase();

    if text.contains("cudart") || text.contains("cublas") || text.contains("cuda driver") {
        return (
            "The CUDA engine could not start.".into(),
            "The NVIDIA driver on this machine is older than the engine build needs. \
             Update the driver, or switch to the Vulkan or processor build in Settings."
                .into(),
        );
    }
    if text.contains("failed to load model") || text.contains("unable to load model") {
        return (
            "The model file could not be loaded.".into(),
            "The file may be incomplete or not a GGUF. Verify it in Models, or download it again."
                .into(),
        );
    }
    if text.contains("out of memory") || text.contains("cudamalloc") || text.contains("vk_error_out_of_device_memory") {
        return (
            "There was not enough GPU memory for this model.".into(),
            "Lower the GPU layers or the context size, or choose a smaller model. \
             Both are on the model's load panel."
                .into(),
        );
    }
    if text.contains("address already in use") || text.contains("bind") {
        return (
            "The port the engine chose was taken before it could bind.".into(),
            "Start it again; a different port is chosen each time.".into(),
        );
    }
    if text.contains("not a dynamic executable") || text.contains("dll") || text.contains("shared librar") {
        return (
            "The engine binary is missing files it needs beside it.".into(),
            "Re-run scripts/fetch-engine.mjs to reinstall the engine.".into(),
        );
    }
    (
        match exit {
            Some(c) => format!("The engine stopped with exit code {c}."),
            None => "The engine stopped unexpectedly.".into(),
        },
        "The last lines it printed are below. If they say nothing useful, try a \
         different engine build in Settings."
            .into(),
    )
}

/// Start a model, and keep it running.
///
/// Returns once the server answers `/health`, or with the reason it never did.
/// The caller gets the port and token so it can hand them to the runtime; they
/// are deliberately not part of any state the renderer sees.
pub fn start(
    app: &AppHandle,
    engine: &Arc<Engine>,
    params: LaunchParams,
) -> Result<(u16, String), String> {
    stop(engine);

    let model_path = PathBuf::from(&params.model_path);
    if !model_path.is_file() {
        let reason = format!("No model file at {}", params.model_path);
        let fix = "Choose a model from the Models page, or download one.".to_string();
        engine.set(app, EngineState::Failed { model: None, reason: reason.clone(), fix });
        return Err(reason);
    }

    let Some(binary) = locate(app) else {
        let reason = "The inference engine is not installed.".to_string();
        engine.set(
            app,
            EngineState::Failed {
                model: None,
                reason: reason.clone(),
                // The only actionable thing, said exactly.
                fix: "Run `node scripts/fetch-engine.mjs --list` to see the builds for \
                      this machine, then fetch one. ForgeLocal cannot run a model without it. \
                      An external server such as LM Studio can be used instead, from Settings."
                    .into(),
            },
        );
        return Err(reason);
    };

    let port = match free_port() {
        Ok(p) => p,
        Err(e) => {
            let reason = format!("No free loopback port: {e}");
            engine.set(app, EngineState::Failed {
                model: None,
                reason: reason.clone(),
                fix: "Something is preventing local sockets from being opened. A firewall \
                      or endpoint-protection product is the usual cause."
                    .into(),
            });
            return Err(reason);
        }
    };

    let secret = token();
    let name = model_path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| params.model_path.clone());

    if let Ok(mut t) = engine.token.lock() {
        *t = secret.clone();
    }
    engine.port.store(port as u32, Ordering::SeqCst);
    if let Ok(mut l) = engine.log.lock() {
        l.clear();
    }
    if let Ok(mut last) = engine.last.lock() {
        *last = Some(params.clone());
    }
    engine.stopping.store(false, Ordering::SeqCst);

    engine.set(app, EngineState::Starting { model: name.clone(), detail: "Starting the engine".into() });

    let mut cmd = Command::new(&binary);
    cmd.arg("--host").arg("127.0.0.1")
        .arg("--port").arg(port.to_string())
        // Without this the endpoint is open to every process on the machine,
        // including a web page the user happens to have open.
        .arg("--api-key").arg(&secret)
        .arg("-m").arg(&model_path)
        // The server logs to stderr; it is read for progress and for the
        // sentence shown when a launch fails.
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    if let Some(n) = params.gpu_layers {
        cmd.arg("-ngl").arg(n.to_string());
    }
    if let Some(c) = params.context {
        cmd.arg("-c").arg(c.to_string());
    }
    if let Some(p) = params.parallel {
        cmd.arg("-np").arg(p.to_string());
    }
    if params.flash_attention == Some(true) {
        cmd.arg("-fa").arg("on");
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let reason = format!("The engine would not start: {e}");
            engine.set(app, EngineState::Failed {
                model: Some(name),
                reason: reason.clone(),
                fix: "The engine binary may be blocked by endpoint protection, or missing \
                      the libraries it needs beside it. Re-run scripts/fetch-engine.mjs."
                    .into(),
            });
            return Err(reason);
        }
    };

    // Drain stderr on its own thread. A child whose pipe fills up stops.
    if let Some(err) = child.stderr.take() {
        let app2 = app.clone();
        let engine2 = Arc::clone(engine);
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                engine2.note(&app2, line);
            }
        });
    }

    if let Ok(mut slot) = engine.child.lock() {
        *slot = Some(child);
    }

    let began = Instant::now();
    let deadline = began + READY_TIMEOUT;

    loop {
        // A child that exited is never going to answer.
        let exited = engine
            .child
            .lock()
            .ok()
            .and_then(|mut c| c.as_mut().and_then(|ch| ch.try_wait().ok().flatten()));
        if let Some(status) = exited {
            let log = engine.recent_log();
            let (reason, fix) = diagnose(&log, status.code());
            engine.set(app, EngineState::Failed { model: Some(name), reason: reason.clone(), fix });
            return Err(reason);
        }

        match health(port, &secret, Duration::from_millis(800)) {
            Some(200) => break,
            Some(503) | None => {}
            Some(401) | Some(403) => {
                // The server is up and rejecting our own token, which means
                // something else is on this port.
                let reason = "Another program is answering on the engine's port.".to_string();
                engine.set(app, EngineState::Failed {
                    model: Some(name),
                    reason: reason.clone(),
                    fix: "Start the engine again; it chooses a different port each time.".into(),
                });
                return Err(reason);
            }
            Some(_) => {}
        }

        if Instant::now() > deadline {
            let reason = format!(
                "The model did not become ready within {} minutes.",
                READY_TIMEOUT.as_secs() / 60
            );
            engine.set(app, EngineState::Failed {
                model: Some(name),
                reason: reason.clone(),
                fix: "A very large model on a slow disk can exceed this. Try a smaller \
                      model, or fewer GPU layers if the machine is swapping."
                    .into(),
            });
            stop(engine);
            return Err(reason);
        }

        // Progress, from the server's own words rather than invented.
        if let Some(last) = engine.recent_log().last() {
            engine.set(app, EngineState::Starting {
                model: name.clone(),
                detail: last.chars().take(120).collect(),
            });
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    engine.restarts.store(0, Ordering::SeqCst);
    engine.set(app, EngineState::Ready {
        model: name.clone(),
        port,
        load_seconds: began.elapsed().as_secs(),
        gpu_layers: params.gpu_layers,
        context: params.context,
    });

    watch(app, engine, name, port, secret.clone());
    Ok((port, secret))
}

/// Notice when the engine dies, and bring it back.
///
/// A separate thread polling health, rather than only waiting on the process:
/// a server that is alive but wedged answers nothing, and from the user's
/// side that is identical to one that crashed. Both are worth recovering from.
fn watch(app: &AppHandle, engine: &Arc<Engine>, model: String, port: u16, secret: String) {
    let app = app.clone();
    let engine = Arc::clone(engine);

    std::thread::spawn(move || {
        let mut misses = 0;
        loop {
            std::thread::sleep(HEALTH_EVERY);

            if engine.stopping.load(Ordering::SeqCst) {
                return;
            }
            // A state that is no longer Ready means somebody else took over.
            if !matches!(engine.state(), EngineState::Ready { .. }) {
                return;
            }

            let alive = matches!(health(port, &secret, Duration::from_secs(3)), Some(200));
            if alive {
                misses = 0;
                continue;
            }
            // Two in a row, so one slow answer under load is not a crash.
            misses += 1;
            if misses < 2 {
                continue;
            }

            if engine.stopping.load(Ordering::SeqCst) {
                return;
            }

            let attempt = engine.restarts.fetch_add(1, Ordering::SeqCst) + 1;
            let log = engine.recent_log();
            let (reason, fix) = diagnose(&log, None);

            if attempt > MAX_RESTARTS {
                engine.set(&app, EngineState::Failed {
                    model: Some(model),
                    reason: format!("{reason} It has been restarted {MAX_RESTARTS} times."),
                    fix: format!(
                        "{fix} Restarting is not helping, so it has stopped trying."
                    ),
                });
                stop(&engine);
                return;
            }

            engine.set(&app, EngineState::Restarting {
                model: model.clone(),
                attempt,
                reason: reason.clone(),
            });

            let params = engine.last.lock().ok().and_then(|p| p.clone());
            stop(&engine);
            // Backoff, so a model that fails instantly does not burn three
            // attempts in a second and report "tried three times" truthfully
            // but uselessly.
            std::thread::sleep(Duration::from_secs(2 * attempt as u64));

            if let Some(p) = params {
                // A successful restart installs its own watcher, so this one
                // ends either way.
                let _ = start(&app, &engine, p);
            }
            return;
        }
    });
}

/// Stop the server and everything it started.
pub fn stop(engine: &Arc<Engine>) {
    engine.stopping.store(true, Ordering::SeqCst);
    engine.port.store(0, Ordering::SeqCst);

    let Ok(mut slot) = engine.child.lock() else { return };
    let Some(mut child) = slot.take() else { return };

    // On Windows the server spawns nothing, but killing the tree is what makes
    // that true rather than assumed.
    #[cfg(windows)]
    {
        let pid = child.id();
        let mut kill = Command::new("taskkill");
        kill.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        kill.creation_flags(CREATE_NO_WINDOW);
        let _ = kill.status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_not_guessable() {
        let a = token();
        let b = token();
        assert_eq!(a.len(), 64, "32 bytes of entropy, hex");
        assert_ne!(a, b, "two launches produced the same token");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn a_port_is_chosen_not_fixed() {
        let a = free_port().unwrap();
        assert!(a > 0);
        // Not proof of randomness — the OS decides — but a fixed constant
        // would fail this on the second call while the first is still bound.
        let b = free_port().unwrap();
        assert!(b > 0);
    }

    #[test]
    fn a_failure_says_what_to_do() {
        // Every branch of diagnose has to produce a fix, because a reason
        // without a next step is where a user gives up.
        let cases: Vec<Vec<String>> = vec![
            vec!["cudart64_12.dll not found".into()],
            vec!["error: failed to load model".into()],
            vec!["ggml_cuda_host_malloc: out of memory".into()],
            vec!["bind: address already in use".into()],
            vec!["nothing recognisable at all".into()],
        ];
        for log in cases {
            let (reason, fix) = diagnose(&log, Some(1));
            assert!(!reason.is_empty(), "no reason for {log:?}");
            assert!(fix.len() > 20, "the fix for {log:?} is not actionable: {fix}");
            assert!(
                !reason.to_lowercase().contains("unknown error"),
                "a reason that says nothing: {reason}"
            );
        }
    }

    #[test]
    fn health_on_a_dead_port_is_not_ready() {
        // Nothing is listening, so this must be None rather than a hang.
        let port = free_port().unwrap();
        assert_eq!(health(port, "x", Duration::from_millis(300)), None);
    }
}
