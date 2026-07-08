// Nisaba auth broker — a Cloudflare Worker that turns the browser's one-time
// Google authorization code into a long-lived session. It holds the refresh
// token in KV (never in the browser) and mints fresh access tokens on demand,
// so the PWA stays signed in without the hourly Google prompt.
//
// It only ever touches auth tokens — note data still goes browser → Google
// Drive directly and never passes through here.
//
// Endpoints (all POST, credentials/cookies required except /exchange which
// also accepts the first code):
//   /exchange  { code }        -> sets ns_session cookie, returns access token
//   /refresh                   -> returns a fresh access token (uses cookie)
//   /revoke                    -> revokes the refresh token, clears the session

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const COOKIE = 'ns_session';
const SESSION_TTL = 60 * 60 * 24 * 180; // 180 days

const form = (obj) => new URLSearchParams(obj);

function corsHeaders(origin, allowed) {
  const ok = allowed.includes(origin) ? origin : (allowed[0] || '');
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// The PWA uses the popup 'postmessage' flow; the desktop service uses a
// loopback redirect. Allow only those shapes so /exchange can't be pointed at
// an attacker-controlled redirect.
function isAllowedRedirect(uri) {
  if (uri === 'postmessage') return true;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/oauth\/callback$/.test(uri || '');
}

function getCookie(req, name) {
  const raw = req.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function newSessionId() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function setCookie(id, domain, maxAge) {
  // SameSite=None + Secure so it rides cross-subdomain (app → auth). Domain
  // shares it across *.orionforge.dev.
  const dom = domain ? `; Domain=${domain}` : '';
  return `${COOKIE}=${id}; HttpOnly; Secure; SameSite=None; Path=/${dom}; Max-Age=${maxAge}`;
}

async function googleToken(env, params) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  return { ok: r.ok, data: await r.json() };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const ch = corsHeaders(origin, allowed);
    const domain = env.COOKIE_DOMAIN || '';

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });

    try {
      if (url.pathname === '/exchange' && req.method === 'POST') {
        const { code, redirect_uri, code_verifier } = await req.json().catch(() => ({}));
        if (!code) return json({ error: 'missing_code' }, 400, ch);
        const redirect = redirect_uri || 'postmessage';
        if (!isAllowedRedirect(redirect)) return json({ error: 'bad_redirect' }, 400, ch);
        const { ok, data } = await googleToken(env, {
          code, redirect_uri: redirect, grant_type: 'authorization_code',
          ...(code_verifier ? { code_verifier } : {}),
        });
        if (!ok) return json({ error: 'exchange_failed', detail: data }, 400, ch);

        let sid = getCookie(req, COOKIE) || newSessionId();
        const existing = await env.SESSIONS.get(sid, 'json');
        const refresh_token = data.refresh_token || existing?.refresh_token;
        // No refresh token means Google didn't grant offline access (usually a
        // returning grant). The app should re-consent.
        if (!refresh_token) return json({ error: 'no_refresh_token' }, 400, ch);
        await env.SESSIONS.put(sid, JSON.stringify({ refresh_token }), { expirationTtl: SESSION_TTL });

        return json({ access_token: data.access_token, expires_in: data.expires_in }, 200, {
          ...ch, 'Set-Cookie': setCookie(sid, domain, SESSION_TTL),
        });
      }

      if (url.pathname === '/refresh' && req.method === 'POST') {
        const sid = getCookie(req, COOKIE);
        const s = sid ? await env.SESSIONS.get(sid, 'json') : null;
        if (!s?.refresh_token) return json({ error: 'no_session' }, 401, ch);
        const { ok, data } = await googleToken(env, {
          refresh_token: s.refresh_token, grant_type: 'refresh_token',
        });
        if (!ok) {
          if (data.error === 'invalid_grant') { await env.SESSIONS.delete(sid); return json({ error: 'revoked' }, 401, ch); }
          return json({ error: 'refresh_failed', detail: data }, 400, ch);
        }
        // refresh the cookie's lifetime on use
        return json({ access_token: data.access_token, expires_in: data.expires_in }, 200, {
          ...ch, 'Set-Cookie': setCookie(sid, domain, SESSION_TTL),
        });
      }

      if (url.pathname === '/revoke' && req.method === 'POST') {
        const sid = getCookie(req, COOKIE);
        if (sid) {
          const s = await env.SESSIONS.get(sid, 'json');
          if (s?.refresh_token) {
            await fetch(REVOKE_URL, {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: form({ token: s.refresh_token }),
            }).catch(() => {});
          }
          await env.SESSIONS.delete(sid);
        }
        return json({ ok: true }, 200, { ...ch, 'Set-Cookie': setCookie('', domain, 0) });
      }

      return json({ error: 'not_found' }, 404, ch);
    } catch (e) {
      return json({ error: 'server_error', detail: String(e) }, 500, ch);
    }
  },
};
