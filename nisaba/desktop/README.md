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

**UI updates automatically.** A release build loads the deployed web app
(`https://nisaba.orionforge.dev`), so every web deploy updates the desktop app
too — no rebuild needed for frontend changes. You only rebuild the `.deb` when
the Rust shell (`main.rs`) changes. Dev builds load the local vite server
(`http://localhost:5173`) so local edits hot-reload; override either with
`NISABA_APP_URL`. (Trade-off: the window needs a network to load the first time;
the app's service worker caches it for offline use after that.)

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

## Self-contained build (bundled service)

`npm run dev` / `npm run build` produce an app that **connects to a service you
run separately** (systemd/manual) — good for the owner's setup.

To ship a **self-contained** `.deb`/`.AppImage` that needs no separate Node or
service (for distributing to others), bundle the service as a sidecar:

```bash
# one-time: install Bun (compiles the service to a single binary)
curl -fsSL https://bun.sh/install | bash
cd nisaba/desktop
npm run build:bundled      # compiles the sidecar, then builds with it bundled
```

`build:bundled` runs `scripts/build-sidecar.sh` (Bun compiles
`../service/src/main.js` → `src-tauri/binaries/nisaba-service-<triple>`) then
`tauri build --config src-tauri/tauri.bundle.conf.json`, which adds the sidecar
via `externalBin`. At runtime the shell (`main.rs`) starts the bundled service
**only if** nothing is already answering on the port — so on a machine that
already runs the systemd unit, it just connects; on a fresh machine it launches
the bundled copy, which does its own first-run Google sign-in in the browser.

## Rough edges to finish on-device
- **Service worker**: the app registers a PWA service worker; inside Tauri that
  registration may no-op or log — harmless, but can be disabled for the desktop
  build if noisy.
- **Icons**: `npm run icons` fills `src-tauri/icons/`. Build output and
  generated schemas are git-ignored (`src-tauri/target`, `src-tauri/gen`).
