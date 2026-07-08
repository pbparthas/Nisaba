# Code & security review — findings for Opus to action

> **Resolution (actioned 2026-07-08).** All findings addressed. App 20/20 and
> service 17/17 still green.
> - **M1** — Worker rejects POSTs whose `Origin` is present but not allowlisted
>   (403); no-Origin non-browser requests (desktop service) still pass.
> - **M2** — corrected `NISABA_HOST` guidance everywhere (comment, `install.sh`,
>   README): bind the tailnet IP for a dedicated host, or `0.0.0.0` **only**
>   behind a `tailscale0` firewall rule; never blanket `0.0.0.0`.
> - **L1** — token printed only when freshly generated (or `NISABA_DEBUG`).
> - **L2** — Worker error responses drop `detail` (logged server-side). Desktop
>   `auth-worker.js` detail kept: user's own machine, no secret, aids debugging.
> - **L3** — `corsHeaders` omits `Access-Control-Allow-Origin` on mismatch.
> - **L4** — `find_sidecar` matches exact names (via `build.rs` `TARGET`), no
>   prefix scan.
> - **L5** — `/exchange` always mints a fresh session id (carries the refresh
>   token forward, deletes the old session).
> - **L6** — `js_string` escapes `\n \r U+2028 U+2029` too.
> - **Doc nits** — HANDOFF architecture block refreshed.
>
> The Worker change needs `npx wrangler deploy` (owner) to go live.
> **Deployed by the owner 2026-07-08 — review closed, nothing outstanding.**

---

Reviewed branch `claude/handoff-doc-review-1enmyx` (Phases 1–4 + redesign).
Independent review of the app PWA and the new backend (Cloudflare auth Worker,
local REST/MCP service, Tauri desktop shell). Verdict: **solid, no critical or
high issues.** Both test suites pass (app 20/20, service 17/17). Secrets are
contained (client_secret + refresh tokens never leak to browser/logs/URLs);
OAuth PKCE + state are correct; the conflict-copy fix is right; the service
worker is correctly network-first; deps are clean (BlockNote MPL core, no
GPL `xl-*`).

Action the items below in roughly this order. Each is verified against the code.

## MEDIUM — fix these

### M1. CSRF on the auth Worker's state-changing routes
`nisaba/worker/src/index.js` — `/revoke` (:120) and `/refresh` (:103); cookie
set at :52. The session cookie is `SameSite=None` (required for the
app→auth cross-subdomain design), and the Worker never rejects on `Origin`.
`/revoke` is a CORS "simple request" (no body, no custom headers), so any site
the owner visits while signed in can POST to it with `credentials:'include'`
and silently revoke the Google refresh token → forced re-consent (availability
hit; not data theft, since the response is unreadable cross-origin).
**Fix:** at the top of the handler, reject state-changing POSTs whose `Origin`
is not in `ALLOWED_ORIGINS` (return 403). Keep `/exchange` working for the
popup flow (its Origin is the app origin, which is allowlisted). Optionally add
a double-submit CSRF token. Do NOT try to tighten SameSite — the design needs
None.

### M2. `NISABA_HOST=0.0.0.0` binds every interface, not just the tailnet
`nisaba/service/src/main.js:27` (+ listen at :78); docs in
`service/README.md` (Tailscale section). The comment says this exposes the
service "on the Tailscale interface," but `0.0.0.0` binds all interfaces
including untrusted LAN/Wi-Fi, and `/ping` is unauthenticated.
**Fix:** bind to the specific Tailscale IP (e.g. read the tailscale0 address,
or require the user to pass the exact IP as `NISABA_HOST`), and correct the
README to say "bind to your tailnet IP, never 0.0.0.0 on untrusted networks."
Everything but `/ping` still needs the bearer token, so this is exposure/recon,
but the guidance understates the blast radius.

## LOW — hygiene, fix if quick

### L1. Bearer token printed to stdout on startup
`nisaba/service/src/main.js:93` prints the full `Authorization: Bearer <token>`
line. Under the systemd user unit this lands in `journalctl --user`.
**Fix:** print the token only on first generation (or behind `NISABA_DEBUG`);
otherwise print "token loaded from ~/.config/nisaba/service.json" and the
`claude mcp add` command without the literal secret.

### L2. Error responses echo upstream/exception detail
`worker/src/index.js:88,112,137` (`detail: data` / `detail: String(e)`) and
`service/src/auth-worker.js:60-66`. No secret is interpolated (verified), so
minor info disclosure only. **Fix:** log detail server-side; return a generic
error code to the client.

### L3. Worker CORS falls back to `allowed[0]` on origin mismatch
`worker/src/index.js:22-31`. Confirmed NOT exploitable for credentialed reads
(browsers require exact-origin ACAO), but it's what lets the M1 CSRF requests
reach the handler and is confusing. **Fix:** on origin mismatch, omit
`Access-Control-Allow-Origin` entirely rather than emitting a fixed origin.

### L4. Desktop `find_sidecar` runs first sibling prefixed `nisaba-service`
`desktop/src-tauri/src/main.rs:64-77,87` picks an unordered `read_dir` match.
Needs write access to the (normally privileged) install dir, so low.
**Fix:** match the exact expected binary name(s), not a prefix scan.

### L5. Session reuse in `/exchange` (session fixation)
`worker/src/index.js:90` reuses an existing `ns_session` cookie value when
minting a new refresh token. Contingent on an attacker controlling a sibling
`*.orionforge.dev` subdomain to plant the cookie, so low. **Fix:** always mint
a fresh session id on `/exchange` (`const sid = newSessionId()`), never reuse
the inbound cookie.

### L6. `js_string` escaping is incomplete
`desktop/src-tauri/src/main.rs:52-54`. Escapes `\` and `"` but not newlines /
U+2028 / U+2029. NOT currently exploitable (token is base64url, base is a fixed
localhost URL), but it's a latent script-injection vector if either input's
charset ever loosens. **Fix:** escape `\n`, `\r`, ` `, ` ` too, or
serialize via `serde_json::to_string`.

## Confirmed SAFE (do not "fix"; noting so they aren't re-flagged)
- File store path traversal: `encodeURIComponent` encodes `/`, ids stay inside
  the dir. Safe.
- Service bearer check: length-guarded `crypto.timingSafeEqual`, 192-bit token.
  Correct.
- `/oauth/callback` reflected text: served as `text/plain`, inert — not XSS.
- `isAllowedRedirect`: fully anchored, no open redirect.
- PWA: no `innerHTML`/`dangerouslySetInnerHTML`/`eval`, no `message` listeners,
  no tokens in URLs. Backend-mode access token is memory-only.
- Service `ACAO:'*'` + bearer: data routes need the Authorization header a
  cross-origin page can't supply; only `/ping` is exposed.

## Doc nits in HANDOFF.md (stale after Phases 2–4 + redesign)
The "Architecture" block (lines ~85-88) still reads as phase-1: `src/App.jsx
"phase-1 level; BlockNote replaces note editor next"`, `src/styles.css "cream
Golazo-inspired theme"` (it's now Reed Green), and `test/*.test.js "19 cases"`
(now 20 app + 17 service). Refresh those three lines.
