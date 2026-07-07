// Sync engine: push local dirty items, pull server changes since our cursor,
// resolve conflicts by last-write-wins on updated_at. Safe to call anytime;
// it no-ops without a session and coalesces concurrent calls.
const Sync = (() => {
  let running = false;
  let queued = false;
  let timer = null;
  const listeners = [];

  const session = {
    get token() { return localStorage.getItem('ns_token'); },
    get email() { return localStorage.getItem('ns_email'); },
    set(token, email) { localStorage.setItem('ns_token', token); localStorage.setItem('ns_email', email); },
    clear() { localStorage.removeItem('ns_token'); localStorage.removeItem('ns_email'); },
  };

  function onStatus(fn) { listeners.push(fn); }
  function emit(status) { listeners.forEach((fn) => fn(status)); }

  async function syncNow() {
    if (!session.token || !navigator.onLine) return;
    if (running) { queued = true; return; }
    running = true;
    emit('syncing');
    try {
      let more = true;
      while (more) {
        const since = (await Store.getMeta('seq')) || 0;
        const all = await Store.all();
        const dirty = all.filter((i) => i.dirty);
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token },
          body: JSON.stringify({ since, changes: dirty.map(({ dirty: _d, ...item }) => item) }),
        });
        if (res.status === 401) { session.clear(); emit('logged-out'); return; }
        if (!res.ok) throw new Error('sync failed: ' + res.status);
        const data = await res.json();

        // Clear dirty flags, but only for items unchanged since we read them —
        // an edit made mid-flight stays dirty for the next pass.
        const pushedAt = new Map(dirty.map((i) => [i.id, i.updated_at]));
        for (const item of dirty) {
          const current = await Store.get(item.id);
          if (current && current.updated_at === pushedAt.get(item.id)) {
            await Store.put({ ...current, dirty: 0 });
          }
        }

        // Apply pulled changes with the same LWW rule the server uses.
        for (const incoming of data.changes) {
          const local = await Store.get(incoming.id);
          if (local && local.dirty && local.updated_at > incoming.updated_at) continue;
          await Store.put({ ...incoming, dirty: 0 });
        }
        await Store.setMeta('seq', data.seq);
        more = data.more;
      }
      emit('synced');
    } catch (e) {
      console.warn(e);
      emit('offline');
    } finally {
      running = false;
      if (queued) { queued = false; syncNow(); }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 800);
  }

  // Sign in on this device: local items are re-flagged dirty so they merge
  // into the account, and the cursor resets so we pull the full account state.
  async function startSession(token, email) {
    session.set(token, email);
    const all = await Store.all();
    await Store.putMany(all.map((i) => ({ ...i, dirty: 1 })));
    await Store.setMeta('seq', 0);
    await syncNow();
  }

  async function endSession() {
    session.clear();
    await Store.clear(); // account data lives on the server; keep devices clean for the next user
  }

  window.addEventListener('online', syncNow);
  setInterval(syncNow, 30000);

  return { syncNow, schedule, startSession, endSession, session, onStatus };
})();
