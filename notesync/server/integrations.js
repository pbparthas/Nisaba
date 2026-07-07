const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');
const { requireApiToken } = require('./auth');
const { applyChange } = require('./sync');

// External integration API (e.g. Enki). Authenticated with a personal access
// token created in the app's Settings panel: Authorization: Bearer nsk_...
// Writes go through applyChange so synced clients pick them up like any other
// device's edits.
const router = express.Router();
router.use(requireApiToken);

const listStmt = db.prepare(
  'SELECT id, type, title, body, done, due, tags, updated_at FROM items WHERE user_id = ? AND type = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT 500'
);

function present(row) {
  return { ...row, done: !!row.done, tags: JSON.parse(row.tags) };
}

router.get('/notes', (req, res) => {
  res.json(listStmt.all(req.userId, 'note').map(present));
});

router.post('/notes', (req, res) => {
  const { title, body, tags } = req.body || {};
  const id = crypto.randomUUID();
  applyChange({ id, type: 'note', title, body, tags, updated_at: Date.now() }, req.userId);
  res.status(201).json({ id });
});

router.get('/tasks', (req, res) => {
  res.json(listStmt.all(req.userId, 'task').map(present));
});

router.post('/tasks', (req, res) => {
  const { title, due, tags } = req.body || {};
  const id = crypto.randomUUID();
  applyChange({ id, type: 'task', title, due, tags, updated_at: Date.now() }, req.userId);
  res.status(201).json({ id });
});

// Partial update: only the provided fields change; everything else is kept.
router.patch('/items/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM items WHERE user_id = ? AND id = ? AND deleted = 0').get(req.userId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const patch = req.body || {};
  applyChange(
    {
      ...existing,
      tags: JSON.parse(existing.tags),
      done: !!existing.done,
      ...('title' in patch ? { title: patch.title } : {}),
      ...('body' in patch ? { body: patch.body } : {}),
      ...('done' in patch ? { done: patch.done } : {}),
      ...('due' in patch ? { due: patch.due } : {}),
      ...('tags' in patch ? { tags: patch.tags } : {}),
      updated_at: Date.now(),
    },
    req.userId
  );
  res.json({ ok: true });
});

router.delete('/items/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM items WHERE user_id = ? AND id = ?').get(req.userId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  applyChange({ ...existing, tags: JSON.parse(existing.tags), deleted: true, updated_at: Date.now() }, req.userId);
  res.json({ ok: true });
});

module.exports = { router };
