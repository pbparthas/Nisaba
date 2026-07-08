// Exercises the whole desktop service against the app's in-process mock Drive:
// REST nouns, the MCP JSON-RPC surface, a two-"device" Drive round-trip (proving
// the shared sync engine is reused unchanged), and attachment upload.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockDrive } from '../../app/test/mock-drive.js';
import { createFileStore } from '../src/store-file.js';
import { createApi } from '../src/api.js';
import { createServer } from '../src/server.js';

const TOKEN = 'test-bearer-token';
const getToken = async () => 'fake-drive-access-token';

let drive, tmp, store, api, server, base;

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nisaba-svc-'));
}

beforeAll(async () => {
  drive = await startMockDrive();
  tmp = await mkTmp();
  store = createFileStore(tmp);
  api = createApi({ store, getToken, driveBaseUrl: drive.baseUrl, autoSync: false });
  server = createServer({ api, token: TOKEN });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  drive.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

function req(method, p, { body, token = TOKEN } = {}) {
  return fetch(base + p, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const rpc = (msg) => req('POST', '/mcp', { body: msg }).then((r) => r.json());

describe('discovery + auth', () => {
  it('GET /ping is unauthenticated and reports auth state', async () => {
    const anon = await (await fetch(base + '/ping')).json();
    expect(anon).toMatchObject({ app: 'nisaba-service', authenticated: false });
    const withTok = await (await req('GET', '/ping')).json();
    expect(withTok.authenticated).toBe(true);
  });

  it('rejects REST calls without the bearer token', async () => {
    const res = await req('GET', '/notes', { token: null });
    expect(res.status).toBe(401);
  });
});

describe('REST notes + tasks', () => {
  let noteId;
  it('creates and reads a note with its full body', async () => {
    const created = await (await req('POST', '/notes', { body: { title: 'Groceries', body: 'milk and eggs', tags: ['home'] } })).json();
    noteId = created.id;
    expect(created.title).toBe('Groceries');
    const got = await (await req('GET', `/notes/${noteId}`)).json();
    expect(got.body).toBe('milk and eggs');
    expect(got.preview).toContain('milk');
  });

  it('searches notes by text', async () => {
    const hits = await (await req('GET', '/notes?query=eggs')).json();
    expect(hits.map((n) => n.id)).toContain(noteId);
    const miss = await (await req('GET', '/notes?query=zzzznope')).json();
    expect(miss.length).toBe(0);
  });

  it('patches a note', async () => {
    const patched = await (await req('PATCH', `/notes/${noteId}`, { body: { title: 'Groceries (updated)' } })).json();
    expect(patched.title).toBe('Groceries (updated)');
    expect(patched.body).toBe('milk and eggs'); // untouched
  });

  it('adds tasks and runs an agenda query', async () => {
    await (await req('POST', '/tasks', { body: { title: 'Pay rent', due: '2026-07-01' } })).json();
    await (await req('POST', '/tasks', { body: { title: 'Future thing', due: '2026-12-31' } })).json();
    const overdue = await (await req('GET', '/tasks/query?state=open&due_before=2026-07-08')).json();
    expect(overdue.map((t) => t.title)).toContain('Pay rent');
    expect(overdue.map((t) => t.title)).not.toContain('Future thing');
  });

  it('completes a task and reflects state filters', async () => {
    const t = await (await req('POST', '/tasks', { body: { title: 'Quick win' } })).json();
    await req('POST', `/tasks/${t.id}/complete`, { body: { done: true } });
    const open = await (await req('GET', '/tasks?state=open')).json();
    const done = await (await req('GET', '/tasks?state=done')).json();
    expect(open.map((x) => x.id)).not.toContain(t.id);
    expect(done.map((x) => x.id)).toContain(t.id);
  });

  it('/search spans notes and tasks', async () => {
    const res = await (await req('GET', '/search?query=rent')).json();
    expect(res.tasks.map((t) => t.title)).toContain('Pay rent');
    expect(Array.isArray(res.notes)).toBe(true);
  });
});

describe('MCP surface', () => {
  it('initialize negotiates protocol + serverInfo', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    expect(r.result.protocolVersion).toBe('2024-11-05');
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.serverInfo.name).toBe('nisaba');
  });

  it('the initialized notification gets no reply (202)', async () => {
    const res = await req('POST', '/mcp', { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(res.status).toBe(202);
  });

  it('tools/list exposes the full toolset incl. query_tasks', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = r.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'search_notes', 'get_note', 'create_note', 'patch_note',
      'list_tasks', 'query_tasks', 'add_task', 'complete_task',
      'add_subtask', 'add_attachment', 'delete_item',
    ]));
  });

  it('tools/call add_task then query_tasks round-trips through the store', async () => {
    const add = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_task', arguments: { title: 'MCP task', due: '2026-08-01' } } });
    const created = JSON.parse(add.result.content[0].text);
    expect(created.title).toBe('MCP task');

    const query = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'query_tasks', arguments: { state: 'open', due_before: '2026-09-01' } } });
    const rows = JSON.parse(query.result.content[0].text);
    expect(rows.map((t) => t.title)).toContain('MCP task');
  });

  it('reports tool errors in-band (isError), not as RPC errors', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_note', arguments: { id: 'nope' } } });
    expect(r.error).toBeUndefined();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/not found/);
  });

  it('unknown method returns -32601', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 6, method: 'does/not/exist' });
    expect(r.error.code).toBe(-32601);
  });
});

describe('Drive round-trip (engine reuse)', () => {
  it('pushes to Drive and a second device pulls the same items', async () => {
    await api.sync(); // flush everything created above up to the mock Drive

    const tmp2 = await mkTmp();
    try {
      const store2 = createFileStore(tmp2);
      const api2 = createApi({ store: store2, getToken, driveBaseUrl: drive.baseUrl, autoSync: false });
      await api2.sync(); // pull from Drive into a fresh replica

      const notes = await api2.searchNotes('Groceries');
      expect(notes.length).toBeGreaterThan(0);
      const tasks = await api2.listTasks({ state: 'all' });
      expect(tasks.map((t) => t.title)).toContain('Pay rent');
    } finally {
      await fs.rm(tmp2, { recursive: true, force: true });
    }
  });

  it('uploads an attachment to Drive on sync', async () => {
    const note = await (await req('POST', '/notes', { body: { title: 'With image' } })).json();
    const b64 = Buffer.from('fake-png-bytes').toString('base64');
    const att = await (await req('POST', `/items/${note.id}/attachments`, { body: { name: 'shot.png', mime: 'image/png', data: b64 } })).json();
    expect(att.size).toBe('fake-png-bytes'.length);

    await api.sync();
    const attFiles = [...drive._files.values()].filter((f) => f.name.startsWith(att.id + '__'));
    expect(attFiles.length).toBe(1);
    expect(attFiles[0].name).toBe(`${att.id}__shot.png`);
  });
});
