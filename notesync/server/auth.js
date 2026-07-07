const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db, JWT_SECRET } = require('./db');

const router = express.Router();

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

router.post('/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const info = db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(email.trim(), bcrypt.hashSync(password, 10));
    const user = { id: info.lastInsertRowid, email: email.trim() };
    res.json({ token: issueToken(user), email: user.email });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'account already exists' });
    throw e;
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  res.json({ token: issueToken(user), email: user.email });
});

// Session auth for the app itself (JWT from login).
function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired session' });
  }
}

// API-token auth for external integrations such as Enki.
function requireApiToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !token.startsWith('nsk_')) return res.status(401).json({ error: 'API token required' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare('SELECT user_id FROM api_tokens WHERE token_hash = ?').get(hash);
  if (!row) return res.status(401).json({ error: 'invalid API token' });
  req.userId = row.user_id;
  next();
}

// Personal access token management (used from the app's Settings panel).
router.post('/tokens', requireUser, (req, res) => {
  const name = (req.body && req.body.name || 'integration').slice(0, 64);
  const token = 'nsk_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const info = db.prepare('INSERT INTO api_tokens (user_id, name, token_hash) VALUES (?, ?, ?)').run(req.userId, name, hash);
  // The raw token is returned exactly once; only its hash is stored.
  res.json({ id: info.lastInsertRowid, name, token });
});

router.get('/tokens', requireUser, (req, res) => {
  res.json(db.prepare('SELECT id, name, created_at FROM api_tokens WHERE user_id = ?').all(req.userId));
});

router.delete('/tokens/:id', requireUser, (req, res) => {
  db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

module.exports = { router, requireUser, requireApiToken };
