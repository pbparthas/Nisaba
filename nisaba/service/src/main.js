#!/usr/bin/env node
// Entry point for the Nisaba desktop service. Wires the file store + Worker
// auth + shared sync engine to the REST/MCP server on one localhost port.
// Run standalone (`node src/main.js`) or as a Tauri sidecar.
//
// Config (env overrides, sensible defaults):
//   NISABA_PORT        27125
//   NISABA_WORKER_URL  https://auth.orionforge.dev
//   NISABA_CLIENT_ID   <the app's public web client id>
//   NISABA_DATA_DIR    ~/.local/share/nisaba   (local replica; durable)
//   NISABA_CONFIG_DIR  ~/.config/nisaba        (bearer token + session cookie)
//   NISABA_TOKEN       (bearer for the local API; auto-generated + saved if unset)

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createFileStore } from './store-file.js';
import { createWorkerAuth } from './auth-worker.js';
import { createApi } from './api.js';
import { createServer } from './server.js';

const PORT = Number(process.env.NISABA_PORT) || 27125;
const WORKER_URL = process.env.NISABA_WORKER_URL || 'https://auth.orionforge.dev';
const CLIENT_ID = process.env.NISABA_CLIENT_ID || '652122307592-300cfvid9hl2s4t59hm9c4mivbtm3beq.apps.googleusercontent.com';
const DATA_DIR = process.env.NISABA_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'nisaba');
const CONFIG_DIR = process.env.NISABA_CONFIG_DIR || path.join(os.homedir(), '.config', 'nisaba');
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

async function loadOrCreateToken() {
  if (process.env.NISABA_TOKEN) return process.env.NISABA_TOKEN;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const file = path.join(CONFIG_DIR, 'service.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')).token; }
  catch { /* first run */ }
  const token = crypto.randomBytes(24).toString('base64url');
  await fs.writeFile(file, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  return token;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  const token = await loadOrCreateToken();
  const store = createFileStore(DATA_DIR);
  const auth = createWorkerAuth({
    workerUrl: WORKER_URL,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    sessionFile: path.join(CONFIG_DIR, 'session.json'),
  });
  const api = createApi({
    store,
    getToken: () => auth.getToken(),
    getAccessToken: () => auth.getAccessToken(),
    driveBaseUrl: undefined, // real Google
    onStatus: (s) => process.env.NISABA_DEBUG && console.log('[sync]', s),
  });

  // Sub-commands: `node src/main.js sign-out`
  if (process.argv[2] === 'sign-out') {
    await auth.signOut();
    console.log('Signed out — session revoked.');
    return;
  }

  const server = createServer({
    api,
    token,
    hooks: { oauthCallback: (url) => auth.completeCallback(url) },
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log(`Nisaba service listening on http://127.0.0.1:${PORT}`);

  if (!(await auth.isSignedIn())) {
    console.log('Not connected to Google Drive yet — starting sign-in…');
    try { await auth.signIn(); console.log('Connected.'); }
    catch (e) { console.error('Sign-in failed:', e.message); }
  }

  // First pull, then keep the replica warm.
  api.sync().catch((e) => console.warn('initial sync deferred:', e.message));
  setInterval(() => api.sync().catch(() => {}), SYNC_INTERVAL_MS).unref();

  console.log('\n── Connect Claude Code ─────────────────────────────────────');
  console.log(`claude mcp add nisaba --transport http http://localhost:${PORT}/mcp \\`);
  console.log(`  --header "Authorization: Bearer ${token}"`);
  console.log('\nREST base:  http://localhost:' + PORT + '   (same bearer token)');
  console.log('Discovery:  curl http://localhost:' + PORT + '/ping');
  console.log('────────────────────────────────────────────────────────────\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
