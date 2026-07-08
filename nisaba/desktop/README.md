# Nisaba desktop (Tauri v2)

A Linux desktop app: the same Nisaba web UI in a native window, syncing to your
own Google Drive. It authenticates **through the local [service](../service)** —
the native shell reads the service's bearer token and injects
`window.__NISABA_SERVICE__` into the page, so the app pulls Drive access tokens
from the service over localhost and never loads Google's sign-in JS (which is
blocked inside webviews).

> **Can't be built in the cloud sandbox** (no display / no Rust GUI libs), so it
> ships as complete, buildable source — you compile it on your Linux box. The
> service and app-side plumbing it depends on are unit-tested; the GUI itself
> needs on-device build + likely a small fix or two. Paste any build errors and
> I'll fix them.

## Prerequisites

- The **service must be running** — the app connects to it, it does not start
  its own copy (so it never collides with your systemd instance). Install the
  always-on unit first: `cd ../service && bash systemd/install.sh`, and sign in
  once (`node src/main.js`, complete the browser step) so a token + session
  exist.
- Rust + Cargo — https://rustup.rs
- Tauri v2 Linux system deps (webkit2gtk 4.1, libsoup3, etc.) —
  https://tauri.app/start/prerequisites/
  (Debian/Ubuntu: `libwebkit2gtk-4.1-dev build-essential curl wget file
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`)

## Build & run

```bash
cd nisaba/desktop
npm install            # @tauri-apps/cli
npm run icons          # one-time: generate app icons from ../app/public/pwa-512.png
npm run dev            # dev window (hot-reload; runs ../app vite dev)
npm run build          # a .deb and .AppImage under src-tauri/target/release/bundle
```

On launch the window shows the app; because the service already holds your
Google session, tap **Connect Google Drive** once in Settings and it connects
instantly (it's just confirming the service link — no Google popup). Your notes
sync to Drive as usual.

## How auth works here (why it's built this way)

- Google **blocks its sign-in JS in embedded webviews**, so the in-window app
  can't do OAuth directly.
- Instead the **service** does the real browser-loopback OAuth (reusing the
  auth Worker) and holds the session. It exposes `GET /token` (bearer-guarded,
  localhost only) that returns a fresh Drive access token.
- The shell (`src-tauri/src/main.rs`) reads the bearer token from
  `~/.config/nisaba/service.json` and injects
  `window.__NISABA_SERVICE__ = { base, token }` before the page loads.
- The app's `lib/auth.js` sees that global and switches to "service mode":
  `getToken()` calls `GET /token`. No GIS in the webview.

Note: the window runs its own in-browser sync engine, and the service also
syncs — that's two replicas sharing one Drive, exactly like two devices, which
the conflict-copy engine already handles.

## Rough edges to finish on-device

- **Bundling the service** so end users don't need Node: currently the service
  runs separately (systemd/manual). To make the `.deb`/`.AppImage`
  self-contained, compile the service to a single binary (Node SEA or
  `bun build --compile`), add it under `tauri.conf.json > bundle > externalBin`,
  and launch it via the shell plugin *only if* `localhost:27125` isn't already
  answering (so it won't fight the systemd unit).
- **Service worker**: the app registers a PWA service worker; inside Tauri that
  registration may no-op or log — harmless, but can be disabled for the desktop
  build if noisy.
- **Icons**: `npm run icons` fills `src-tauri/icons/`. Build output and
  generated schemas are git-ignored (`src-tauri/target`, `src-tauri/gen`).
