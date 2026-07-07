# NoteSync

Local-first notes and tasks that sync between your phone and desktop through a
login. Works fully offline; when you're signed in and online, every device
converges to the same state. External tools (e.g. **Enki**) can read and write
your data through a token-authenticated REST API.

## How it works

- **One codebase, every device.** The client is a Progressive Web App: open it
  in a browser on desktop, or "Add to Home Screen" on iOS/Android and it
  installs like a native app with its own icon and standalone window.
- **Local-first.** All data lives in the browser's IndexedDB. Creating and
  editing notes/tasks never waits on the network — the app is fully usable
  offline (a service worker caches the app shell too).
- **Sync via login.** Sign in with the same email/password on each device.
  A background sync engine pushes local changes and pulls remote ones
  (on edit, on reconnect, and every 30s). Conflicts resolve last-write-wins.
- **Server.** A small Node/Express + SQLite server handles accounts (bcrypt +
  JWT), the delta-sync protocol, and the integration API. It also serves the
  PWA, so the whole thing is one process.

```
phone (PWA/IndexedDB) ─┐
                       ├── HTTPS ──> Node + SQLite (accounts, sync, API)
desktop (PWA)  ────────┘                 ▲
                                         └── Bearer nsk_… tokens (Enki, scripts)
```

## Quick start

```bash
cd notesync
npm install
npm start          # http://localhost:3000
```

Open the URL, use the app immediately (no account needed), and hit **Sign in →
Create account** when you want cross-device sync.

To reach it from your phone, host the server anywhere with HTTPS (service
workers and PWA install require a secure origin; `localhost` is exempt for
development). Any small VPS, Fly.io, Railway, or a home server behind a
Tailscale/Caddy HTTPS proxy works — it's a single Node process with a SQLite
file (set `NOTESYNC_DATA_DIR` to control where data lives, `PORT` for the port).

## Connecting Enki (or anything else)

1. Sign in, open the account panel, and create an API token (shown once).
2. Call the REST API with `Authorization: Bearer nsk_…`:

| Method & path          | Description                                        |
|------------------------|----------------------------------------------------|
| `GET /api/ext/notes`   | List notes                                         |
| `POST /api/ext/notes`  | Create note `{title, body, tags}`                  |
| `GET /api/ext/tasks`   | List tasks                                         |
| `POST /api/ext/tasks`  | Create task `{title, due, tags}`                   |
| `PATCH /api/ext/items/:id` | Partial update `{title?, body?, done?, due?, tags?}` |
| `DELETE /api/ext/items/:id` | Delete an item                                |

Writes made through this API sync to all devices like any other edit.

```bash
curl -X POST https://your-host/api/ext/tasks \
  -H "Authorization: Bearer nsk_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Review Enki deck", "due": "2026-07-08"}'
```

## Sync protocol (for the curious)

`POST /api/sync` with `{since, changes[]}` under a session JWT. The server
applies each change with last-write-wins on `updated_at`, assigns each accepted
write a per-user monotonically increasing `seq`, and returns every row with
`seq > since` plus the new cursor. Deletes are tombstones (`deleted: true`), so
they propagate like any other change. The client keeps a `dirty` flag per item
and only clears it when a push round-trips without a newer local edit.

## Layout

```
server/index.js         Express app: static PWA + API mounting
server/db.js            SQLite schema, JWT secret, per-user seq counter
server/auth.js          register/login, JWT sessions, API-token management
server/sync.js          delta-sync endpoint (LWW conflict resolution)
server/integrations.js  token-authenticated REST API for external tools
public/                 the PWA (no build step): store.js (IndexedDB),
                        sync.js (sync engine), app.js (UI), sw.js, manifest
```
