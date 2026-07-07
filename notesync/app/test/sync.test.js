// End-to-end sync tests: two simulated devices, one mock Drive.

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

beforeEach(async () => { mock = await startMockDrive(); });
afterEach(() => mock.close());

describe('two-device sync through Drive', () => {
  it('creates the folder layout and items.json on first sync', async () => {
    const a = device();
    await addItem(a.store, { title: 'hello' });
    await a.engine.sync();
    const names = [...mock._files.values()].map((f) => f.name).sort();
    expect(names).toEqual(['NoteSync', 'attachments', 'items.json']);
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

  it('merges concurrent edits on both devices (LWW per item)', async () => {
    const a = device();
    const b = device();
    const x = await addItem(a.store, { title: 'v1' });
    await a.engine.sync();
    await b.engine.sync();

    // A edits x (older), B edits x (newer), both offline, then both sync.
    await a.store.putItem({ ...x, title: 'A-edit', updated_at: x.updated_at + 10, dirty: 1 });
    const bx = await b.store.getItem(x.id);
    await b.store.putItem({ ...bx, title: 'B-edit', updated_at: x.updated_at + 20, dirty: 1 });

    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync(); // A picks up B's winning edit

    expect((await a.store.getItem(x.id)).title).toBe('B-edit');
    expect((await b.store.getItem(x.id)).title).toBe('B-edit');
  });

  it('propagates deletes as tombstones', async () => {
    const a = device();
    const b = device();
    const x = await addItem(a.store, { title: 'doomed' });
    await a.engine.sync();
    await b.engine.sync();

    await a.store.putItem({ ...(await a.store.getItem(x.id)), deleted: true, updated_at: Date.now() + 1, dirty: 1 });
    await a.engine.sync();
    await b.engine.sync();
    expect((await b.store.getItem(x.id)).deleted).toBe(true);
  });

  it('skips upload entirely when nothing changed', async () => {
    const a = device();
    await addItem(a.store, { title: 'once' });
    await a.engine.sync();
    const itemsFile = [...mock._files.values()].find((f) => f.name === 'items.json');
    const versionAfterFirst = itemsFile.version;
    await a.engine.sync();
    await a.engine.sync();
    expect(itemsFile.version).toBe(versionAfterFirst);
  });

  it('uploads attachment blobs and lazily downloads them on the other device', async () => {
    const a = device();
    const b = device();
    const attId = 'att-1';
    await a.store.putBlob(attId, new Blob(['PNGDATA'], { type: 'image/png' }));
    await addItem(a.store, { title: 'with image', attachments: [{ id: attId, name: 'shot.png', mime: 'image/png' }] });
    await a.engine.sync();
    await b.engine.sync();

    expect(await b.store.getBlob(attId)).toBeUndefined(); // not eagerly downloaded
    const blob = await b.engine.ensureBlob(attId);
    expect(await blob.text()).toBe('PNGDATA');
    expect(await b.store.getBlob(attId)).toBeDefined(); // now cached locally
  });

  it('keeps an item dirty when edited while a sync is in flight', async () => {
    const a = device();
    const x = await addItem(a.store, { title: 'v1' });
    // Simulate mid-flight edit: swap drive.uploadItems to edit during sync.
    const origUpload = a.drive.uploadItems.bind(a.drive);
    a.drive.uploadItems = async (doc) => {
      await a.store.putItem({ ...x, title: 'edited-mid-flight', updated_at: x.updated_at + 99, dirty: 1 });
      return origUpload(doc);
    };
    await a.engine.sync();
    const after = await a.store.getItem(x.id);
    expect(after.dirty).toBe(1);
    expect(after.title).toBe('edited-mid-flight');
  });
});
