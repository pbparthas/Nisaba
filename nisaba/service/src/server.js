// The one localhost port. Serves Joplin-style REST nouns and the MCP endpoint
// behind a single bearer token, plus an unauthenticated /ping for discovery
// (Obsidian Local REST API pattern). Dependency-free node:http.

import http from 'node:http';
import crypto from 'node:crypto';
import { createMcpHandler } from './mcp.js';

const VERSION = '1.0.0';

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function createServer({ api, token, serverInfo, hooks = {} }) {
  const mcp = createMcpHandler(api, serverInfo ? { serverInfo } : undefined);

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      ...headers,
    });
    res.end(payload);
  }

  function authed(req) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer\s+(.+)$/);
    return m ? timingSafeEqual(m[1], token) : false;
  }

  async function readJson(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw Object.assign(new Error('invalid JSON body'), { code: 400 }); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;
    const q = Object.fromEntries(url.searchParams);

    if (method === 'OPTIONS') return send(res, 204, undefined);

    // --- discovery: unauthenticated -------------------------------------
    if (method === 'GET' && path === '/ping') {
      return send(res, 200, { app: 'nisaba-service', version: VERSION, authenticated: authed(req) });
    }
    // OAuth loopback callback (interactive sign-in; hook set by main.js).
    if (method === 'GET' && path === '/oauth/callback' && hooks.oauthCallback) {
      const html = await hooks.oauthCallback(url).catch((e) => `<p>Sign-in failed: ${e.message}</p>`);
      return send(res, 200, html || '<p>Signed in. You can close this tab.</p>');
    }

    // --- everything else needs the token --------------------------------
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });

    try {
      // MCP streamable HTTP: JSON-RPC in, JSON (or 202 for notifications) out.
      if (path === '/mcp') {
        if (method === 'POST') {
          const payload = await readJson(req);
          const out = await mcp.handle(payload);
          if (out === null) return send(res, 202, undefined); // notification only
          return send(res, 200, out, { 'Mcp-Session-Id': 'nisaba' });
        }
        return send(res, 405, { error: 'use POST for /mcp' });
      }

      // REST nouns
      if (method === 'GET' && path === '/notes') return send(res, 200, await api.searchNotes(q.query || '', { limit: num(q.limit) }));
      if (method === 'POST' && path === '/notes') return send(res, 201, await api.createNote(await readJson(req)));
      if (method === 'GET' && path === '/search') {
        const query = q.query || '';
        const [notes, tasks] = await Promise.all([api.searchNotes(query), searchTasks(api, query)]);
        return send(res, 200, { notes, tasks });
      }

      let m;
      if ((m = path.match(/^\/notes\/([^/]+)$/))) {
        const id = decodeURIComponent(m[1]);
        if (method === 'GET') return send(res, 200, await api.getNote(id));
        if (method === 'PATCH') return send(res, 200, await api.patchNote(id, await readJson(req)));
        if (method === 'DELETE') return send(res, 200, await api.deleteItem(id));
      }

      if (method === 'GET' && path === '/tasks') return send(res, 200, await api.listTasks({ state: q.state }));
      if (method === 'GET' && path === '/tasks/query') return send(res, 200, await api.queryTasks(q));
      if (method === 'POST' && path === '/tasks') return send(res, 201, await api.addTask(await readJson(req)));
      if ((m = path.match(/^\/tasks\/([^/]+)$/)) && method === 'GET') return send(res, 200, await api.getTask(decodeURIComponent(m[1])));
      if ((m = path.match(/^\/tasks\/([^/]+)\/complete$/)) && method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, await api.completeTask(decodeURIComponent(m[1]), body.done ?? true));
      }
      if ((m = path.match(/^\/tasks\/([^/]+)\/subtasks$/)) && method === 'POST') {
        const body = await readJson(req);
        return send(res, 201, await api.addSubtask(decodeURIComponent(m[1]), body.title));
      }
      if ((m = path.match(/^\/items\/([^/]+)\/attachments$/)) && method === 'POST') {
        return send(res, 201, await api.addAttachment(decodeURIComponent(m[1]), await readJson(req)));
      }
      if ((m = path.match(/^\/items\/([^/]+)$/)) && method === 'DELETE') {
        return send(res, 200, await api.deleteItem(decodeURIComponent(m[1])));
      }

      if (method === 'POST' && path === '/sync') { await api.sync(); return send(res, 200, { ok: true }); }

      return send(res, 404, { error: 'not found', path });
    } catch (e) {
      const code = typeof e.code === 'number' && e.code >= 400 && e.code < 600 ? e.code : 500;
      return send(res, code, { error: e.message });
    }
  });

  return server;
}

const num = (v) => (v == null ? undefined : Number(v));

async function searchTasks(api, query) {
  const q = String(query).toLowerCase().trim();
  const tasks = await api.listTasks({ state: 'all' });
  if (!q) return tasks;
  return tasks.filter((t) =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.subtasks || []).some((s) => (s.title || '').toLowerCase().includes(q)));
}
