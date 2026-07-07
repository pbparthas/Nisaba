/* UI layer: renders from IndexedDB, writes through Store, lets Sync handle the rest. */
const $ = (sel) => document.querySelector(sel);

let editingId = null;

// ---------- data helpers ----------
async function saveItem(partial) {
  const now = Date.now();
  const existing = partial.id ? await Store.get(partial.id) : null;
  const item = {
    id: partial.id || crypto.randomUUID(),
    type: partial.type || (existing && existing.type) || 'note',
    title: '', body: '', done: false, due: null, tags: [], deleted: false,
    ...existing, ...partial,
    updated_at: now, dirty: 1,
  };
  await Store.put(item);
  Sync.schedule();
  render();
  return item;
}

// ---------- rendering ----------
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function render() {
  const items = (await Store.all()).filter((i) => !i.deleted);

  const notes = items.filter((i) => i.type === 'note').sort((a, b) => b.updated_at - a.updated_at);
  $('#notes-list').innerHTML = notes.map((n) => `
    <li data-id="${n.id}">
      <div class="body">
        <h3>${esc(n.title) || '<em>Untitled</em>'}</h3>
        <p>${n.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}${esc(n.body.slice(0, 120))}</p>
      </div>
    </li>`).join('') || '<p class="muted">No notes yet.</p>';

  const today = new Date().toISOString().slice(0, 10);
  const tasks = items.filter((i) => i.type === 'task')
    .sort((a, b) => (a.done - b.done) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || b.updated_at - a.updated_at);
  $('#tasks-list').innerHTML = tasks.map((t) => `
    <li data-id="${t.id}" class="${t.done ? 'done' : ''}">
      <input type="checkbox" ${t.done ? 'checked' : ''}>
      <div class="body"><h3>${esc(t.title)}</h3></div>
      ${t.due ? `<span class="due ${!t.done && t.due < today ? 'overdue' : ''}">${esc(t.due)}</span>` : ''}
    </li>`).join('') || '<p class="muted">No tasks yet.</p>';
}

// ---------- notes ----------
function openEditor(item) {
  editingId = item.id;
  $('#editor-title').value = item.title;
  $('#editor-body').value = item.body;
  $('#editor-tags').value = item.tags.join(', ');
  $('#editor').classList.remove('hidden');
  $('#editor-title').focus();
}

async function closeEditor(save = true) {
  if (save && editingId) {
    const tags = $('#editor-tags').value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    const current = await Store.get(editingId);
    const title = $('#editor-title').value, body = $('#editor-body').value;
    if (current && (current.title !== title || current.body !== body || JSON.stringify(current.tags) !== JSON.stringify(tags))) {
      await saveItem({ id: editingId, title, body, tags });
    }
  }
  editingId = null;
  $('#editor').classList.add('hidden');
}

$('#new-note').onclick = async () => openEditor(await saveItem({ type: 'note' }));
$('#editor-close').onclick = () => closeEditor();
$('#editor-delete').onclick = async () => { await saveItem({ id: editingId, deleted: true }); editingId = null; $('#editor').classList.add('hidden'); };
$('#notes-list').onclick = async (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openEditor(await Store.get(li.dataset.id));
};

// ---------- tasks ----------
$('#new-task-form').onsubmit = async (e) => {
  e.preventDefault();
  const title = $('#new-task-title').value.trim();
  if (!title) return;
  await saveItem({ type: 'task', title, due: $('#new-task-due').value || null });
  $('#new-task-title').value = '';
  $('#new-task-due').value = '';
};

$('#tasks-list').onclick = async (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  if (e.target.type === 'checkbox') {
    await saveItem({ id: li.dataset.id, done: e.target.checked });
  } else if (confirm('Delete this task?')) {
    await saveItem({ id: li.dataset.id, deleted: true });
  }
};

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === tab.dataset.tab + '-view'));
  };
});

// ---------- account & auth ----------
function refreshAccountUI() {
  const signedIn = !!Sync.session.token;
  $('#account-btn').textContent = signedIn ? (Sync.session.email || 'Account') : 'Sign in';
  $('#auth-forms').classList.toggle('hidden', signedIn);
  $('#account-info').classList.toggle('hidden', !signedIn);
  if (signedIn) { $('#account-email').textContent = Sync.session.email; loadTokens(); }
  if (!signedIn) $('#sync-status').textContent = 'local only';
}

async function authenticate(path) {
  $('#auth-error').textContent = '';
  try {
    const res = await fetch('/api/auth/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#auth-email').value, password: $('#auth-password').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'failed');
    await Sync.startSession(data.token, data.email);
    refreshAccountUI();
    render();
  } catch (e) {
    $('#auth-error').textContent = e.message;
  }
}

$('#account-btn').onclick = () => { refreshAccountUI(); $('#account').classList.remove('hidden'); };
$('#account-close').onclick = () => $('#account').classList.add('hidden');
$('#login-btn').onclick = () => authenticate('login');
$('#register-btn').onclick = () => authenticate('register');
$('#logout-btn').onclick = async () => {
  if (!confirm('Sign out? Local data on this device will be cleared (it stays in your account).')) return;
  await Sync.endSession();
  refreshAccountUI();
  render();
};

// ---------- API tokens (Enki integration) ----------
async function loadTokens() {
  const res = await fetch('/api/auth/tokens', { headers: { Authorization: 'Bearer ' + Sync.session.token } });
  if (!res.ok) return;
  const tokens = await res.json();
  $('#token-list').innerHTML = tokens.map((t) =>
    `<li><span>${esc(t.name)}</span><button data-id="${t.id}" class="danger">Revoke</button></li>`).join('');
}

$('#token-create').onclick = async () => {
  const res = await fetch('/api/auth/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Sync.session.token },
    body: JSON.stringify({ name: $('#token-name').value || 'integration' }),
  });
  const data = await res.json();
  $('#token-new').textContent = 'Copy this token now — it is shown only once: ' + data.token;
  $('#token-new').classList.remove('hidden');
  $('#token-name').value = '';
  loadTokens();
};

$('#token-list').onclick = async (e) => {
  if (!e.target.dataset.id) return;
  await fetch('/api/auth/tokens/' + e.target.dataset.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + Sync.session.token } });
  loadTokens();
};

// ---------- sync status ----------
Sync.onStatus((status) => {
  const el = $('#sync-status');
  el.className = 'status ' + status;
  if (status === 'logged-out') { refreshAccountUI(); return; }
  el.textContent = { syncing: 'syncing…', synced: 'synced', offline: 'offline' }[status] || status;
  if (status === 'synced') render();
});

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
refreshAccountUI();
render();
Sync.syncNow();
