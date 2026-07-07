# Nisaba

Personal notes + tasks with Notion-style editing, on your phone and your Linux
desktop, syncing through **your own Google Drive** — no server, no accounts
except your existing Google login. Named for the Sumerian goddess of writing;
built to talk to Enki.

**Status: phase 1 (Drive sync core) — see [docs/PLAN.md](docs/PLAN.md).**

## How it works

- Every device keeps a **full local copy** in the browser's IndexedDB — the
  app is instant and fully usable offline.
- A background sync engine reconciles with a `Nisaba/` folder in your Drive:
  **one JSON file per note/task** plus attachments as ordinary image files.
  Concurrent offline edits to the *same note* never lose data — the older
  version is kept as a visible "(conflict copy)". A schema guard file stops
  outdated app versions from corrupting newer data.
- Mobile is an installable PWA; desktop will be a Tauri app exposing a
  localhost REST + MCP API for Claude Code and Enki (phase 4).
- The Drive folder is readable without the app: plain JSON, real files.

Design rationale and the study of prior art (Joplin's sync spec, SiYuan's
snapshot discipline, SilverBullet's PWA architecture, the Notion-clone
graveyard) live in [docs/RESEARCH.md](docs/RESEARCH.md).

## Run it

```bash
cd nisaba/app
npm install
npm run dev        # http://localhost:5173
npm test           # merge + two-device sync suites against a mock Drive
```

First run asks for a Google OAuth Client ID — the one-time, ~15-minute setup
is documented click-by-click in [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

## Layout

```
app/src/lib/merge.js      per-item conflict resolution (conflict copies)
app/src/lib/sync.js       sync engine: snapshot → pull → push → attachments
app/src/lib/drive.js      Google Drive v3 client (drive.file scope only)
app/src/lib/auth.js       Google Identity Services token flow
app/src/lib/store-idb.js  IndexedDB store (store-memory.js mirrors it for tests)
app/src/App.jsx           phase-1 UI (BlockNote lands in phase 3)
app/test/                 vitest suites + in-process mock Drive server
docs/                     PLAN.md · RESEARCH.md · GOOGLE_SETUP.md
```
