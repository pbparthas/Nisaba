// Browser auth via Google Identity Services (token model). The client ID is
// public by design; there is no secret in a browser OAuth app. Access tokens
// last ~1h — we refresh silently and only fall back to a consent popup when
// silent refresh fails.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

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
  let tokenClient = null;
  let token = null;
  let expiresAt = 0;

  async function init() {
    await loadGis();
    tokenClient = tokenClient || window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {}, // replaced per-request below
    });
  }

  function request(prompt) {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        token = resp.access_token;
        expiresAt = Date.now() + (resp.expires_in - 60) * 1000;
        resolve(token);
      };
      tokenClient.error_callback = (err) => reject(new Error(err.type || 'auth failed'));
      tokenClient.requestAccessToken({ prompt });
    });
  }

  return {
    // Interactive sign-in (call from a user gesture: popup blockers).
    async signIn() {
      await init();
      await request('consent');
      localStorage.setItem('ns_signed_in', '1');
    },

    // For the Drive client: returns a valid token, silently refreshing.
    async getToken() {
      if (token && Date.now() < expiresAt) return token;
      await init();
      try {
        return await request(''); // silent — works while the Google session lives
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
      localStorage.removeItem('ns_signed_in');
    },
  };
}
