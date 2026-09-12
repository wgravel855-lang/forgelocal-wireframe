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

mod sidecar;

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use sidecar::Sidecar;

struct HostState {
    sidecar: Arc<Sidecar>,
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

/// Start the runtime. Safe to call again after a crash: that is the restart
/// path, and it is the same code path as the first start.
#[tauri::command]
fn runtime_start(app: AppHandle, state: State<'_, HostState>) -> Result<u32, String> {
    devlog("[host] runtime_start invoked by the renderer");
    if state.sidecar.is_alive() {
        return Err("The runtime is already running.".into());
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

fn main() {
    // WebView2 reads this when it creates its environment, which happens inside
    // Builder::run. Setting it here rather than in the parent shell guarantees
    // it is in place first; without a port set, nothing changes.
    #[cfg(debug_assertions)]
    if let Ok(port) = std::env::var("FORGELOCAL_DEVTOOLS_PORT") {
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            format!("{existing} --remote-debugging-port={port}").trim(),
        );
        devlog(&format!("[host] devtools port {port}"));
    }

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
            app.manage(HostState {
                sidecar: Arc::new(Sidecar::new()),
                // A bundled runtime would ship its own Node; development uses
                // the one on PATH, and a missing one is reported rather than
                // guessed at.
                node: std::env::var("FORGELOCAL_NODE").unwrap_or_else(|_| "node".into()),
                script,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window must not leave a runtime behind holding the
            // user's project open.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<HostState>() {
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
            choose_project
        ])
        .run(tauri::generate_context!())
        .expect("ForgeLocal failed to start");
}
