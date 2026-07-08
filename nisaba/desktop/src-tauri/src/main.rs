// Nisaba desktop shell (Tauri v2). It does two things:
//   1. shows the same web app in a native window (frontendDist points at
//      ../../app/dist), and
//   2. spawns the local Node service (../../service) as a child process so the
//      REST + MCP API is available on http://localhost:27125 while the app runs.
//
// The service is what Claude Code talks to; the window is just the human UI.
// In production you'd bundle a Node runtime (or compile the service to a single
// binary) and ship it as a Tauri sidecar; for now this spawns `node` from PATH,
// which is enough to develop and to run on a dev machine that has Node.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct Service(Mutex<Option<Child>>);

fn spawn_service(app: &tauri::App) -> std::io::Result<Child> {
    // Resolve the service entry relative to the app during dev; when bundled,
    // ship the service next to the binary and adjust this path (or use a sidecar).
    let resource = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("service/src/main.js"));

    let script = resource
        .filter(|p| p.exists())
        .unwrap_or_else(|| std::path::PathBuf::from("../../service/src/main.js"));

    Command::new("node").arg(script).spawn()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            match spawn_service(app) {
                Ok(child) => {
                    app.manage(Service(Mutex::new(Some(child))));
                }
                Err(e) => eprintln!("could not start nisaba service: {e} (is `node` on PATH?)"),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill the service when the last window closes.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<Service>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Nisaba");
}
