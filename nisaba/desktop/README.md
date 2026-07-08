# Nisaba desktop (Tauri v2)

A Linux desktop shell that shows the same Nisaba web app in a native window and
runs the local [service](../service) (REST + MCP) alongside it, so Claude Code
can talk to your notes while the app is open.

> **Status:** scaffold. The **service** is the tested, working part of Phase 4
> and runs on its own (`cd ../service && node src/main.js`) — you do **not** need
> this desktop app to connect Claude Code. This wraps it into a window; build it
> on your Linux box (it can't be compiled in the cloud dev sandbox).

## Prerequisites

- Rust + Cargo (https://rustup.rs)
- Tauri v2 system deps for Linux (webkit2gtk, etc.) —
  https://tauri.app/start/prerequisites/
- Node ≥ 18 on PATH (the shell spawns the service with `node`)

## Build & run

```bash
cd nisaba/desktop
npm install            # installs @tauri-apps/cli
npm run icons          # one-time: generate app icons from ../app/public/pwa-512.png
npm run dev            # dev window with hot-reload (runs ../app vite dev)
npm run build          # produces a .deb and .AppImage under src-tauri/target
```

`npm run dev` / `build` build the web app (`../app`) and, at runtime, spawn the
service so `http://localhost:27125` is live. Connect Claude Code with the command
the service prints on startup (see ../service/README.md).

## Notes / rough edges to finish on-device

- **Packaging the service.** `src/main.rs` currently spawns `node` from PATH with
  the repo-relative service path — fine for dev. For a distributable bundle,
  ship the service as a Tauri **sidecar** (compile it to a single binary with
  Node SEA or `bun build --compile`, add it to `tauri.conf.json > bundle >
  externalBin`, and launch it via the shell plugin) so end users don't need Node.
- **In-window auth.** Google blocks its JS sign-in inside webviews. The service's
  browser-loopback sign-in (reusing the Worker) is the supported path and opens
  your real browser — that's already how auth works here. The web UI inside the
  window reads/writes through its own IndexedDB replica as usual.
- **Icons.** `npm run icons` fills `src-tauri/icons/`. Committed builds ignore
  `src-tauri/target` and `src-tauri/gen`.
