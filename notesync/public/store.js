// Local-first storage on IndexedDB. Every item lives here first; the sync
// engine ships rows flagged `dirty` to the server when a session exists.
const Store = (() => {
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('notesync', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
      t.onerror = () => reject(t.error);
    });
  }

  function reqValue(req) {
    const holder = {};
    req.onsuccess = () => { holder.__value = req.result; };
    return holder;
  }

  return {
    all: () => tx('items', 'readonly', (s) => reqValue(s.getAll())),
    put: (item) => tx('items', 'readwrite', (s) => s.put(item)),
    putMany: (items) => tx('items', 'readwrite', (s) => items.forEach((i) => s.put(i))),
    get: (id) => tx('items', 'readonly', (s) => reqValue(s.get(id))),
    clear: async () => { await tx('items', 'readwrite', (s) => s.clear()); await tx('meta', 'readwrite', (s) => s.clear()); },
    getMeta: async (key) => { const r = await tx('meta', 'readonly', (s) => reqValue(s.get(key))); return r ? r.value : undefined; },
    setMeta: (key, value) => tx('meta', 'readwrite', (s) => s.put({ key, value })),
  };
})();
