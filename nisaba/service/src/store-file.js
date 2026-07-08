// File-backed store implementing the same interface as the app's
// store-idb.js / store-memory.js, so the shared sync engine drives it
// unchanged. Everything lands as plain files on disk (durability rule: the
// local replica stays readable without the app, just like the Drive copy):
//
//   <dir>/items/<id>.json       one note or task (includes its `dirty` flag)
//   <dir>/blobs/<id>            attachment bytes   (+ <id>.type sidecar = mime)
//   <dir>/meta/<key>.json       sync bookkeeping (driveVersions, snapshots)
//
// Writes are atomic (temp file + rename) so a crash mid-write never corrupts
// an item.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const enc = (s) => encodeURIComponent(s); // ids are UUIDs, but be safe on disk

export function createFileStore(dir) {
  const itemsDir = path.join(dir, 'items');
  const blobsDir = path.join(dir, 'blobs');
  const metaDir = path.join(dir, 'meta');

  async function ensureDirs() {
    await Promise.all([
      fs.mkdir(itemsDir, { recursive: true }),
      fs.mkdir(blobsDir, { recursive: true }),
      fs.mkdir(metaDir, { recursive: true }),
    ]);
  }
  const ready = ensureDirs();

  async function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  async function readJson(file) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async function listJson(d) {
    let names;
    try {
      names = await fs.readdir(d);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const out = [];
    for (const n of names) {
      if (!n.endsWith('.json') || n.endsWith('.tmp')) continue;
      const obj = await readJson(path.join(d, n));
      if (obj) out.push(obj);
    }
    return out;
  }

  const itemFile = (id) => path.join(itemsDir, `${enc(id)}.json`);
  const blobFile = (id) => path.join(blobsDir, enc(id));
  const metaFile = (key) => path.join(metaDir, `${enc(key)}.json`);

  return {
    async allItems() {
      await ready;
      return listJson(itemsDir);
    },
    async getItem(id) {
      await ready;
      return readJson(itemFile(id));
    },
    async putItem(item) {
      await ready;
      await writeAtomic(itemFile(item.id), JSON.stringify(item));
    },
    async putItems(list) {
      await ready;
      for (const i of list) await writeAtomic(itemFile(i.id), JSON.stringify(i));
    },
    async deleteItem(id) {
      await ready;
      await fs.rm(itemFile(id), { force: true });
    },
    async dirtyItems() {
      const items = await this.allItems();
      return items.filter((i) => i.dirty);
    },
    async putBlob(id, blob) {
      await ready;
      const buf = Buffer.from(await blob.arrayBuffer());
      await writeAtomic(blobFile(id), buf);
      if (blob.type) await writeAtomic(`${blobFile(id)}.type`, blob.type);
    },
    async getBlob(id) {
      await ready;
      try {
        const buf = await fs.readFile(blobFile(id));
        let type = '';
        try { type = await fs.readFile(`${blobFile(id)}.type`, 'utf8'); } catch { /* none */ }
        return new Blob([buf], type ? { type } : undefined);
      } catch (e) {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      }
    },
    async deleteBlob(id) {
      await ready;
      await fs.rm(blobFile(id), { force: true });
      await fs.rm(`${blobFile(id)}.type`, { force: true });
    },
    async blobIds() {
      await ready;
      const names = await fs.readdir(blobsDir).catch(() => []);
      return names.filter((n) => !n.endsWith('.type')).map((n) => decodeURIComponent(n));
    },
    async getMeta(key) {
      await ready;
      return readJson(metaFile(key));
    },
    async setMeta(key, value) {
      await ready;
      await writeAtomic(metaFile(key), JSON.stringify(value));
    },
    async clearAll() {
      await fs.rm(dir, { recursive: true, force: true });
      await ensureDirs();
    },
  };
}
