// Trash retention + GC/compaction: tombstones past the window (or explicitly
// purged) are permanently removed, and unreferenced attachments are freed —
// locally and in Drive. Trashed-but-recent items and their images survive so
// Restore works.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startMockDrive } from './mock-drive.js';
import { createMemoryStore } from '../src/lib/store-memory.js';
import { createDriveClient } from '../src/lib/drive.js';
import { createSyncEngine } from '../src/lib/sync.js';
import { newItem } from '../src/lib/merge.js';

let mock;
const DAY = 24 * 60 * 60 * 1000;

function device() {
  const store = createMemoryStore();
  const drive = createDriveClient({ getToken: async () => 'test-token', baseUrl: mock.baseUrl });
  const engine = createSyncEngine({ store, drive });
  return { store, drive, engine };
}
const itemFiles = () => [...mock._files.values()].filter((f) => f.name.endsWith('.json') && f.name !== 'schema.json');
const attFiles = () => [...mock._files.values()].filter((f) => f.name.includes('__'));

async function noteWithImage(store, { id, deleted = false, deleted_at = null } = {}) {
  const attId = 'att-' + (id || 'x');
  const item = { ...newItem({ type: 'note', title: id || 'n' }), id: id || undefined, deleted, deleted_at, attachments: [{ id: attId, name: 'shot.png', mime: 'image/png' }], dirty: 1 };
  await store.putBlob(attId, new Blob(['png-bytes'], { type: 'image/png' }));
  await store.putItem(item);
  return { item, attId };
}

beforeEach(async () => { mock = await startMockDrive(); });
afterEach(() => mock.close());

describe('Trash retention + GC', () => {
  it('purges a tombstone past the retention window and frees its attachment (local + Drive)', async () => {
    const a = device();
    const { item, attId } = await noteWithImage(a.store, { id: 'old' });
    await a.engine.sync(); // upload item + attachment
    expect(itemFiles().length).toBe(1);
    expect(attFiles().length).toBe(1);

    // delete it 31 days ago
    await a.store.putItem({ ...item, deleted: true, deleted_at: Date.now() - 31 * DAY, dirty: 1 });
    await a.engine.sync();               // push the tombstone to Drive
    await a.engine.gc({ force: true });  // compact

    expect(await a.store.getItem('old')).toBeUndefined();     // local record gone
    expect(await a.store.getBlob(attId)).toBeUndefined();     // local blob gone
    expect(itemFiles().length).toBe(0);                       // Drive JSON gone
    expect(attFiles().length).toBe(0);                        // Drive attachment gone
  });

  it('keeps a recently-trashed item and its image (restorable)', async () => {
    const a = device();
    const { attId } = await noteWithImage(a.store, { id: 'recent' });
    await a.engine.sync();
    await a.store.putItem({ ...(await a.store.getItem('recent')), deleted: true, deleted_at: Date.now(), dirty: 1 });
    await a.engine.sync();
    await a.engine.gc({ force: true });

    const still = await a.store.getItem('recent');
    expect(still?.deleted).toBe(true);                 // still in Trash
    expect(await a.store.getBlob(attId)).toBeTruthy(); // image kept for Restore
    expect(attFiles().length).toBe(1);
  });

  it('purge() deletes forever immediately, regardless of age', async () => {
    const a = device();
    const { item } = await noteWithImage(a.store, { id: 'now' });
    await a.engine.sync();
    await a.store.putItem({ ...item, deleted: true, deleted_at: Date.now(), dirty: 1 });
    await a.engine.sync();
    await a.engine.purge(['now']);

    expect(await a.store.getItem('now')).toBeUndefined();
    expect(itemFiles().length).toBe(0);
    expect(attFiles().length).toBe(0);
  });

  it('frees an orphan blob no item references', async () => {
    const a = device();
    await a.store.putBlob('orphan', new Blob(['x'], { type: 'image/png' }));
    await a.engine.gc({ force: true });
    expect(await a.store.getBlob('orphan')).toBeUndefined();
  });

  it('throttles background gc but force overrides', async () => {
    const a = device();
    await a.store.setMeta('lastGc', Date.now());
    await a.store.putBlob('orphan', new Blob(['x']));
    await a.engine.gc();                 // throttled — no-op
    expect(await a.store.getBlob('orphan')).toBeTruthy();
    await a.engine.gc({ force: true });  // forced
    expect(await a.store.getBlob('orphan')).toBeUndefined();
  });
});
