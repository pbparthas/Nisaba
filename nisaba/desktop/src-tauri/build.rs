fn main() {
    // Expose the target triple so the runtime can match the sidecar binary by
    // its exact name (see find_sidecar in main.rs).
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=TARGET={target}");
    }
    tauri_build::build()
}
