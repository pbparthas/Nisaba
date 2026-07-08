// Sync engine (plan v2): one round =
//   1. snapshot local items (cheap rollback insurance, SiYuan discipline)
//   2. list Drive's items/ folder — the listing IS the manifest
//   3. pull items whose Drive version moved; resolve against local per item
//      (conflict copies for notes, see merge.js)
//   4. push local dirty items, one file each; record new versions
//   5. reconcile attachment binaries (upload local-only; download is lazy)
// Works against any store/drive implementing the interfaces.

import { resolveItem } from './merge.js';

const SNAPSHOT_KEEP = 5;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // deleted items sit in Trash 30 days
const GC_THROTTLE_MS = 6 * 60 * 60 * 1000;     // background GC runs at most this often

export function createSyncEngine({ store, drive, onStatus = () => {} }) {
  let running = false;
  let queued = false;
  let timer = null;

  async function snapshot() {
    const items = await store.allItems();
    if (items.length === 0) return;
    const snaps = (await store.getMeta('snapshots')) || [];
    snaps.push({ at: Date.now(), items });
    await store.setMeta('snapshots', snaps.slice(-SNAPSHOT_KEEP));
  }

  async function syncOnce() {
    await snapshot();

    const remote = await drive.listItems(); // itemId -> {fileId, version}
    const known = (await store.getMeta('driveVersions')) || {}; // itemId -> {fileId, version}
    const nextKnown = { ...known };

    // Pull: anything whose Drive version differs from what we last saw.
    for (const [itemId, { fileId, version }] of remote) {
      if (known[itemId]?.version === version) continue;
      const incoming = await drive.downloadItem(fileId);
      const local = await store.getItem(itemId);
      const { winner, conflictCopy } = resolveItem(incoming, local);
      if (winner === incoming) {
        await store.putItem({ ...incoming, dirty: 0 });
      }
      // A local winner stays dirty and gets pushed below.
      if (conflictCopy) await store.putItem({ ...conflictCopy, dirty: 1 });
      nextKnown[itemId] = { fileId, version };
    }

    // Push: every dirty item becomes one file upload.
    for (const item of await store.dirtyItems()) {
      const { dirty: _d, ...clean } = item;
      const existing = remote.get(item.id) || known[item.id];
      const uploaded = await drive.uploadItem(clean, existing?.fileId);
      nextKnown[item.id] = uploaded;
      // Clear the flag only if the item wasn't edited while uploading.
      const current = await store.getItem(item.id);
      if (current && current.updated_at === item.updated_at) {
        await store.putItem({ ...current, dirty: 0 });
      }
    }

    await store.setMeta('driveVersions', nextKnown);
    await reconcileAttachments(await store.allItems());
  }

  // Garbage-collect: permanently remove tombstones past the Trash retention
  // window (or an explicit purge set) and free any attachment no longer
  // referenced by a surviving item — locally and in Drive. Compaction only
  // drops the local item once its Drive file is actually gone, so local and
  // Drive can't disagree (avoids a purged tombstone getting re-pulled).
  async function gcOnce(purgeIds) {
    const items = await store.allItems();
    const known = (await store.getMeta('driveVersions')) || {};
    const now = Date.now();
    const nextKnown = { ...known };
    const remaining = [];

    for (const item of items) {
      const pastRetention = now - (item.deleted_at || item.updated_at) >= RETENTION_MS;
      const purge = item.deleted && (purgeIds ? purgeIds.has(item.id) : pastRetention);
      if (!purge) { remaining.push(item); continue; }
      const fileId = known[item.id]?.fileId;
      // deleteFile swallows 404; a network error rejects → keep the item and
      // retry next round so we never orphan the Drive tombstone.
      const driveOk = fileId ? await drive.deleteFile(fileId).then(() => true).catch(() => false) : true;
      if (driveOk) { await store.deleteItem(item.id); delete nextKnown[item.id]; }
      else remaining.push(item);
    }
    await store.setMeta('driveVersions', nextKnown);

    // Attachments still wanted by a surviving item (including trashed-but-not-
    // yet-purged ones, so Restore keeps its images).
    const wanted = new Set();
    for (const item of remaining) for (const att of item.attachments || []) wanted.add(att.id);
    for (const blobId of await store.blobIds()) if (!wanted.has(blobId)) await store.deleteBlob(blobId);
    const remoteAtt = await drive.listAttachmentIds().catch(() => null);
    if (remoteAtt) for (const [attId, fileId] of remoteAtt) if (!wanted.has(attId)) await drive.deleteFile(fileId).catch(() => {});

    return { purged: items.length - remaining.length };
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
        if (e.code === 401) onStatus('auth-needed');
        else if (e.code === 'schema') onStatus('update-needed');
        else onStatus('offline');
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

    // Background compaction — best-effort, throttled. Call after a sync so the
    // local replica reflects Drive (else attachment GC could race a not-yet-
    // pulled item). RETENTION_MS is the Trash window.
    async gc({ force = false } = {}) {
      const last = Number(await store.getMeta('lastGc')) || 0;
      if (!force && Date.now() - last < GC_THROTTLE_MS) return;
      try { await gcOnce(null); await store.setMeta('lastGc', Date.now()); }
      catch (e) { console.warn('gc failed:', e); }
    },

    // Immediately purge specific items ("delete forever" from Trash).
    async purge(ids) { await gcOnce(new Set(ids)); },

    retentionMs: RETENTION_MS,

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
