// IndexedDB store: items (notes/tasks), blobs (attachment binaries), meta
// (sync cursor, settings). Same interface as store-memory.js.

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('notesync', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp;
async function tx(storeName, mode, fn) {
  dbp = dbp || open();
  const db = await dbp;
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const request = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(request && 'result' in request ? request.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export function createIdbStore() {
  return {
    allItems: () => tx('items', 'readonly', (s) => s.getAll()),
    getItem: (id) => tx('items', 'readonly', (s) => s.get(id)),
    putItem: (item) => tx('items', 'readwrite', (s) => s.put(item)),
    putItems: (list) => tx('items', 'readwrite', (s) => { list.forEach((i) => s.put(i)); }),
    dirtyItems: async function () { return (await this.allItems()).filter((i) => i.dirty); },
    putBlob: (id, blob) => tx('blobs', 'readwrite', (s) => s.put(blob, id)),
    getBlob: (id) => tx('blobs', 'readonly', (s) => s.get(id)),
    blobIds: () => tx('blobs', 'readonly', (s) => s.getAllKeys()),
    getMeta: (key) => tx('meta', 'readonly', (s) => s.get(key)),
    setMeta: (key, value) => tx('meta', 'readwrite', (s) => s.put(value, key)),
    clearAll: async () => {
      await tx('items', 'readwrite', (s) => s.clear());
      await tx('blobs', 'readwrite', (s) => s.clear());
      await tx('meta', 'readwrite', (s) => s.clear());
    },
  };
}
