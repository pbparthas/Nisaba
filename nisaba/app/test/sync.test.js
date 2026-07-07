// End-to-end sync tests: two simulated devices, one mock Drive, per-item files.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startMockDrive } from './mock-drive.js';
import { createMemoryStore } from '../src/lib/store-memory.js';
import { createDriveClient } from '../src/lib/drive.js';
import { createSyncEngine } from '../src/lib/sync.js';
import { newItem } from '../src/lib/merge.js';

let mock;

function device() {
  const store = createMemoryStore();
  const drive = createDriveClient({ getToken: async () => 'test-token', baseUrl: mock.baseUrl });
  const engine = createSyncEngine({ store, drive });
  return { store, drive, engine };
}

async function addItem(store, partial) {
  const it = { ...newItem(partial), dirty: 1 };
  await store.putItem(it);
  return it;
}

const fileNames = () => [...mock._files.values()].map((f) => f.name);

beforeEach(async () => { mock = await startMockDrive(); });
afterEach(() => mock.close());

describe('two-device sync through Drive (per-item files)', () => {
  it('creates the folder layout, schema guard, and one file per item', async () => {
    const a = device();
    await addItem(a.store, { title: 'n1', type: 'note' });
    await addItem(a.store, { title: 't1', type: 'task' });
    await a.engine.sync();
    const names = fileNames();
    expect(names).toContain('Nisaba');
    expect(names).toContain('items');
    expect(names).toContain('attachments');
    expect(names).toContain('schema.json');
    expect(names.filter((n) => n.endsWith('.json') && n !== 'schema.json')).toHaveLength(2);
  });

  it('refuses to sync against a newer schema', async () => {
    const a = device();
    await a.engine.sync();
    const schemaFile = [...mock._files.values()].find((f) => f.name === 'schema.json');
    schemaFile.content = Buffer.from(JSON.stringify({ schema: 99 }));
    const b = device();
    let status;
    const engine = createSyncEngine({ store: b.store, drive: b.drive, onStatus: (s) => { status = s; } });
    await engine.sync();
    expect(status).toBe('update-needed');
  });

  it('propagates items from device A to device B', async () => {
    const a = device();
    const b = device();
    await addItem(a.store, { title: 'from A', type: 'note' });
    await a.engine.sync();
    await b.engine.sync();
    const bItems = await b.store.allItems();
    expect(bItems).toHaveLength(1);
    expect(bItems[0].title).toBe('from A');
    expect(bItems[0].dirty).toBe(0);
  });

  it('concurrent edits to the same note: newer wins, loser kept as conflict copy on both devices', async () => {
    const a = device();
    const b = device();
    const x = await addItem(a.store, { title: 'v1', type: 'note' });
    await a.engine.sync();
    await b.engine.sync();

    await a.store.putItem({ ...x, title: 'A-edit', body: 'from A', updated_at: x.updated_at + 10, dirty: 1 });
    const bx = await b.store.getItem(x.id);
    await b.store.putItem({ ...bx, title: 'B-edit', body: 'from B', updated_at: x.updated_at + 20, dirty: 1 });

    await a.engine.sync(); // A pushes A-edit
    await b.engine.sync(); // B pulls A-edit, B-edit is newer -> wins, A-edit saved as conflict copy, B pushes both
    await a.engine.sync(); // A converges

    for (const d of [a, b]) {
      const items = (await d.store.allItems()).filter((i) => !i.deleted);
      const titles = items.map((i) => i.title).sort();
      expect(titles).toEqual(['A-edit (conflict copy)', 'B-edit']);
    }
  });

  it('concurrent edits to different notes merge cleanly with no conflict copies', async () => {
    const a = device();
    const b = device();
    const n1 = await addItem(a.store, { title: 'n1', type: 'note' });
    const n2 = await addItem(a.store, { title: 'n2', type: 'note' });
    await a.engine.sync();
    await b.engine.sync();

    await a.store.putItem({ ...(await a.store.getItem(n1.id)), title: 'n1-A', updated_at: Date.now() + 1, dirty: 1 });
    await b.store.putItem({ ...(await b.store.getItem(n2.id)), title: 'n2-B', updated_at: Date.now() + 2, dirty: 1 });

    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    for (const d of [a, b]) {
      const titles = (await d.store.allItems()).map((i) => i.title).sort();
      expect(titles).toEqual(['n1-A', 'n2-B']);
    }
  });

  it('task races resolve by newest with no duplicates', async () => {
    const a = device();
    const b = device();
    const t = await addItem(a.store, { title: 'task', type: 'task' });
    await a.engine.sync();
    await b.engine.sync();

    await a.store.putItem({ ...(await a.store.getItem(t.id)), done: true, updated_at: Date.now() + 1, dirty: 1 });
    await b.store.putItem({ ...(await b.store.getItem(t.id)), title: 'task renamed', updated_at: Date.now() + 2, dirty: 1 });

    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    for (const d of [a, b]) {
      const items = await d.store.allItems();
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('task renamed');
    }
  });

  it('propagates deletes as tombstones', async () => {
    const a = device();
    const b = device();
    const x = await addItem(a.store, { title: 'doomed', type: 'note' });
    await a.engine.sync();
    await b.engine.sync();

    await a.store.putItem({ ...(await a.store.getItem(x.id)), deleted: true, updated_at: Date.now() + 1, dirty: 1 });
    await a.engine.sync();
    await b.engine.sync();
    expect((await b.store.getItem(x.id)).deleted).toBe(true);
  });

  it('does not re-upload or re-download unchanged items', async () => {
    const a = device();
    await addItem(a.store, { title: 'once', type: 'note' });
    await a.engine.sync();
    const before = mock._requests.length;
    await a.engine.sync();
    const delta = mock._requests.slice(before);
    expect(delta.some((r) => r.method === 'PATCH' || r.method === 'POST')).toBe(false);
    expect(delta.some((r) => r.url.includes('alt=media') && !r.url.includes('schema'))).toBe(false);
  });

  it('uploads attachment blobs and lazily downloads them on the other device', async () => {
    const a = device();
    const b = device();
    const attId = 'att-1';
    await a.store.putBlob(attId, new Blob(['PNGDATA'], { type: 'image/png' }));
    await addItem(a.store, { title: 'with image', type: 'note', attachments: [{ id: attId, name: 'shot.png', mime: 'image/png' }] });
    await a.engine.sync();
    await b.engine.sync();

    expect(await b.store.getBlob(attId)).toBeUndefined(); // not eagerly downloaded
    const blob = await b.engine.ensureBlob(attId);
    expect(await blob.text()).toBe('PNGDATA');
    expect(await b.store.getBlob(attId)).toBeDefined(); // now cached locally
  });

  it('keeps an item dirty when edited while its upload is in flight', async () => {
    const a = device();
    const x = await addItem(a.store, { title: 'v1', type: 'note' });
    const origUpload = a.drive.uploadItem.bind(a.drive);
    a.drive.uploadItem = async (item, fileId) => {
      await a.store.putItem({ ...x, title: 'edited-mid-flight', updated_at: x.updated_at + 99, dirty: 1 });
      return origUpload(item, fileId);
    };
    await a.engine.sync();
    const after = await a.store.getItem(x.id);
    expect(after.dirty).toBe(1);
    expect(after.title).toBe('edited-mid-flight');
  });

  it('takes a local snapshot before each sync and caps history', async () => {
    const a = device();
    await addItem(a.store, { title: 'snap', type: 'note' });
    for (let i = 0; i < 8; i++) await a.engine.sync();
    const snaps = await a.store.getMeta('snapshots');
    expect(snaps.length).toBeLessThanOrEqual(5);
    expect(snaps[0].items[0].title).toBe('snap');
  });
});
