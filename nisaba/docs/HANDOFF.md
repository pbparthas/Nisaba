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
- **Consent screen: In production** (confirmed by the owner 2026-07-08) — so
  sign-in no longer dies every 7 days. `drive.file` needs no verification.

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

### Phase 4 — Linux desktop (Tauri) + API for Claude Code  ← SERVICE SHIPPED
**The local service is built and tested** in `nisaba/service/` (16 vitest cases
green against the app's mock Drive + a live boot smoke test). It runs standalone
today — `cd nisaba/service && node src/main.js` — no Tauri needed to connect
Claude Code. What it is:
- Zero-dependency Node service on one localhost port (default **27125**).
- **REST** (Joplin nouns): `/ping` (unauth discovery), `/notes`, `/notes/:id`,
  `/tasks`, `/tasks/query`, `/tasks/:id/complete`, `/tasks/:id/subtasks`,
  `/items/:id/attachments`, `/search`, `/sync`. OpenAPI at
  `service/openapi.yaml`.
- **MCP** at `POST /mcp` (JSON-RPC 2.0, streamable HTTP) — implemented
  dependency-free rather than via the SDK (matches the Worker; smaller supply
  chain). 11 tools incl. `query_tasks(due_before, due_after, state)` — the
  differentiator. Connect with `claude mcp add nisaba --transport http
  http://localhost:27125/mcp --header "Authorization: Bearer <token>"`.
- **One bearer token** guards everything but `/ping`; auto-generated on first
  run into `~/.config/nisaba/service.json` and printed on startup.
- **Reuses the exact app engine** (`app/src/lib/{merge,sync,drive,notebody}.js`)
  via a new file-backed store (`service/src/store-file.js`) — durable plain-JSON
  local replica, same as Drive.
- **Auth reuses the deployed Worker** (owner's choice) instead of a 2nd OAuth
  client: browser-loopback + PKCE → Worker `/exchange` (extended to accept a
  `redirect_uri`/`code_verifier`; **owner must `wrangler deploy` the worker
  again** and add `http://localhost:27125/oauth/callback` as an Authorized
  redirect URI on the existing Web OAuth client). Refresh token stays in
  Cloudflare KV; only a session cookie sits on disk.

**Remaining for Phase 4 (on the owner's Linux box — can't compile Tauri in the
cloud sandbox):** `nisaba/desktop/` has a Tauri v2 scaffold that wraps the built
web app and spawns the service. To finish: `cargo`/Tauri prereqs, `npm run
icons`, `npm run build`; package the service as a Tauri sidecar (Node SEA or
`bun build --compile`) so end users don't need Node; verify the live
`claude mcp add` connect. See `service/README.md` and `desktop/README.md`.
- **Setup guide + steps:** `nisaba/service/README.md`.

### Phase 5 — Enki adapter
- Enki is the owner's own tool; its protocol is STILL UNKNOWN. Ask the owner
  how Enki communicates before designing anything. It consumes the phase-4
  REST/MCP surface.

## DESIGN BRIEF — full visual redesign required (owner's explicit request)

Two UI passes shipped (dark spike, then a cream theme with orange accent,
logo mark, task sections, inline editing). The owner reviewed v2 on their
Android phone and rejected it: **"very shoddy"**. This redesign is the
top-priority task alongside phase 2, and the owner expects it done properly.

### The owner's verdict on v2, verbatim themes

1. **"Orange is not the color."** Drop the orange accent entirely.
2. **"Logo and text can be even better."** The rounded-square tablet glyph +
   plain bold system-font "Nisaba" wordmark are weak.
3. **"The placement of the fields looks like some very basic web page."**
   The UI reads as stacked HTML form controls, not a designed app.

### What specifically looks wrong (from the owner's screenshot of the Tasks tab)

- Add-task row = three mismatched bordered boxes (text input / "DUE DATE"
  dropdown / Add pill) sitting in a row like a web form.
- Expanding a task shows the title AGAIN as a bordered input directly under
  the task's own header — duplicated text, obviously a form field.
- Bordered rounded input boxes everywhere; ALL-CAPS field captions ("DUE
  DATE"); a lonely outlined "Delete task" pill at the card's bottom-left;
  stray ✕ icons right-aligned per subtask; header status pill + "Sign out"
  text link feel bolted on. Everything is boxes-in-boxes.

### Redesign direction (agree the direction with the owner BEFORE building)

- **Palette:** keep the creamy-white canvas (owner chose it; Golazo
  reference), replace orange with a calmer accent — mock 2–3 options (e.g.
  deep forest green, ink/charcoal with a warm neutral, muted terracotta-free
  alternatives) as rendered screenshots and let the owner pick via
  AskUserQuestion. Do not ship a palette the owner hasn't seen.
- **Kill the web-form look:** edit-in-place text (no visible input borders
  until focus), due date as a small tappable chip that opens the native
  picker (not a captioned dropdown box), a single "+ Add task" affordance
  instead of the three-box row, subtask add as a ghost row ("+ Add item"),
  delete via an overflow/long-press action rather than a standing button,
  no ALL-CAPS labels.
- **Task card anatomy:** expanded view should feel like the same card
  deepening (title stays a heading, tap it to edit in place; metadata as
  chips under it) — never a second copy of the title in a box.
- **Typography:** bundle a proper typeface (self-hosted; e.g. Manrope or
  Inter for UI + something characterful for the wordmark) with a real scale;
  system-font-bold everywhere is part of the "shoddy" read.
- **Logo:** design a proper mark — Nisaba is the Sumerian goddess of writing
  (clay tablet / reed stylus / grain motifs are on-theme). Deliver as: header
  mark + wordmark lockup, favicon, and maskable 192/512 PNG icons for the
  Android install prompt (current SVG-only manifest icon is also weak there).
- **Quality bar:** Things 3 / Todoist-level finish. The owner reviews on a
  ~420px Android screen; ship every iteration as a Playwright screenshot at
  that width and expect several rounds of specific feedback.

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
