// Nisaba desktop shell (Tauri v2).
//
// It shows the same web app in a native window and hands it what it needs to
// talk to the local service: it reads the service's bearer token from
// ~/.config/nisaba/service.json and injects
//   window.__NISABA_SERVICE__ = { base, token }
// as an initialization script — which runs before the page's own scripts, so
// the app's auth layer (lib/auth.js) picks it up and pulls Drive tokens from the
// service instead of Google's blocked-in-webview sign-in.
//
// The service itself is expected to be running already (the systemd user unit
// installs it: nisaba/service/systemd/install.sh). This shell connects to it; it
// does not spawn its own copy, so it never collides with the systemd instance.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindowBuilder};

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

fn js_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn main() {
    let port: u16 = std::env::var("NISABA_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(27125);
    let base = format!("http://localhost:{port}");
    let token = read_service_token().unwrap_or_default();
    if token.is_empty() {
        eprintln!(
            "Warning: no service token found in {}. Start the service once (systemd or `node src/main.js`) so it generates one.",
            config_dir().join("service.json").display()
        );
    }
    let init = format!(
        "window.__NISABA_SERVICE__ = {{ base: \"{}\", token: \"{}\" }};",
        js_string(&base),
        js_string(&token)
    );

    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Nisaba")
                .inner_size(440.0, 860.0)
                .min_inner_size(360.0, 640.0)
                .initialization_script(&init)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nisaba");
}
