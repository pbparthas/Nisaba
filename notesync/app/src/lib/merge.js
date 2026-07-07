// Pure last-write-wins merge of two item collections (remote wins ties, so
// every device converges on the same winner). Items are never removed here —
// deletion is a tombstone (`deleted: true`) like any other field change.

export function mergeItems(remoteItems, localItems) {
  const byId = new Map();
  for (const r of remoteItems) byId.set(r.id, { item: r, source: 'remote' });
  for (const l of localItems) {
    const existing = byId.get(l.id);
    if (!existing || l.updated_at > existing.item.updated_at) {
      byId.set(l.id, { item: l, source: 'local' });
    }
  }
  const merged = [...byId.values()].map((e) => e.item);
  const winners = new Map([...byId.entries()].map(([id, e]) => [id, e.source]));

  // Does the merged set differ from what the remote already has?
  const remoteById = new Map(remoteItems.map((r) => [r.id, r]));
  const changedVsRemote =
    merged.length !== remoteItems.length ||
    merged.some((m) => {
      const r = remoteById.get(m.id);
      return !r || r.updated_at !== m.updated_at;
    });

  return { merged, winners, changedVsRemote };
}

export function newItem(partial) {
  return {
    id: crypto.randomUUID(),
    type: 'note',
    title: '',
    body: '',
    done: false,
    due: null,
    tags: [],
    attachments: [], // [{id, name, mime}] — binary lives beside items.json in Drive
    deleted: false,
    updated_at: Date.now(),
    ...partial,
  };
}
