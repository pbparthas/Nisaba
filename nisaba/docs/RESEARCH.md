# How others built their Notion/Obsidian — research synthesis

Studied July 2026, before finalizing the Nisaba plan. Three sweeps: Notion-family
clones (AppFlowy, AFFiNE, Outline, Docmost, SiYuan, Focalboard, Notea, Novel),
Obsidian-family apps (Logseq, SilverBullet, Zettlr, TriliumNext, Acreom, Foam,
Dendron, Flatnotes, Memos, Notable, Joplin), and the reusable building-block layer
(editors, CRDT/sync libraries, local API/MCP patterns).

## What everyone converged on

1. **Nobody hand-rolls an editor anymore — except products whose product IS the
   editor.** The TypeScript world converged on ProseMirror, almost always via
   Tiptap: Docmost, Outline, Novel, Acreom, Notesnook. The exceptions (AppFlowy,
   AFFiNE/BlockSuite, SiYuan/Protyle) each maintain an in-house editor at company
   scale. Forked editors rot fastest (Notea died on one; Outline archived its own
   extracted editor package).
2. **Blocks (typed JSON trees) at the storage layer, markdown only at the
   edges.** Every Notion-family survivor stores typed block trees and
   imports/exports markdown. Acreom shows the exact pattern for us: ProseMirror
   JSON in IndexedDB while editing, serialize to a portable format on save.
3. **For serverless multi-device sync, the survivors all use the same shape:**
   full local replica on every device + dumb remote file store + timestamp
   reconciliation + **conflict-copy-never-block** (Joplin's 10-year-hardened
   sync spec; SilverBullet's `.conflicted` copies). Nobody ships CRDTs for this
   in production; AFFiNE — the best-funded CRDT-everywhere attempt — is the one
   with sync-reliability complaints.
4. **Never let a file-sync layer touch live working data.** SiYuan hard-refuses
   to run its workspace inside a Dropbox/Drive folder (corruption) and instead
   syncs atomic snapshots with revision checks. Sync must be explicit API
   round-trips, which is what our Drive-API design already does.
5. **Local API: one localhost port, bearer token, published spec.** Logseq
   (`127.0.0.1:12315` JSON-RPC), Joplin (REST :41184 + `/ping` discovery),
   Trilium (ETAPI + OpenAPI spec → four independent MCP servers appeared
   unprompted), and the cleanest current pattern: Obsidian's Local REST API
   plugin, which now serves REST **and an MCP endpoint on the same port** —
   works directly with `claude mcp add --transport http`.
6. **Tasks live inline in notes, but a derived index powers the task views**
   (Logseq's Datalog, SilverBullet's object index, Acreom's "My Day"). The
   portable text carries the task; the app maintains a queryable index; the
   Obsidian Tasks emoji format (`- [ ] thing 📅 2026-07-07`) is the de-facto
   interchange format for export.

## Graveyard lessons (why the dead ones died)

- **Notea** (S3-as-backend, closest to our design — archived): solo maintainer
  stopped using his own tool; editor was a fork he couldn't keep current. The
  *architecture* was fine. Mitigations: maintained upstream libraries only, and
  a data format readable without the app.
- **Dendron** (VC-funded, archived): no product-market fit in PKM + burnout; the
  codebase was too complex for volunteers to inherit. **Trilium** is the
  counter-example: simple self-contained app survived its maintainer via fork.
- **Notable** (closed source, stalled 2020): "popularity first, sustainability
  later" strands users. Keep scope hobby-sized; keep data dumb.
- **Logseq** (living cautionary tale): let a derived index become load-bearing
  until plain-text files couldn't scale, forcing a community-splitting DB
  rewrite. Decide source-of-truth vs derived-index up front; never let the
  index carry correctness.

## What Nisaba takes, concretely

| Layer | Adopt | From |
|---|---|---|
| Editor | BlockNote core (MPL-2.0; skip GPL/paid `xl-*`), Tiptap v3 + Novel's Apache-2.0 components as documented fallback | building-blocks ranking; Docmost/Novel validation |
| Editing↔storage | ProseMirror JSON while editing; portable JSON blocks on save; markdown (Tasks-emoji format) on export | Acreom |
| Sync protocol | Per-item JSON files in Drive + timestamp reconciliation + conflict copies (never silent whole-note LWW) + lock file for schema migrations | Joplin sync spec |
| Sync hygiene | Atomic uploads with Drive revision preconditions; local snapshot before each sync; never mount/watch the Drive copy | SiYuan |
| PWA architecture | Single mode: full IndexedDB replica + background sync; service worker caches app shell only (their in-SW sync engine caused wake/reload bugs — run ours in the page) | SilverBullet v2 |
| Tasks | Typed task blocks inside notes + separate quick tasks; derived task index powers agenda/API queries | Logseq / SilverBullet / Acreom |
| Desktop API | One localhost port: REST (Joplin-style nouns) + MCP endpoint, bearer token, published OpenAPI spec | Obsidian Local REST API + Trilium ETAPI |
| MCP tools | `search_notes, get_note, create_note, patch_note, list/query_tasks(due, state), complete_task, add_attachment` — task queries are what generic note MCPs lack | joplin-mcp / mcp-obsidian tool surveys |
| Upgrade path (not v1) | Per-note Yjs update blobs over Drive (per-device write ownership, `Y.mergeUpdates`) if intra-note merging ever matters — BlockNote already speaks Yjs | Yjs author guidance; tonsky's crdt-filesync |

## Explicitly rejected

- **BlockSuite / AppFlowy-Collab** as data layer: drags a full CRDT worldview
  and unstable or foreign-runtime APIs into a single-user app.
- **CRDT-everywhere** (AFFiNE model): failure surface without payoff at our scale.
- **remoteStorage.js**: maintained, but Drive is its second-class backend and it
  imposes its own folder/widget model.
- **Single monolithic items.json**: maximally conflict-prone shape — any two
  offline devices conflict on everything (superseded by per-item files).
- **Adopting a full existing app** (Joplin closest): no Google Drive target, no
  PWA, classic UI; we take its sync spec instead.

Full per-project write-ups with sources live in the session research reports;
key references: Joplin sync spec (joplinapp.org/help/dev/spec/sync/), SiYuan
sync design (github.com/siyuan-note/siyuan), SilverBullet architecture
(silverbullet.md/Architecture), Acreom internals (deepwiki.com/Acreom/app),
BlockNote (blocknotejs.org), Novel (github.com/steven-tey/novel), Trilium ETAPI
(docs.triliumnotes.org), Obsidian Local REST API
(github.com/coddingtonbear/obsidian-local-rest-api).
