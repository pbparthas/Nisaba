// In-memory store implementing the same interface as store-idb.js.
// Used by tests and available to the future desktop/MCP process.

export function createMemoryStore() {
  const items = new Map();
  const blobs = new Map();
  const meta = new Map();
  return {
    async allItems() { return [...items.values()].map((i) => ({ ...i })); },
    async getItem(id) { const i = items.get(id); return i ? { ...i } : undefined; },
    async putItem(item) { items.set(item.id, { ...item }); },
    async putItems(list) { for (const i of list) items.set(i.id, { ...i }); },
    async dirtyItems() { return [...items.values()].filter((i) => i.dirty).map((i) => ({ ...i })); },
    async putBlob(id, blob) { blobs.set(id, blob); },
    async getBlob(id) { return blobs.get(id); },
    async blobIds() { return [...blobs.keys()]; },
    async getMeta(key) { return meta.get(key); },
    async setMeta(key, value) { meta.set(key, value); },
    async clearAll() { items.clear(); blobs.clear(); meta.clear(); },
  };
}
