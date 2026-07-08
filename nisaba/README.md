# Nisaba

Personal **notes + tasks** with Notion-style editing, on your phone and your
Linux desktop, syncing through **your own Google Drive** — no server of ours, no
account except your existing Google login. Named for the Sumerian goddess of
writing.

**Live:** [nisaba.orionforge.dev](https://nisaba.orionforge.dev) · installable
PWA · Linux desktop app · optional Claude Code integration.

## What it is

- **Your data, your Drive.** Every note/task is one JSON file in a `Nisaba/`
  folder in *your* Google Drive; attachments are ordinary image files. It stays
  readable without the app, and nothing of yours ever passes through a server we
  run.
- **Offline-first.** Each device keeps a full local replica (IndexedDB in the
  PWA; a plain-file store on the desktop). A background sync engine reconciles
  per item; a true concurrent edit to the same note is preserved as a visible
  "(conflict copy)" rather than silently lost.
- **Rich editor.** BlockNote (slash menu, formatting, image paste → Drive
  attachments). Choose the note font, size, weight, style and ink, and a
  per-note background colour, in Settings.
- **Tasks with agenda.** Due dates, subtasks, and overdue / today / upcoming
  grouping; search across everything; multi-select delete.
- **Persistent login.** A tiny Cloudflare Worker holds the refresh token, so you
  sign in once and stay signed in (no hourly Google prompt).
- **Claude Code integration.** A local service exposes your notes & tasks over
  REST + MCP, so Claude Code can read and write them (task queries included).

Status: **Phases 1–4 + the visual redesign are done and running.** The only
remaining phase is the Enki adapter (blocked on its protocol).

## Repository layout

```
nisaba/
  app/        React 19 + Vite PWA (BlockNote editor, IndexedDB, sync engine)
  worker/     Cloudflare Worker — auth broker (holds the refresh token in KV)
  service/    Node service — REST + MCP over localhost for Claude Code
  desktop/    Tauri v2 shell — the app in a native Linux window
  docs/       GOOGLE_SETUP.md (one-time OAuth setup)
```

Each component has its own README with setup and details:
[`worker/`](worker/README.md) · [`service/`](service/README.md) ·
[`desktop/`](desktop/README.md).

## Run the app (PWA)

```bash
cd nisaba/app
npm install
npm run dev        # http://localhost:5173
npm test           # merge + two-device sync suites against a mock Drive
npm run build      # production build (also what GitHub Pages deploys)
```

First run needs a Google OAuth Client ID — the one-time, ~15-minute setup is
documented click-by-click in [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

## The pieces (optional, for the full setup)

- **Persistent login** — deploy the Worker: `cd nisaba/worker && npm install &&
  npx wrangler deploy` (see [worker/README.md](worker/README.md)). The app
  defaults to using it at `auth.orionforge.dev`.
- **Claude Code** — run the service: `cd nisaba/service && node src/main.js`,
  then `claude mcp add nisaba --transport http http://localhost:27125/mcp
  --header "Authorization: Bearer <token>"`. Always-on via the included systemd
  unit. Full guide + OpenAPI spec in [service/README.md](service/README.md).
- **Linux desktop app** — `cd nisaba/desktop && npm install && npm run build`,
  then install the `.deb`. See [desktop/README.md](desktop/README.md).

## Architecture notes

- **Auth** has three modes behind one interface (`app/src/lib/auth.js`): the
  Worker backend (default), a plain GIS token flow, and a desktop "service mode"
  that pulls Drive tokens from the local service (the desktop webview can't run
  Google's sign-in JS).
- **Sync** (`app/src/lib/sync.js`) is Joplin-style per-item files with snapshots
  and md5-keyed change detection; the *same* engine backs the PWA, the service,
  and the desktop app.
- **Durability rule:** everything in Drive stays plain JSON + real image files,
  so the data outlives the app.

## Tech

React 19 · Vite · BlockNote (MPL-2.0 core) · vite-plugin-pwa (Workbox) ·
Google Drive v3 (`drive.file` scope) · Cloudflare Workers · Node (zero-dep
service) · Tauri v2. Self-hosted fonts via `@fontsource`.
