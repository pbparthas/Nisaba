// Per-item conflict resolution (plan v2, Joplin-style): when a remote item
// arrives, decide what the local store should hold. Rules:
//   - local copy untouched since last sync  -> remote wins outright
//   - both sides changed, note              -> newer wins, loser preserved as a
//                                              visible conflict copy (data is
//                                              never silently discarded)
//   - both sides changed, task              -> newer wins (a checkbox/title race
//                                              doesn't merit a duplicate task)
//   - equal timestamps                      -> remote wins so devices converge

// Note bodies are BlockNote block trees (objects) since phase 2, so they must
// be compared by value — a reference compare (older.body !== newer.body) is
// always true for two structurally-identical trees, which turned every edit
// pulled back from Drive into a spurious "(conflict copy)". Empty forms
// (null / '' / []) all count as equal.
function bodyEqual(a, b) {
  const norm = (x) => (x == null || x === '' ? '' : typeof x === 'string' ? x : JSON.stringify(x));
  return norm(a) === norm(b);
}

export function resolveItem(remote, local) {
  if (!local || !local.dirty) return { winner: remote, conflictCopy: null };

  const [newer, older] = local.updated_at > remote.updated_at ? [local, remote] : [remote, local];
  const contentDiffers =
    older.title !== newer.title || !bodyEqual(older.body, newer.body) ||
    JSON.stringify(older.tags) !== JSON.stringify(newer.tags);

  const conflictCopy =
    newer.type === 'note' && !older.deleted && !newer.deleted && contentDiffers
      ? {
          ...older,
          id: crypto.randomUUID(),
          title: `${older.title || 'Untitled'} (conflict copy)`,
          attachments: older.attachments || [],
          updated_at: Date.now(),
        }
      : null;

  return { winner: newer, conflictCopy };
}

export function newItem(partial) {
  return {
    schema: 1,
    id: crypto.randomUUID(),
    type: 'note',
    title: '',
    body: '',
    done: false,
    due: null,
    subtasks: [], // [{id, title, done}] — checklist under a task, syncs with it
    tags: [],
    attachments: [], // [{id, name, mime}] — binary lives in Drive attachments/
    color: null, // per-note background palette key
    deleted: false,
    deleted_at: null, // when tombstoned — drives Trash retention + GC compaction
    created_at: Date.now(),
    updated_at: Date.now(),
    ...partial,
  };
}
