// Nisaba desktop shell (Tauri v2).
//
// Shows the web app in a native window and gives it the local service's bearer
// token via an init script (window.__NISABA_SERVICE__), so the app's auth layer
// pulls Drive tokens from the service instead of Google's blocked-in-webview
// sign-in.
//
// Service lifecycle:
//   - If a service is already answering on the port (e.g. the systemd user
//     unit), we just connect to it — we never spawn a second one.
//   - Otherwise, in a *bundled* build, we launch the sidecar binary shipped
//     next to this executable (see `build:bundled`), so the .deb/.AppImage is
//     self-contained (no separate Node needed). We wait briefly for it to write
//     its token file, then read the token for injection.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const PORT_DEFAULT: u16 = 27125;

struct Sidecar(Mutex<Option<Child>>);

fn port() -> u16 {
    std::env::var("NISABA_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(PORT_DEFAULT)
}

fn config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("NISABA_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".config").join("nisaba")
}

// Minimal extraction of "token":"…" so we don't pull in a JSON crate.
fn read_service_token() -> Option<String> {
    let text = fs::read_to_string(config_dir().join("service.json")).ok()?;
    let after = text.split("\"token\"").nth(1)?;
    let after = after.trim_start().strip_prefix(':')?.trim_start();
    let rest = after.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

// Escape a value for embedding inside a double-quoted JS string literal. Covers
// the JS line terminators too (\n \r U+2028 U+2029) so this stays safe even if
// an input's charset ever loosens (L6).
fn js_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

fn service_answering(p: u16) -> bool {
    TcpStream::connect_timeout(&(([127, 0, 0, 1], p).into()), Duration::from_millis(300)).is_ok()
}

// Locate the bundled sidecar next to this executable. Tauri places externalBin
// binaries alongside the main binary, named either plainly or with the target
// triple. Match those exact names only — never a prefix scan of the dir (L4).
fn find_sidecar() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let candidates = [
        "nisaba-service".to_string(),
        format!("nisaba-service-{}", env!("TARGET")),
    ];
    candidates.iter().map(|n| dir.join(n)).find(|p| p.exists())
}

// Start the bundled service if nothing is already serving the port. Returns the
// child so we can stop it on exit. In a non-bundled build (no sidecar present)
// this is a no-op and the app connects to whatever external service is running.
fn ensure_service(p: u16) -> Option<Child> {
    if service_answering(p) {
        return None; // systemd or another instance already up — connect to it
    }
    let bin = find_sidecar()?;
    match Command::new(&bin).spawn() {
        Ok(child) => {
            // The service writes its token file at startup (before it listens),
            // so wait briefly for it so we can inject the token on first launch.
            let token_file = config_dir().join("service.json");
            for _ in 0..50 {
                if token_file.exists() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Some(child)
        }
        Err(e) => {
            eprintln!("could not start bundled service ({}): {e}", bin.display());
            None
        }
    }
}

fn main() {
    let p = port();
    let child = ensure_service(p);

    let base = format!("http://localhost:{p}");
    let token = read_service_token().unwrap_or_default();
    if token.is_empty() {
        eprintln!("Warning: no service token yet; the window will show sign-in until the service is connected.");
    }
    let init = format!(
        "window.__NISABA_SERVICE__ = {{ base: \"{}\", token: \"{}\" }};",
        js_string(&base),
        js_string(&token)
    );

    // Load the bundled UI (tauri://localhost). We must NOT load the deployed
    // https site: the Linux webview (WebKitGTK) blocks fetches from an https
    // page to the http://localhost service as mixed content, which breaks auth.
    // The bundled tauri:// origin can reach the local service. (UI updates
    // therefore need a rebuild; the Tauri updater is the path to auto-updates.)
    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(child)))
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Nisaba")
                .inner_size(440.0, 860.0)
                .min_inner_size(360.0, 640.0)
                .initialization_script(&init)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Stop the bundled service (if we started it) when the app closes.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<Sidecar>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut c) = guard.take() {
                            let _ = c.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Nisaba");
}
