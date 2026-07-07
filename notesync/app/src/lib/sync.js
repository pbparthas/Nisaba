// Sync engine: one round = probe Drive's items.json version, merge remote and
// local (LWW), push the merged doc back if it differs, then reconcile
// attachment binaries (upload local-only ones; download is lazy, see
// ensureBlob). Works against any store/drive implementing the interfaces.

import { mergeItems } from './merge.js';

export function createSyncEngine({ store, drive, onStatus = () => {} }) {
  let running = false;
  let queued = false;
  let timer = null;

  async function syncOnce() {
    const localAll = await store.allItems();
    const dirty = localAll.filter((i) => i.dirty);

    const remoteVersion = await drive.getItemsVersion();
    const knownVersion = await store.getMeta('driveVersion');
    const nothingNew = remoteVersion !== null && String(remoteVersion) === String(knownVersion);

    if (nothingNew && dirty.length === 0) {
      await reconcileAttachments(localAll);
      return;
    }

    const remoteDoc = (await drive.downloadItems()) || { schema: 1, items: [] };
    const stripped = localAll.map(({ dirty: _d, ...i }) => i);
    const { merged, winners, changedVsRemote } = mergeItems(remoteDoc.items, stripped);

    let newVersion = remoteVersion;
    if (changedVsRemote) {
      newVersion = await drive.uploadItems({ schema: 1, items: merged });
    }

    // Write merged state locally. An item edited while this sync was in
    // flight keeps its dirty flag (its updated_at no longer matches).
    const editedMidFlight = new Set();
    for (const d of dirty) {
      const current = await store.getItem(d.id);
      if (current && current.updated_at !== d.updated_at) editedMidFlight.add(d.id);
    }
    await store.putItems(
      merged
        .filter((m) => !editedMidFlight.has(m.id))
        .map((m) => ({ ...m, dirty: 0 }))
    );
    await store.setMeta('driveVersion', newVersion);

    await reconcileAttachments(merged);
    void winners;
  }

  // Upload any attachment blob we hold locally that Drive doesn't have yet.
  async function reconcileAttachments(items) {
    const wanted = new Map(); // attId -> {name}
    for (const item of items) {
      if (item.deleted) continue;
      for (const att of item.attachments || []) wanted.set(att.id, att);
    }
    if (wanted.size === 0) return;
    const remote = await drive.listAttachmentIds();
    for (const [attId, att] of wanted) {
      if (remote.has(attId)) continue;
      const blob = await store.getBlob(attId);
      if (blob) await drive.uploadAttachment(attId, att.name, blob);
    }
  }

  return {
    // Coalesces concurrent calls; safe to invoke from timers and UI events.
    async sync() {
      if (running) { queued = true; return; }
      running = true;
      onStatus('syncing');
      try {
        await syncOnce();
        onStatus('synced');
      } catch (e) {
        onStatus(e.code === 401 ? 'auth-needed' : 'offline');
        console.warn('sync failed:', e);
      } finally {
        running = false;
        if (queued) { queued = false; this.sync(); }
      }
    },

    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => this.sync(), 1500);
    },

    // Returns the attachment's blob, fetching (and caching) from Drive if
    // this device doesn't have it yet.
    async ensureBlob(attId) {
      const local = await store.getBlob(attId);
      if (local) return local;
      const remote = await drive.listAttachmentIds();
      const driveFileId = remote.get(attId);
      if (!driveFileId) return null;
      const blob = await drive.downloadAttachment(driveFileId);
      await store.putBlob(attId, blob);
      return blob;
    },
  };
}
