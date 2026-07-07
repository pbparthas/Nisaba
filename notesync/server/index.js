const express = require('express');
const path = require('path');
const auth = require('./auth');
const sync = require('./sync');
const integrations = require('./integrations');

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth', auth.router);
app.use('/api', sync.router);
app.use('/api/ext', integrations.router);
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NoteSync server on http://localhost:${PORT}`));
