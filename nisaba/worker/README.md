# Nisaba auth broker (Cloudflare Worker)

Keeps the Google session alive so the PWA doesn't ask you to sign in every
hour. It holds the **refresh token** in Cloudflare KV (never in the browser)
and mints fresh access tokens on demand. It only ever touches auth tokens —
your notes still go browser → Google Drive directly and never pass through it.

## One-time setup

Everything runs from this `nisaba/worker/` folder.

### 1. Install Wrangler and log in
```bash
cd nisaba/worker
npm install
npx wrangler login       # opens a browser to authorise Cloudflare
```

### 2. Get your Google client secret
- Go to https://console.cloud.google.com/apis/credentials
- Open your existing OAuth 2.0 **Web application** client (the one whose ID is
  already baked into the app).
- Copy the **Client secret** (it's already there — the browser flow just never
  used it).
- Make sure **Authorized JavaScript origins** includes `https://nisaba.orionforge.dev`
  (already added). No redirect URI is needed — the popup flow uses `postmessage`.

### 3. Create the KV namespace
```bash
npx wrangler kv namespace create SESSIONS
```
Copy the printed `id` into `wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`).

### 4. Store the secret
```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
# paste the client secret when prompted
```

### 5. Deploy
```bash
npx wrangler deploy
```

### 6. Put it on auth.orionforge.dev
In the Cloudflare dashboard: **Workers & Pages → nisaba-auth → Settings →
Domains & Routes → Add → Custom Domain →** `auth.orionforge.dev`.
Cloudflare creates the DNS record automatically.

### 7. Turn it on in the app
Tell me it's live and I'll set `AUTH_WORKER_DEFAULT = 'https://auth.orionforge.dev'`
in `app/src/lib/auth.js` and redeploy. (To try it before that, on the site run
`localStorage.setItem('ns_auth_worker','https://auth.orionforge.dev')` in the
browser console and reload — sign in once, and you should stay signed in.)

## Notes
- The **first** connection must grant consent so Google issues a refresh token;
  a new origin (nisaba.orionforge.dev) does this automatically.
- Sign out in the app calls `/revoke`, which revokes the refresh token and
  clears the session.
- Free tier is plenty: KV free tier and Workers free tier cover personal use.
