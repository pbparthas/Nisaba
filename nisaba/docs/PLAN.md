# Nisaba (formerly NoteSync) — proposed plan (v2, post-research)

Status: **awaiting approval.** Supersedes the pre-research plan; changes driven
by docs/RESEARCH.md.

## Requirements (locked by earlier discussion)

- Personal notes + tasks app; images/screenshots as first-class attachments.
- Mobile: installable PWA. Desktop: Linux app (Tauri) exposing an API Claude
  Code can wire into directly (MCP). Enki (owner's own tool) connects too.
- One Google login on both devices; sync through the user's own Google Drive
  (JSON + attachment files); no server of ours.
- Notion-style editing UX.

## Architecture

```
┌ mobile PWA ──────────────┐      ┌ Linux desktop (Tauri) ────────────┐
│ React + BlockNote        │      │ same React UI                     │
│ IndexedDB full replica   │      │ + localhost service:              │
│ sync engine (in page)    │      │   REST /notes /tasks /search …    │
└──────────┬───────────────┘      │   MCP endpoint /mcp (Claude Code) │
           │                      └──────────┬────────────────────────┘
           └────────── Google Drive API ─────┘
                    Nisaba/ in user's Drive:
                      manifest.json, items/<id>.json,
                      attachments/<attId>__<name>, locks
```

## Key decisions (changed vs v1 are marked ★)

1. **Editor: BlockNote core** (MPL-2.0 only — no `xl-*` packages). Documents are
   ProseMirror/BlockNote JSON block trees in IndexedDB while editing (Acreom
   pattern), portable JSON on save, Obsidian-Tasks-emoji markdown on export.
   ★ Fallback documented up front: raw Tiptap v3 + Novel's Apache-2.0
   slash-menu/bubble-menu components, if BlockNote's bundle size or
   experimental mobile toolbar fails the phone test.
2. ★ **Sync: Joplin-style per-item files, not one items.json.** Each note/task
   is `items/<uuid>.json` in Drive; reconciliation by `updated_at`; a true
   concurrent edit produces a visible **conflict copy** (never silent
   whole-note last-write-wins, never blocks sync); `lock.json` guards schema
   migrations; atomic uploads with revision preconditions; local snapshot
   before each sync (SiYuan discipline). The existing merge/sync engine and
   mock-Drive test suite carry over with the storage layout swapped.
3. ★ **Tasks: two entry points, one index.** Quick tasks (top-level items, due
   dates, recurrence later) plus checkbox/task blocks inside notes; a derived
   task index (rebuilt from items, never source of truth — Logseq lesson)
   powers the agenda view and task queries in the API.
4. **PWA: single mode** — full local replica + background sync in the page
   (service worker for app-shell caching only; SilverBullet's in-SW sync engine
   caused wake bugs). No account needed for local-only use.
5. ★ **Desktop API: one localhost port** serving Joplin-style REST nouns
   (`/ping` discovery, `/notes`, `/tasks`, `/search`, `/attachments`) **and** an
   MCP endpoint at `/mcp` (streamable HTTP — `claude mcp add --transport http`),
   one bearer token shown in Settings, **OpenAPI spec published in the repo**
   (Trilium's ETAPI lesson: a spec makes third-party/AI integrations appear).
   MCP tools include task queries (`query_tasks(due_before, state)`) — the gap
   in every generic note MCP. Enki uses the same REST surface.
6. **Auth/Drive**: GIS token flow in the PWA, loopback OAuth in Tauri, both
   behind one auth interface; `drive.file` scope only; consent screen published
   to Production (avoids 7-day token expiry).
7. **Data longevity rule** (graveyard lesson): everything in Drive stays
   readable without the app — plain JSON, real image files, exportable to
   markdown. App death must cost nothing.

## Phases (each ends with something to try)

1. **Drive sync core** — rework the parked spike to per-item files + conflict
   copies + snapshots; your one-time Google OAuth setup (guide provided; you
   paste the public Client ID); prove phone-browser ↔ desktop-browser sync on
   real Drive.
2. **Editor gate** ★ — minimal BlockNote build on the real phone first: touch
   feel, slash menu, image paste, bundle size. Pass → proceed; fail → switch to
   the Tiptap fallback before any UI investment.
3. **Mobile PWA** — full app: BlockNote notes with attachments, tasks + agenda,
   offline, installable, deployed to GitHub Pages.
4. **Linux desktop** — Tauri shell + localhost REST+MCP service; verified by
   driving it from a live Claude Code session.
5. **Enki adapter** — against the published OpenAPI spec, once its protocol is
   described.

## Open questions

- Enki's actual protocol (phase 5 input).
- Recurrence for tasks in v1 or later? (Research favors Logseq-style repeaters
  later; v1 = due dates only.)
