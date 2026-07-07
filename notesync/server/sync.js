const express = require('express');
const { db, nextSeq } = require('./db');
const { requireUser } = require('./auth');

const router = express.Router();

const getItem = db.prepare('SELECT * FROM items WHERE user_id = ? AND id = ?');
const upsertItem = db.prepare(`
  INSERT INTO items (id, user_id, type, title, body, done, due, tags, deleted, updated_at, seq)
  VALUES (@id, @user_id, @type, @title, @body, @done, @due, @tags, @deleted, @updated_at, @seq)
  ON CONFLICT (user_id, id) DO UPDATE SET
    type = excluded.type, title = excluded.title, body = excluded.body,
    done = excluded.done, due = excluded.due, tags = excluded.tags,
    deleted = excluded.deleted, updated_at = excluded.updated_at, seq = excluded.seq
`);

function sanitize(raw, userId) {
  if (!raw || typeof raw.id !== 'string' || raw.id.length > 64) return null;
  if (raw.type !== 'note' && raw.type !== 'task') return null;
  return {
    id: raw.id,
    user_id: userId,
    type: raw.type,
    title: String(raw.title ?? '').slice(0, 1000),
    body: String(raw.body ?? '').slice(0, 100000),
    done: raw.done ? 1 : 0,
    due: raw.due ? String(raw.due).slice(0, 32) : null,
    tags: JSON.stringify(Array.isArray(raw.tags) ? raw.tags.slice(0, 32).map(String) : []),
    deleted: raw.deleted ? 1 : 0,
    updated_at: Number(raw.updated_at) || Date.now(),
  };
}

// Applies a client change with last-write-wins conflict resolution.
// Returns the item's new server seq, or null if the change was stale.
function applyChange(raw, userId) {
  const incoming = sanitize(raw, userId);
  if (!incoming) return null;
  const existing = getItem.get(userId, incoming.id);
  if (existing && existing.updated_at > incoming.updated_at) return null; // server copy is newer
  incoming.seq = nextSeq(userId);
  upsertItem.run(incoming);
  return incoming.seq;
}

// Delta sync: the client sends its local changes plus the last server seq it
// has seen; the server applies the changes (LWW) and returns everything that
// changed since that seq, including the outcome of this push.
router.post('/sync', requireUser, (req, res) => {
  const since = Number(req.body && req.body.since) || 0;
  const changes = Array.isArray(req.body && req.body.changes) ? req.body.changes : [];
  if (changes.length > 1000) return res.status(400).json({ error: 'too many changes in one batch' });

  const apply = db.transaction(() => changes.forEach((c) => applyChange(c, req.userId)));
  apply();

  const rows = db
    .prepare('SELECT id, type, title, body, done, due, tags, deleted, updated_at, seq FROM items WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 2000')
    .all(req.userId, since);
  const maxSeq = rows.length ? rows[rows.length - 1].seq : since;
  res.json({
    changes: rows.map((r) => ({ ...r, done: !!r.done, deleted: !!r.deleted, tags: JSON.parse(r.tags) })),
    seq: maxSeq,
    more: rows.length === 2000,
  });
});

module.exports = { router, applyChange };
