# Nisaba desktop service (REST + MCP)

A tiny local server that exposes your Nisaba notes & tasks on one localhost port
so **Claude Code** (and Enki, later) can read and write them. It runs the *same*
Google-Drive sync engine as the app, so everything it serves is your own Drive
data — nothing new stores your notes.

- **REST** — Joplin-style nouns (`/notes`, `/tasks`, `/tasks/query`, `/search`,
  `/attachments`, …). Spec in [`openapi.yaml`](./openapi.yaml).
- **MCP** — `POST /mcp` (JSON-RPC 2.0, streamable HTTP) with tools including
  `query_tasks(due_before, state)` — the agenda query generic note servers lack.
- **Auth** — reuses the deployed auth Worker (`auth.orionforge.dev`); the refresh
  token stays in Cloudflare, never on disk here. One bearer token guards the
  local API.
- Zero runtime dependencies. Node ≥ 18 (developed on 22).

It works **standalone today** (`node src/main.js`) — you don't need the Tauri
desktop app to use it.

## One-time setup (owner)

Two small manual steps, because the desktop uses a browser-loopback sign-in:

### 1. Add the loopback redirect URI to your OAuth client
Google Cloud Console → **APIs & Services → Credentials** → your **Web
application** OAuth client → **Authorized redirect URIs** → **Add URI**:

```
http://localhost:27125/oauth/callback
```

Save. (If you change `NISABA_PORT`, register that port instead.)

### 2. Redeploy the Worker with the loopback-aware `/exchange`
The Worker now accepts the desktop's `redirect_uri` + PKCE verifier. From
`nisaba/worker`:

```bash
npx wrangler deploy
```

No secret changes — this is just the code update in `worker/src/index.js`.

## Run it

```bash
cd nisaba/service
node src/main.js
```

First run opens your browser to connect Google Drive, then prints your local
bearer token and the exact command to connect Claude Code:

```
claude mcp add nisaba --transport http http://localhost:27125/mcp \
  --header "Authorization: Bearer <TOKEN>"
```

Paste that into a terminal where you use Claude Code. Then, in a session:

> “Using the nisaba tools, what tasks are due before Friday?”

Claude will call `query_tasks` and answer from your real tasks.

### Quick checks
```bash
curl http://localhost:27125/ping                                  # discovery (no auth)
curl -H "Authorization: Bearer $TOKEN" http://localhost:27125/tasks
curl -H "Authorization: Bearer $TOKEN" "http://localhost:27125/tasks/query?due_before=2026-08-01"
```

### Sign out
```bash
node src/main.js sign-out      # revokes the Worker session and clears the local cookie
```

### Always-on (optional, laptop)
To have it running whenever you use Claude Code on this machine, install it as a
systemd **user** service (starts on login, restarts on crash). Sign in once
interactively first (so the session exists), then:
```bash
bash systemd/install.sh          # install + enable + start
bash systemd/install.sh remove   # undo
```
The API stays on localhost — it is only reachable from this laptop, not your
phone. Making it reachable from mobile Claude means putting it behind a network
(Tailscale/VPN) or deploying it to a server — a separate security decision.

### Reach it from your phone (Tailscale)
So mobile Claude can use the `nisaba` tools, put both devices on one private
[Tailscale](https://tailscale.com) tailnet and have the service listen on that
interface. Your laptop stays the host — nothing is exposed to the public
internet.

1. **Install Tailscale** on the laptop and phone, signed into the same account:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh   # laptop
   sudo tailscale up
   ```
   Install the Tailscale app on the phone and sign in the same way.
2. **Find the laptop's tailnet name/IP:**
   ```bash
   tailscale ip -4          # e.g. 100.101.102.103
   tailscale status         # shows the MagicDNS name, e.g. partha-tp-e14.tailXXXX.ts.net
   ```
3. **Let the service listen on the tailnet.** Reinstall the unit with the bind
   host opened up (it still serves localhost too, so sign-in keeps working):
   ```bash
   NISABA_HOST=0.0.0.0 bash systemd/install.sh
   systemctl --user restart nisaba.service
   ```
   `0.0.0.0` = all interfaces (localhost + Tailscale). Every endpoint except
   `/ping` still needs the bearer token, and only devices on your tailnet can
   route to it — but if you're ever on an untrusted LAN, that network can also
   reach the port, so treat the bearer token as the real guard.
4. **Point mobile Claude at it.** In the phone's Claude Code, using the laptop's
   MagicDNS name (nicer than the IP):
   ```bash
   claude mcp add nisaba --transport http \
     http://<laptop-name>.<tailnet>.ts.net:27125/mcp \
     --header "Authorization: Bearer <TOKEN>"
   ```
   (`<TOKEN>` is the same one in `~/.config/nisaba/service.json` on the laptop.)

Test from the phone: `curl http://<laptop-name>.<tailnet>.ts.net:27125/ping`
should return the service JSON when both devices are on the tailnet.

## Configuration (env vars)

| var | default | meaning |
|-----|---------|---------|
| `NISABA_PORT` | `27125` | localhost port for REST + MCP |
| `NISABA_WORKER_URL` | `https://auth.orionforge.dev` | auth broker |
| `NISABA_CLIENT_ID` | the app's public web client id | OAuth client |
| `NISABA_DATA_DIR` | `~/.local/share/nisaba` | local replica (plain JSON files) |
| `NISABA_CONFIG_DIR` | `~/.config/nisaba` | bearer token + session cookie |
| `NISABA_TOKEN` | auto-generated | override the local API bearer token |
| `NISABA_DEBUG` | — | set to log sync status |

## Data & durability

The local replica in `NISABA_DATA_DIR` is plain files — `items/<id>.json`,
`blobs/<id>`, `meta/*.json` — readable without the app, same rule as the Drive
copy. Deleting the data dir just means the next sync re-pulls from Drive.

## Tests

```bash
npm install   # dev-only: vitest
npm test
```

Covers the REST surface, the MCP JSON-RPC surface, a two-"device" Drive
round-trip (proving engine reuse), and attachment upload — all against the app's
in-process mock Drive.
