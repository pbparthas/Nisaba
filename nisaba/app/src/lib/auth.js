// Browser auth for Google Drive. Two modes, chosen by whether an auth-broker
// Worker URL is configured:
//
//   • Token mode (default): Google Identity Services token model. Access tokens
//     last ~1h; refreshed silently via the Google session while it lives, else
//     the user re-taps sign-in. No backend.
//
//   • Backend mode: the authorization-code flow with a Cloudflare Worker
//     (see ../../worker). The Worker holds the refresh token and mints fresh
//     access tokens, so the session survives for weeks with no prompt. Enabled
//     by setting AUTH_WORKER below (or localStorage 'ns_auth_worker' to test).
//
// The client ID is public; there is no secret in the browser in either mode.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// Point this at the deployed Worker (e.g. 'https://auth.orionforge.dev') to
// switch the whole app to the persistent-login backend. Empty = token mode.
const AUTH_WORKER_DEFAULT = 'https://auth.orionforge.dev';
function workerUrl() {
  try { return localStorage.getItem('ns_auth_worker') || AUTH_WORKER_DEFAULT; } catch { return AUTH_WORKER_DEFAULT; }
}

let gisReady = null;
function loadGis() {
  gisReady = gisReady || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisReady;
}

export function createAuth(clientId) {
  const worker = workerUrl();
  return worker ? createBackendAuth(clientId, worker) : createTokenAuth(clientId);
}

// ---------------------------------------------------------------------------
// Token mode (default, no backend)
// ---------------------------------------------------------------------------
function createTokenAuth(clientId) {
  let tokenClient = null;
  let token = localStorage.getItem('ns_token') || null;
  let expiresAt = Number(localStorage.getItem('ns_token_exp')) || 0;

  async function init() {
    await loadGis();
    tokenClient = tokenClient || window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {},
    });
  }

  function request(prompt) {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        token = resp.access_token;
        expiresAt = Date.now() + (resp.expires_in - 60) * 1000;
        localStorage.setItem('ns_token', token);
        localStorage.setItem('ns_token_exp', String(expiresAt));
        localStorage.setItem('ns_signed_in', '1');
        resolve(token);
      };
      tokenClient.error_callback = (err) => reject(new Error(err.type || 'auth failed'));
      tokenClient.requestAccessToken({ prompt });
    });
  }

  return {
    async signIn() { await init(); await request(''); },
    async getToken() {
      if (token && Date.now() < expiresAt) return token;
      await init();
      try {
        return await request('');
      } catch {
        const e = new Error('unauthorized');
        e.code = 401;
        throw e;
      }
    },
    isSignedIn: () => localStorage.getItem('ns_signed_in') === '1',
    signOut() {
      if (token) window.google?.accounts.oauth2.revoke(token, () => {});
      token = null;
      expiresAt = 0;
      localStorage.removeItem('ns_token');
      localStorage.removeItem('ns_token_exp');
      localStorage.removeItem('ns_signed_in');
    },
  };
}

// ---------------------------------------------------------------------------
// Backend mode (persistent login via the auth-broker Worker)
// ---------------------------------------------------------------------------
function createBackendAuth(clientId, worker) {
  let codeClient = null;
  let token = null;
  let expiresAt = 0;

  async function init() {
    await loadGis();
    codeClient = codeClient || window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPE,
      ux_mode: 'popup',
      callback: () => {},
    });
  }

  function requestCode() {
    return new Promise((resolve, reject) => {
      codeClient.callback = (resp) => {
        if (resp.error || !resp.code) return reject(new Error(resp.error || 'no authorization code'));
        resolve(resp.code);
      };
      codeClient.error_callback = (err) => reject(new Error(err.type || 'auth failed'));
      codeClient.requestCode();
    });
  }

  async function post(path, body) {
    const res = await fetch(worker + path, {
      method: 'POST',
      credentials: 'include', // send/receive the ns_session cookie
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) { const e = new Error('auth ' + res.status); e.code = res.status; throw e; }
    return res.json();
  }

  function cache(t) {
    token = t.access_token;
    expiresAt = Date.now() + (t.expires_in - 60) * 1000;
    localStorage.setItem('ns_signed_in', '1');
  }

  return {
    async signIn() {
      await init();
      const code = await requestCode();
      cache(await post('/exchange', { code }));
    },
    async getToken() {
      if (token && Date.now() < expiresAt) return token;
      try {
        cache(await post('/refresh'));
        return token;
      } catch {
        localStorage.removeItem('ns_signed_in');
        const e = new Error('unauthorized');
        e.code = 401;
        throw e;
      }
    },
    isSignedIn: () => localStorage.getItem('ns_signed_in') === '1',
    async signOut() {
      try { await post('/revoke'); } catch { /* offline / already gone */ }
      token = null;
      expiresAt = 0;
      localStorage.removeItem('ns_signed_in');
    },
  };
}
