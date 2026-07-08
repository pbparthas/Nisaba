// Desktop auth that REUSES the deployed auth-broker Worker (auth.orionforge.dev)
// instead of a second OAuth client. Flow:
//
//   1. loopback OAuth: open the user's browser to Google with a fixed
//      redirect_uri (http://localhost:<port>/oauth/callback) + PKCE.
//   2. Google redirects back to our own server with ?code=…
//   3. we hand the code to the Worker's /exchange, which swaps it (using the
//      client secret it holds) for tokens and returns an ns_session cookie.
//   4. we persist that cookie and, from then on, call the Worker's /refresh
//      to mint fresh Drive access tokens — the refresh token never touches
//      this machine, exactly like the PWA.
//
// One manual step for the owner: add http://localhost:<port>/oauth/callback as
// an Authorized redirect URI on the existing Web OAuth client, and redeploy the
// Worker with the /exchange change that accepts a redirect_uri.

import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref(); } catch { /* headless: print below */ }
}

export function createWorkerAuth({ workerUrl, clientId, redirectUri, sessionFile }) {
  let cookie = null;          // ns_session value (persisted)
  let token = null;           // cached access token (memory only)
  let expiresAt = 0;
  let pending = null;         // { verifier, state, resolve, reject } during sign-in

  async function loadSession() {
    if (cookie) return;
    try { cookie = JSON.parse(await fs.readFile(sessionFile, 'utf8')).cookie || null; } catch { /* none */ }
  }
  async function saveSession() {
    await fs.writeFile(sessionFile, JSON.stringify({ cookie }), { mode: 0o600 });
  }

  // POST to the Worker, sending our session cookie and capturing any refreshed one.
  async function workerPost(path, body) {
    const res = await fetch(workerUrl + path, {
      method: 'POST',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: `ns_session=${cookie}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie?.() || [];
    for (const c of setCookies) {
      const m = c.match(/(?:^|;\s*)ns_session=([^;]+)/);
      if (m) { cookie = m[1]; await saveSession(); }
    }
    if (!res.ok) { const e = new Error(`worker ${path} ${res.status}`); e.code = res.status; throw e; }
    return res.json();
  }

  function cache(t) {
    token = t.access_token;
    expiresAt = Date.now() + (t.expires_in - 60) * 1000;
  }

  return {
    // Kick off interactive sign-in: returns a promise that resolves once the
    // browser round-trip + Worker exchange complete. main.js routes the
    // loopback callback into completeCallback().
    signIn() {
      const verifier = b64url(crypto.randomBytes(32));
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      const state = b64url(crypto.randomBytes(16));
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',   // ask Google for a refresh token (Worker stores it)
        prompt: 'consent',        // force it the first time so a refresh token is issued
        include_granted_scopes: 'true',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).toString();

      return new Promise((resolve, reject) => {
        pending = { verifier, state, resolve, reject };
        console.log(`\nOpen this URL to connect Google Drive:\n${url}\n`);
        openBrowser(url.toString());
      });
    },

    // Called by the loopback /oauth/callback route with the redirect URL.
    async completeCallback(callbackUrl) {
      if (!pending) return '<p>No sign-in in progress.</p>';
      const { verifier, state, resolve, reject } = pending;
      try {
        const code = callbackUrl.searchParams.get('code');
        const err = callbackUrl.searchParams.get('error');
        if (err) throw new Error(err);
        if (callbackUrl.searchParams.get('state') !== state) throw new Error('state mismatch');
        if (!code) throw new Error('no authorization code');
        cache(await workerPost('/exchange', { code, redirect_uri: redirectUri, code_verifier: verifier }));
        pending = null;
        resolve();
        return '<h2>Nisaba connected ✓</h2><p>You can close this tab and return to the terminal.</p>';
      } catch (e) {
        pending = null;
        reject(e);
        return `<h2>Sign-in failed</h2><p>${e.message}</p>`;
      }
    },

    async getToken() {
      if (token && Date.now() < expiresAt) return token;
      await loadSession();
      if (!cookie) { const e = new Error('not signed in'); e.code = 401; throw e; }
      cache(await workerPost('/refresh'));
      return token;
    },

    async isSignedIn() { await loadSession(); return !!cookie; },

    async signOut() {
      await loadSession();
      try { await workerPost('/revoke'); } catch { /* offline / already gone */ }
      cookie = null; token = null; expiresAt = 0;
      await fs.rm(sessionFile, { force: true });
    },
  };
}
