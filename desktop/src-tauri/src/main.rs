// Prevents a console window opening alongside the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The ForgeLocal desktop host.
//!
//! It owns four things and deliberately nothing else: the sidecar's lifetime,
//! the native folder dialog, request routing, and process cleanup. Everything
//! about being an agent — orchestration, tools, permissions, path containment —
//! stays in the Node runtime, which is the part that has tests.
//!
//! The renderer never touches the filesystem or a shell. It can only ask this
//! host to forward a frame, and the host checks the frame first.

mod engine;
mod hardware;
mod job;
mod sidecar;

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use engine::{Engine, EngineState, LaunchParams};
use sidecar::Sidecar;

struct HostState {
    sidecar: Arc<Sidecar>,
    engine: Arc<Engine>,
    node: String,
    script: PathBuf,
}

#[derive(Serialize)]
struct HostInfo {
    running: bool,
    protocol: u64,
    node: String,
    script: String,
    platform: String,
}

/// Where the runtime lives. In development it is the repository's own
/// `runtime/host/sidecar.mjs`; in a bundle it is next to the executable.
/// Remove Windows' extended-length prefix.
///
/// `resource_dir()` returns a canonicalised path, which on Windows carries
/// `\\?\`. Node cannot use that as an entry point: its module resolver called
/// `lstat` on `C:` and died with EISDIR before running a line of the runtime.
/// UNC paths keep the prefix, because for those it is load-bearing.
fn plain(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

/// The Node that runs the sidecar.
///
/// Resolution order, and the order is the whole point:
///
/// 1. `FORGELOCAL_NODE`, so a developer can point at a specific build.
/// 2. The Node we shipped, under the app's resources.
/// 3. `node` on PATH — **development only**.
///
/// Step three used to be the only step, which meant the app worked on a
/// machine with developer tools and failed on every other one. A person who
/// installs a chat application has not installed Node, and telling them to is
/// telling them to become a developer first.
///
/// In a release build the fallback is gone rather than quiet. If the vendored
/// runtime is not in the bundle, something went wrong in packaging, and picking
/// up whatever `node` happens to be on the user's PATH would turn that into a
/// heisenbug that reproduces only on machines that don't have one.
fn locate_node(app: &AppHandle) -> Result<String, String> {
    if let Ok(explicit) = std::env::var("FORGELOCAL_NODE") {
        if !explicit.is_empty() {
            return Ok(explicit);
        }
    }

    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = plain(dir).join("vendor").join("node").join(exe);
        if bundled.exists() {
            return Ok(bundled.to_string_lossy().to_string());
        }
    }

    // Development: the vendored copy sits in the source tree before packaging.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let in_tree = manifest.join("vendor").join("node").join(exe);
    if in_tree.exists() {
        return Ok(in_tree.to_string_lossy().to_string());
    }

    #[cfg(debug_assertions)]
    {
        devlog("[host] no vendored node; falling back to PATH (development only)");
        return Ok("node".into());
    }

    #[cfg(not(debug_assertions))]
    Err(format!(
        "The bundled runtime is missing: no {exe} under the application's resources. \
         This build was packaged incorrectly. Reinstalling ForgeLocal should fix it."
    ))
}

fn locate_script(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = plain(dir).join("runtime").join("host").join("sidecar.mjs");
        if bundled.exists() {
            return bundled;
        }
    }
    // Development: this file is at desktop/src-tauri/src/main.rs.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .join("..")
        .join("..")
        .join("runtime")
        .join("host")
        .join("sidecar.mjs")
}

/// A line from the renderer, for development only.
///
/// A WebView that fails to parse a module reports nothing a host can see, so a
/// window that never started the runtime looks exactly like one that started
/// and did nothing. This is how the renderer says which it was.
#[tauri::command]
fn host_log(line: String) {
    devlog(&format!("[ui] {}", line.chars().take(600).collect::<String>()));
}

#[tauri::command]
fn host_info(state: State<'_, HostState>) -> HostInfo {
    HostInfo {
        running: state.sidecar.is_alive(),
        protocol: sidecar::PROTOCOL_VERSION,
        node: state.node.clone(),
        script: state.script.to_string_lossy().to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

/// Start the runtime, or report the one already running.
///
/// This used to be an error when the runtime was alive, which broke every
/// in-app navigation. The sidecar belongs to the application and outlives any
/// one page, so the second page to load always found it running, connect()
/// threw, wireDesktop returned early, and the window fell back to the
/// prototype for the rest of its life: fixture sessions, a composer with no
/// model behind it, and one toast to say so. Starting is idempotent now.
///
/// Known gap: the previous page's session is still open in the runtime and
/// nothing disposes it, so a navigation leaks one session until the app exits.
#[tauri::command]
fn runtime_start(app: AppHandle, state: State<'_, HostState>) -> Result<u32, String> {
    devlog("[host] runtime_start invoked by the renderer");
    if state.sidecar.is_alive() {
        let pid = state.sidecar.pid();
        devlog(&format!("[host] runtime already running (pid {pid})"));

        /* Tell this page, which has not heard it.
         *
         * The sidecar announces itself once, on stdout, when it starts. The
         * renderer reloads far more often than that — navigating out of the
         * model browser is a reload — and every page after the first was
         * waiting for a hello that had already been said to somebody else. It
         * sat at "Desktop not connected" with a live runtime and, if a model
         * was loaded, an engine holding gigabytes of VRAM it could not see.
         *
         * Sent by the host rather than asked of the sidecar because the host
         * is what knows: is_alive is the same fact runtime_start just acted
         * on. `resumed` marks it as a re-announcement rather than a fresh
         * start, so nothing downstream mistakes it for the runtime having
         * restarted. */
        let _ = app.emit(
            "runtime://frame",
            serde_json::json!({
                "v": sidecar::PROTOCOL_VERSION,
                "id": Value::Null,
                "type": "runtime.state",
                "payload": { "connected": true, "protocol": sidecar::PROTOCOL_VERSION,
                             "pid": pid, "resumed": true }
            }),
        );
        return Ok(pid);
    }
    if state.node.is_empty() {
        /* locate_node already said why in the log. This is the sentence the
           person sees, and it names the fix rather than the missing file:
           nobody installing a chat app can act on "no node.exe under
           resources". */
        return Err(
            "ForgeLocal's runtime did not ship with this build, so nothing can start. \
             Reinstalling ForgeLocal should fix it."
                .to_string(),
        );
    }
    if !state.script.exists() {
        return Err(format!(
            "The runtime script is missing at {}.",
            state.script.display()
        ));
    }
    state
        .sidecar
        .start(app, &state.node, &state.script.to_string_lossy())
}

#[tauri::command]
fn runtime_stop(state: State<'_, HostState>) {
    state.sidecar.shutdown();
}

/// Forward one validated frame to the runtime.
#[tauri::command]
fn runtime_send(state: State<'_, HostState>, frame: Value) -> Result<(), String> {
    state.sidecar.send(frame)
}

/* ------------------------------------------------------------ the engine */

/// What this machine has, measured.
///
/// Every field is a measurement or a null. Nothing here substitutes a
/// plausible default for a number it could not read, because these numbers
/// decide which models the app says will run.
#[tauri::command]
fn hardware_probe() -> hardware::Hardware {
    hardware::probe()
}

/// Whether the engine binary is installed, without saying where.
///
/// The path is a host detail and a renderer that knows it is a renderer that
/// can be persuaded to mention it. Installed-or-not is the whole question the
/// interface has.
#[tauri::command]
fn engine_installed(app: AppHandle) -> bool {
    engine::locate(&app).is_some()
}

#[tauri::command]
fn engine_status(state: State<'_, HostState>) -> EngineState {
    state.engine.state()
}

/// The engine's own last words, for a failure the user can act on.
#[tauri::command]
fn engine_log(state: State<'_, HostState>) -> Vec<String> {
    state.engine.recent_log()
}

/// Start a model and point the runtime at it.
///
/// The port and the session token are produced here and handed to the Node
/// runtime down the pipe. **They are never returned to the renderer.** The
/// WebView is untrusted: a bearer token that reaches it is a token in whatever
/// that WebView can be talked into fetching, and the endpoint it opens is a
/// local port with no other protection. The renderer learns only that a model
/// is ready, which is all it needs to draw.
#[tauri::command]
async fn engine_start(
    app: AppHandle,
    state: State<'_, HostState>,
    params: LaunchParams,
) -> Result<EngineState, String> {
    let engine = Arc::clone(&state.engine);
    let handle = app.clone();

    // Loading a model blocks for as long as it blocks. Off the UI thread, or
    // the window is frozen for the minutes a 30B model takes.
    let launched = tauri::async_runtime::spawn_blocking(move || {
        engine::start(&handle, &engine, params)
    })
    .await
    .map_err(|e| format!("The engine task failed: {e}"))?;

    let (port, token) = launched?;

    /* Straight down the pipe, bypassing the renderer entirely. This frame is
       deliberately absent from the Rust allowlist that governs renderer
       traffic, so there is no path by which a page could forge one and point
       the runtime at a server of its choosing. */
    state.sidecar.send_host_frame(serde_json::json!({
        "v": sidecar::PROTOCOL_VERSION,
        "id": "host-engine-attach",
        "type": "engine.attached",
        "sessionId": null,
        "payload": {
            "baseUrl": format!("http://127.0.0.1:{port}/v1"),
            "apiKey": token,
        }
    }))?;

    Ok(state.engine.state())
}

#[tauri::command]
fn engine_stop(state: State<'_, HostState>) -> Result<(), String> {
    engine::stop(&state.engine);
    // The runtime is told the endpoint is gone, so a turn started against it
    // fails with "the engine stopped" rather than a connection refused.
    state.sidecar.send_host_frame(serde_json::json!({
        "v": sidecar::PROTOCOL_VERSION,
        "id": "host-engine-detach",
        "type": "engine.detached",
        "sessionId": null,
        "payload": {}
    }))
}

/// The native folder chooser.
///
/// This is the only way a project root is ever set. The renderer cannot name a
/// path: it asks for the dialog, the person picks a folder, and the path comes
/// back from the operating system. The runtime then canonicalises it and every
/// later path is resolved against that.
#[tauri::command]
async fn choose_project(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Choose a project folder")
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .recv()
        .map_err(|_| "The folder dialog closed unexpectedly.".to_string())?;

    Ok(picked.map(|p| match p.into_path() {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(e) => e.to_string(),
    }))
}

/// Choose a folder, for something other than a project.
///
/// The same dialog as `choose_project` with its own title, because a person
/// being asked where their model files live should not be asked to "choose a
/// project folder". The renderer still never names a path itself.
#[tauri::command]
async fn choose_directory(app: AppHandle, title: Option<String>) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(title.unwrap_or_else(|| "Choose a folder".into()))
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx
        .recv()
        .map_err(|_| "The folder dialog closed unexpectedly.".to_string())?;

    Ok(picked.map(|p| match p.into_path() {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(e) => e.to_string(),
    }))
}

/// Show a file in the system file manager, selected.
///
/// Refuses anything that is not an existing path, so a renderer cannot use
/// this to probe the filesystem for what exists by watching which calls
/// succeed — the answer is the same either way.
///
/// The platform calls differ in an important detail: Explorer and Finder both
/// take a "select this file" form that opens the containing folder with the
/// file highlighted, which is what people mean by "show in folder". Linux has
/// no portable equivalent, so it opens the directory.
#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("There is nothing at {path} any more."));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        /* No shell. The path is passed as one argument, so a file name
           containing a quote or an ampersand cannot become a command. */
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", p.display()))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("File Explorer would not open: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("Finder would not open: {e}"))?;
        return Ok(());
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let dir = if p.is_dir() { p.clone() } else {
            p.parent().map(|x| x.to_path_buf()).unwrap_or(p.clone())
        };
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("The file manager would not open: {e}"))?;
        Ok(())
    }
}

/// A development log next to the temp directory.
///
/// The WebView swallows renderer errors that happen before the console is
/// attached, so without this a window that failed to load its script looks
/// identical to one that loaded and did nothing. It is debug-only.
pub fn devlog(line: &str) {
    #[cfg(debug_assertions)]
    {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::env::temp_dir().join("forgelocal-host.log"))
        {
            let _ = writeln!(f, "{line}");
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = line;
}

/// Tauri's own WebView2 arguments. Setting `additionalBrowserArgs` replaces
/// this default rather than adding to it, so anything appended has to carry it.
#[cfg(debug_assertions)]
const TAURI_DEFAULT_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Turn on WebView2's remote debugging and its accessibility tree, in debug
/// builds, when `FORGELOCAL_DEVTOOLS_PORT` is set.
///
/// This used to set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` and claim in the
/// log that the port was on. WebView2 ignores that variable whenever the host
/// passes `additional_browser_args`, which Tauri always does, so the port was
/// never open and the log said it was. The window is declared in
/// tauri.conf.json, so the arguments have to go through the config.
#[cfg(debug_assertions)]
fn enable_devtools(ctx: &mut tauri::Context) {
    let Ok(port) = std::env::var("FORGELOCAL_DEVTOOLS_PORT") else { return };
    let Some(window) = ctx.config_mut().app.windows.get_mut(0) else {
        devlog("[host] devtools requested but no window is configured");
        return;
    };
    // --force-renderer-accessibility so the DOM is reachable from UI
    // Automation as well; without it the webview exposes only panes.
    window.additional_browser_args = Some(format!(
        "{TAURI_DEFAULT_BROWSER_ARGS} --remote-debugging-port={port} --force-renderer-accessibility"
    ));
    devlog(&format!("[host] devtools port {port}"));
}

fn main() {
    let mut ctx = tauri::generate_context!();
    #[cfg(debug_assertions)]
    enable_devtools(&mut ctx);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let script = locate_script(&handle);
            devlog(&format!(
                "[host] setup; script={} exists={}",
                script.display(),
                script.exists()
            ));
            /* A packaging failure is reported here rather than at the first
               message. The window still opens and still says what is wrong;
               refusing to start would leave a person with an app that flashes
               and vanishes, which is the least debuggable failure there is. */
            let node = match locate_node(&handle) {
                Ok(n) => {
                    devlog(&format!("[host] node={n}"));
                    n
                }
                Err(e) => {
                    devlog(&format!("[host] {e}"));
                    String::new()
                }
            };
            app.manage(HostState {
                sidecar: Arc::new(Sidecar::new()),
                engine: Arc::new(Engine::new()),
                node,
                script,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window must not leave a runtime behind holding the
            // user's project open.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<HostState>() {
                    // The engine first: it is the one holding gigabytes of
                    // VRAM, and an engine that outlives the window is the
                    // leak nobody forgives.
                    engine::stop(&state.engine);
                    state.sidecar.shutdown();
                }
            }
        })
        .on_page_load(|window, payload| {
            devlog(&format!("[host] page loaded: {}", payload.url()));
            // Debug only: report what the renderer sees, because a WebView that
            // fails to parse a module tells the host nothing at all.
            #[cfg(debug_assertions)]
            {
                let _ = window.eval(
                    r#"(function(){
                        var send=function(m){try{window.__TAURI_INTERNALS__.invoke('host_log',{line:String(m)})}catch(e){}};
                        window.addEventListener('error',function(e){send('error: '+e.message+' @'+e.filename+':'+e.lineno)});
                        window.addEventListener('unhandledrejection',function(e){send('rejection: '+(e.reason&&e.reason.message||e.reason))});
                        send('internals='+(!!window.__TAURI_INTERNALS__)+' path='+location.pathname);
                    })()"#,
                );
            }
            #[cfg(not(debug_assertions))]
            let _ = window;
        })
        .invoke_handler(tauri::generate_handler![
            host_log,
            host_info,
            runtime_start,
            runtime_stop,
            runtime_send,
            choose_project,
            choose_directory,
            reveal_in_folder,
            hardware_probe,
            engine_installed,
            engine_status,
            engine_log,
            engine_start,
            engine_stop
        ])
        .run(ctx)
        .expect("ForgeLocal failed to start");
}
