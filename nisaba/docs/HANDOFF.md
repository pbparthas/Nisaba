# Nisaba — build handoff

For the next agent session continuing this project (written 2026-07-07 as the
prior session approached its limits). Read this file, docs/PLAN.md, and
docs/RESEARCH.md before writing code. The owner is pbparthas
(pbpsarathy@gmail.com); their primary device is an **Android phone** — they
often drive sessions from it, so keep instructions and UI phone-first.

## Working agreement with the owner (important)

- **Plan first.** Do not build features or change scope without presenting the
  plan and getting an explicit "go". This was a hard-learned rule in the prior
  session — the owner objected strongly when work started without approval.
- Ask via short mobile-friendly steps when the owner must do something manually
  (Google Console, GitHub settings); include direct deep links.
- Every phase must end with something the owner can try on their phone.
- Verify before pushing: unit tests + a real-browser check. Report results
  honestly.

## Current state (everything below is DONE and deployed)

- **Branch:** `claude/cross-platform-sync-app-wsoso4` in
  https://github.com/pbparthas/Nisaba (repo was renamed from `adhoc-projects`;
  session tooling may still know it by the old name — the GitHub MCP tools
  only accept `repo: adhoc-projects`, git remote redirects fine).
- **Live app:** https://pbparthas.github.io/Nisaba/ — deployed by
  `.github/workflows/deploy-pages.yml` on every push of `nisaba/**` to the
  branch above (builds with `NISABA_BASE=/Nisaba/`, runs tests first).
- **What works end-to-end on the owner's real phone + Google Drive:**
  sign-in (GIS token flow), notes with image attachments, tasks with due dates
  and **subtasks** (embedded checklist per task), per-item Drive sync with
  conflict copies, offline-capable local replica in IndexedDB.
- **Owner's OAuth Client ID** (public, baked into `app/src/App.jsx` as
  `DEFAULT_CLIENT_ID`):
  `652122307592-300cfvid9hl2s4t59hm9c4mivbtm3beq.apps.googleusercontent.com`
  Authorized origins: `https://pbparthas.github.io`, `http://localhost:5173`.
- **UNVERIFIED:** whether the owner completed "Publish app → In production" on
  the Google consent screen (Audience page). If still Testing, their sign-in
  dies every 7 days. **Ask them early.**

## Architecture (see docs/PLAN.md for the approved plan, RESEARCH.md for why)

```
nisaba/app                 React 19 + Vite PWA (no framework beyond React)
  src/lib/merge.js         resolveItem(): per-item LWW + conflict copies (notes only)
  src/lib/sync.js          engine: snapshot → pull changed → push dirty → attachments
  src/lib/drive.js         Drive v3 REST client, drive.file scope, injectable baseUrl
  src/lib/auth.js          GIS token client; ns_signed_in flag follows real tokens
  src/lib/store-idb.js     IndexedDB store; store-memory.js mirrors it for tests
  src/App.jsx              all UI (phase-1 level; BlockNote replaces note editor next)
  src/styles.css           cream "Golazo-inspired" theme (owner chose it; keep it)
  test/mock-drive.js       in-process mock of the Drive v3 surface (ESM)
  test/*.test.js           vitest: 19 cases (merge + two-device sync)
  test/e2e-*.cjs           Playwright browser tests (run with playwright-core,
                           executablePath /opt/pw-browsers/chromium, --no-sandbox)
```

Data: one JSON file per item in Drive (`Nisaba/items/<uuid>.json`), attachments
as real files (`attachments/<attId>__<name>`), `schema.json` guard
(SCHEMA_VERSION in drive.js — bump it and write a migration if the item format
changes incompatibly). Item shape: see `newItem()` in merge.js — includes
`subtasks: [{id,title,done}]`. Deletes are tombstones (`deleted: true`).
Never mount/watch the Drive copy; everything is explicit API round-trips.

Commands: `cd nisaba/app && npm install && npm test` (vitest),
`npm run dev` (:5173), `npx vite preview --port 4173` + `node test/e2e-drive.cjs`
(full two-device browser sync against the mock), `node test/e2e-subtasks.cjs`.

## Remaining phases (approved plan — do them in order)

### Phase 2 — Editor gate (BlockNote on the real phone) ← NEXT
1. `npm i @blocknote/core @blocknote/react @blocknote/mantine` (MPL-2.0 core
   only — do NOT add any `@blocknote/xl-*` package: GPL/paid).
2. Replace the note editor's `<textarea>` with BlockNote. Note `body` becomes
   BlockNote's JSON document (store as object in the item; bump nothing —
   schema tolerates it, but old plain-text bodies must migrate: on open, if
   `typeof body === 'string'`, convert via `tryParseMarkdownToBlocks` or wrap
   as one paragraph block).
3. Image paste/attach: wire BlockNote's `uploadFile` to the existing
   `store.putBlob` + attachment reference flow; resolve display URLs via
   `engine.ensureBlob` → object URLs.
4. Keep markdown export in mind (`blocksToMarkdownLossy`) — needed later for
   the REST/MCP API.
5. **Gate:** deploy behind done = owner tries it on their Android phone and
   approves the touch feel (slash menu, keyboard behavior, image paste).
   Watch bundle size (BlockNote is heavy; current app is 66 kB gz — expect
   ~300 kB+; acceptable, but lazy-load the editor chunk if first paint hurts).
   **Fallback (pre-agreed):** raw Tiptap v3 + copied Apache-2.0 slash-menu /
   bubble-menu components from https://github.com/steven-tey/novel.

### Phase 3 — Full PWA
- Service worker: app-shell caching, **network-first with cache fallback**
  (a cache-first SW served stale code in the prior session — don't repeat).
  vite-plugin-pwa is fine. Keep the sync engine in the page, NOT in the SW
  (SilverBullet's in-SW sync caused wake bugs — see RESEARCH.md).
- Task agenda view ("due today / overdue" grouping), search across items,
  surface conflict copies visibly, storage-usage indicator.
- Owner asked for: proper polish per the cream theme.

### Phase 4 — Linux desktop (Tauri) + API for Claude Code
- Tauri v2 wrapping the same built app.
- **Auth caveat:** Google blocks GIS in webviews. Create a second OAuth client
  of type **Desktop app** in the owner's Google project and use the loopback
  (127.0.0.1 + PKCE) flow from the Tauri shell; keep `src/lib/auth.js`'s
  interface and add a desktop implementation behind it.
- Local service on one localhost port (pick ~27125): Joplin-style REST nouns
  (`GET /ping` for discovery, `/notes`, `/tasks`, `/search`, `/attachments`)
  + **MCP endpoint at `/mcp`** (streamable HTTP, official
  @modelcontextprotocol/sdk) so `claude mcp add --transport http` works —
  the Obsidian Local REST API pattern. One bearer token shown in Settings.
  Publish an OpenAPI spec in the repo (Trilium ETAPI lesson).
- MCP tools: `search_notes, get_note, create_note, patch_note, list_tasks,
  query_tasks(due_before, state), add_task, complete_task, add_subtask,
  add_attachment`. Task queries are the differentiator.
- Verify by actually connecting Claude Code to it.

### Phase 5 — Enki adapter
- Enki is the owner's own tool; its protocol is STILL UNKNOWN. Ask the owner
  how Enki communicates before designing anything. It consumes the phase-4
  REST/MCP surface.

## UX status and direction (owner cares about this a lot)

The owner disliked the first UI pass and asked for proper polish. A v2 pass
shipped at the end of the prior session: inline SVG logo mark next to the
wordmark, quiet status pill instead of a giant connect button, tasks grouped
into Overdue / Today / Upcoming / Done with relative due labels ("tomorrow",
"3d late"), tap-to-edit task title/due date in the expanded panel, floating
＋ button for notes, last-edited stamps on note cards, friendlier empty
states. Reference the owner named: **Golazo** (goal-tracking app by WowMakers;
creamy background, white cards, playful) — its case-study page blocks fetching,
so the theme was built from description. If the owner shares screenshots of
UIs they like, match them. Likely next asks: better typography, subtle motion,
a real agenda/home view (phase 3), dark-mode toggle. Always send a screenshot
(Playwright, 420px viewport) with UI changes and expect iteration.

## Auth behavior (understand before touching)

Browser-only OAuth cannot mint refresh tokens; sessions ride on (a) a cached
access token in localStorage (≤1h) and (b) GIS silent refresh via the Google
session iframe. If both fail, the pill shows "tap to sync" and the Sign in
button calls requestAccessToken with prompt '' — Google then shows only what
it must. Do NOT switch the button back to prompt 'consent' (it forces the
full consent screen every time — this was the owner's "asks me to sign in
every time" complaint). If re-prompting is still reported: first verify the
consent screen is In production (Testing revokes weekly), then consider the
authorization-code flow — which needs a token-exchange backend and is a real
scope change to discuss with the owner.

## Pitfalls learned the hard way (do not re-learn these)

1. **Google consent screen in "Testing" kills refresh/silent tokens after 7
   days** — publishing to Production fixes it; `drive.file` needs no review.
2. **GIS silent tokens can succeed without the user tapping sign-in** — never
   derive UI auth state from a stored flag alone (fixed in auth.js; keep the
   invariant: flag follows actual token issuance).
3. **Android `<input type=date>` renders blank** — always label date fields
   (`.due-field` pattern in styles.css).
4. The sandbox proxy **blocks googleapis.com and github.io** — you cannot curl
   the live site or real Drive from the session; verify via the mock server,
   Playwright, and CI results instead.
5. **GitHub Pages on private repos needs a paid plan** — repo is now public;
   the deploy workflow needs Pages source = GitHub Actions (already set).
6. Session GitHub MCP tools are scoped to the **old repo name**
   (`adhoc-projects`); use it for API calls even though the repo is `Nisaba`.
7. mock-drive.js must honor the `fields` param semantics the client relies on
   (`version` in files.list responses) — a missing field silently broke change
   detection once.
8. A stop-hook in this environment demands **commit + push** before ending a
   turn with uncommitted changes.
9. Playwright: use `playwright-core` with
   `executablePath: '/opt/pw-browsers/chromium'` and `--no-sandbox`; never
   `playwright install`.
10. Deploys take ~60–90s; check the run via the GitHub Actions MCP tools
    before telling the owner to refresh.

## Conventions

- Commit style: imperative subject + a body explaining what/why; end with the
  session's Co-Authored-By/Claude-Session trailer block per environment rules.
- No TypeScript so far — plain JS + JSDoc-level clarity; match it.
- Keep everything in `nisaba/`; repo may gain sibling projects someday.
- The Drive folder must stay readable without the app (plain JSON, real image
  files) — that durability rule is part of the approved plan.
