// Domain layer shared by the REST and MCP surfaces. It wires the file store to
// the SAME Drive client + sync engine the app uses, then exposes note/task
// operations in terms a caller (Claude Code, Enki, curl) understands. Every
// mutation writes locally as dirty and kicks a sync; reads come from the local
// replica (fast, offline-tolerant), which the engine keeps current with Drive.

import { createDriveClient } from '../../app/src/lib/drive.js';
import { createSyncEngine } from '../../app/src/lib/sync.js';
import { newItem } from '../../app/src/lib/merge.js';
import { blocksToText } from '../../app/src/lib/notebody.js';

const todayISO = (d = new Date()) => d.toISOString().slice(0, 10);

export function createApi({ store, getToken, getAccessToken, driveBaseUrl, onStatus = () => {}, autoSync = true }) {
  const drive = createDriveClient({ getToken, baseUrl: driveBaseUrl });
  const engine = createSyncEngine({ store, drive, onStatus });
  // Used by the /token endpoint (desktop webview). Falls back to wrapping
  // getToken with a conservative lifetime if a richer provider wasn't given.
  const accessToken = getAccessToken || (async () => ({ access_token: await getToken(), expires_in: 3000 }));

  // Upsert an item the way the app's saveItem does: stamp updated_at, mark
  // dirty, persist, then let the engine push it. Callers that update an
  // existing item fetch + validate it first (below), so this stays a plain put.
  async function save(item) {
    const full = { ...item, updated_at: Date.now(), dirty: 1 };
    await store.putItem(full);
    if (autoSync) engine.schedule();
    return full;
  }

  function notFound(id) {
    return Object.assign(new Error(`item ${id} not found`), { code: 404 });
  }

  // Public shape for a note (list vs full differ only by whether body is included).
  function noteView(i, { full = false } = {}) {
    const base = {
      id: i.id, title: i.title || '', tags: i.tags || [],
      preview: blocksToText(i.body).slice(0, 200),
      attachments: (i.attachments || []).map((a) => ({ id: a.id, name: a.name, mime: a.mime })),
      created_at: i.created_at, updated_at: i.updated_at,
    };
    return full ? { ...base, body: i.body } : base;
  }
  function taskView(t) {
    return {
      id: t.id, title: t.title || '', done: !!t.done, due: t.due || null,
      subtasks: (t.subtasks || []).map((s) => ({ id: s.id, title: s.title, done: !!s.done })),
      created_at: t.created_at, updated_at: t.updated_at,
    };
  }

  const live = async () => (await store.allItems()).filter((i) => !i.deleted);

  return {
    drive,
    engine,

    // A fresh Drive access token for the desktop webview (see /token).
    async getAccessToken() { return accessToken(); },

    // Pull the latest from Drive before serving reads/writes. Best-effort: if
    // the network or auth is down we still operate on the local replica.
    async sync() { await engine.sync(); },

    // ---- notes -----------------------------------------------------------
    async searchNotes(query = '', { limit = 50 } = {}) {
      const q = String(query).toLowerCase().trim();
      const notes = (await live()).filter((i) => i.type === 'note');
      const hit = (i) =>
        !q ||
        (i.title || '').toLowerCase().includes(q) ||
        blocksToText(i.body).toLowerCase().includes(q) ||
        (i.tags || []).some((t) => String(t).toLowerCase().includes(q));
      return notes.filter(hit)
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, limit)
        .map((i) => noteView(i));
    },

    async getNote(id) {
      const i = await store.getItem(id);
      if (!i || i.deleted || i.type !== 'note') throw notFound(id);
      return noteView(i, { full: true });
    },

    async createNote({ title = '', body = '', tags = [] } = {}) {
      const item = await save({ ...newItem({ type: 'note' }), title, body, tags });
      return noteView(item, { full: true });
    },

    async patchNote(id, { title, body, tags } = {}) {
      const cur = await store.getItem(id);
      if (!cur || cur.deleted || cur.type !== 'note') throw notFound(id);
      const patch = { ...cur };
      if (title !== undefined) patch.title = title;
      if (body !== undefined) patch.body = body;
      if (tags !== undefined) patch.tags = tags;
      return noteView(await save(patch), { full: true });
    },

    // ---- tasks -----------------------------------------------------------
    async listTasks({ state = 'all', limit = 200 } = {}) {
      const tasks = (await live()).filter((i) => i.type === 'task');
      const filtered = tasks.filter((t) =>
        state === 'all' ? true : state === 'done' ? t.done : !t.done);
      return filtered
        .sort((a, b) => String(a.due || '~').localeCompare(String(b.due || '~')))
        .slice(0, limit)
        .map(taskView);
    },

    // The differentiator: agenda-style queries generic note MCPs lack.
    async queryTasks({ due_before, due_after, state = 'open', limit = 200 } = {}) {
      const tasks = (await live()).filter((i) => i.type === 'task');
      const out = tasks.filter((t) => {
        if (state === 'done' && !t.done) return false;
        if (state === 'open' && t.done) return false;
        if (due_before && !(t.due && t.due < due_before)) return false;
        if (due_after && !(t.due && t.due > due_after)) return false;
        return true;
      });
      return out
        .sort((a, b) => String(a.due || '~').localeCompare(String(b.due || '~')))
        .slice(0, limit)
        .map(taskView);
    },

    async getTask(id) {
      const t = await store.getItem(id);
      if (!t || t.deleted || t.type !== 'task') throw notFound(id);
      return taskView(t);
    },

    async addTask({ title, due = null } = {}) {
      if (!title || !String(title).trim()) throw Object.assign(new Error('title required'), { code: 400 });
      const item = await save({ ...newItem({ type: 'task' }), title: String(title).trim(), due: due || null });
      return taskView(item);
    },

    async completeTask(id, done = true) {
      const t = await store.getItem(id);
      if (!t || t.type !== 'task') throw notFound(id);
      return taskView(await save({ ...t, done: !!done }));
    },

    async addSubtask(id, title) {
      const t = await store.getItem(id);
      if (!t || t.type !== 'task') throw notFound(id);
      const subtasks = [...(t.subtasks || []), { id: crypto.randomUUID(), title: String(title), done: false }];
      return taskView(await save({ ...t, subtasks }));
    },

    // ---- attachments -----------------------------------------------------
    // data is base64. The blob goes to the local store now and rides the next
    // sync up to Drive attachments/; the item gains a reference.
    async addAttachment(id, { name, mime = 'application/octet-stream', data } = {}) {
      const item = await store.getItem(id);
      if (!item || item.deleted) throw notFound(id);
      if (!data) throw Object.assign(new Error('data (base64) required'), { code: 400 });
      const attId = crypto.randomUUID();
      const bytes = Buffer.from(data, 'base64');
      await store.putBlob(attId, new Blob([bytes], { type: mime }));
      const attachments = [...(item.attachments || []), { id: attId, name: name || attId, mime }];
      await save({ ...item, attachments });
      return { id: attId, name: name || attId, mime, size: bytes.length };
    },

    async deleteItem(id) {
      const i = await store.getItem(id);
      if (!i) throw notFound(id);
      await save({ ...i, deleted: true });
      return { id, deleted: true };
    },

    _todayISO: todayISO,
  };
}
