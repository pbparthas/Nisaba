import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createIdbStore } from './lib/store-idb.js';
import { createAuth } from './lib/auth.js';
import { createDriveClient } from './lib/drive.js';
import { createSyncEngine } from './lib/sync.js';
import { newItem } from './lib/merge.js';

const store = createIdbStore();

// The owner's OAuth Client ID (public by design — it only identifies the app
// to Google; access still requires signing in to the matching account).
// A different deployment can override it from the first-run screen, which
// stores the override in localStorage.
const DEFAULT_CLIENT_ID = '652122307592-300cfvid9hl2s4t59hm9c4mivbtm3beq.apps.googleusercontent.com';

export default function App() {
  const [clientId, setClientId] = useState(() => localStorage.getItem('ns_client_id') || DEFAULT_CLIENT_ID);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState('local only');
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('notes');
  const [editing, setEditing] = useState(null); // item being edited in the note editor

  const { auth, engine } = useMemo(() => {
    if (!clientId) return {};
    const auth = createAuth(clientId);
    const drive = createDriveClient({ getToken: () => auth.getToken() });
    const engine = createSyncEngine({
      store,
      drive,
      onStatus: (s) => {
        if (s === 'auth-needed') { setSignedIn(false); setStatus('sign in to sync'); }
        else setStatus(s);
        if (s === 'synced') refresh();
      },
    });
    return { auth, drive, engine };
  }, [clientId]);

  const refresh = useCallback(async () => {
    setItems((await store.allItems()).filter((i) => !i.deleted));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!auth?.isSignedIn()) return;
    setSignedIn(true);
    engine.sync();
    const t = setInterval(() => engine.sync(), 30000);
    const onFocus = () => engine.sync();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [auth, engine]);

  async function saveItem(partial) {
    const existing = partial.id ? await store.getItem(partial.id) : null;
    const item = { ...(existing || newItem({})), ...partial, updated_at: Date.now(), dirty: 1 };
    await store.putItem(item);
    engine?.schedule();
    await refresh();
    return item;
  }

  async function signIn() {
    try {
      await auth.signIn();
      setSignedIn(true);
      engine.sync();
    } catch (e) {
      setStatus('sign-in failed: ' + e.message);
    }
  }

  if (!clientId) return <SetupScreen onSave={(id) => { localStorage.setItem('ns_client_id', id); setClientId(id); }} />;

  const notes = items.filter((i) => i.type === 'note').sort((a, b) => b.updated_at - a.updated_at);
  const tasks = items.filter((i) => i.type === 'task')
    .sort((a, b) => (a.done - b.done) || String(a.due || '~').localeCompare(String(b.due || '~')));

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Nisaba</h1>
        <span className={'status ' + status.split(' ')[0]}>{status}</span>
        {signedIn
          ? <button className="ghost" onClick={() => { auth.signOut(); setSignedIn(false); setStatus('local only'); }}>Sign out</button>
          : <button className="primary" onClick={signIn}>Connect Google Drive</button>}
      </header>

      <nav className="tabs">
        {['notes', 'tasks'].map((t) => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'notes' && (
          <>
            <button className="primary wide" onClick={async () => setEditing(await saveItem({ type: 'note' }))}>+ New note</button>
            <ul className="items">
              {notes.map((n) => (
                <li key={n.id} onClick={() => setEditing(n)}>
                  <div className="body">
                    <h3>{n.title || <em>Untitled</em>}</h3>
                    <p>
                      {(n.attachments || []).length > 0 && <span className="tag">📎{n.attachments.length}</span>}
                      {n.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
                      {(n.body || '').slice(0, 120)}
                    </p>
                  </div>
                </li>
              ))}
              {notes.length === 0 && <p className="muted">No notes yet.</p>}
            </ul>
          </>
        )}

        {tab === 'tasks' && <Tasks tasks={tasks} saveItem={saveItem} />}
      </main>

      {editing && (
        <NoteEditor
          item={editing}
          engine={engine}
          saveItem={saveItem}
          onClose={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function Tasks({ tasks, saveItem }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <form className="task-form" onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        await saveItem({ ...newItem({ type: 'task' }), title: title.trim(), due: due || null });
        setTitle(''); setDue('');
      }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="primary" type="submit">Add</button>
      </form>
      <ul className="items">
        {tasks.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <input type="checkbox" checked={!!t.done} onChange={(e) => saveItem({ id: t.id, done: e.target.checked })} />
            <div className="body"><h3>{t.title}</h3></div>
            {t.due && <span className={'due' + (!t.done && t.due < today ? ' overdue' : '')}>{t.due}</span>}
            <button className="ghost" onClick={() => confirm('Delete this task?') && saveItem({ id: t.id, deleted: true })}>✕</button>
          </li>
        ))}
        {tasks.length === 0 && <p className="muted">No tasks yet.</p>}
      </ul>
    </>
  );
}

function NoteEditor({ item, engine, saveItem, onClose }) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [attachments, setAttachments] = useState(item.attachments || []);
  const [thumbs, setThumbs] = useState({}); // attId -> objectURL

  useEffect(() => {
    let dead = false;
    const urls = [];
    (async () => {
      for (const att of attachments) {
        if (thumbs[att.id]) continue;
        const blob = await (engine ? engine.ensureBlob(att.id) : store.getBlob(att.id));
        if (blob && !dead) {
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setThumbs((t) => ({ ...t, [att.id]: url }));
        }
      }
    })();
    return () => { dead = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [attachments]);

  async function attachFiles(files) {
    const next = [...attachments];
    for (const file of files) {
      const attId = crypto.randomUUID();
      await store.putBlob(attId, file);
      next.push({ id: attId, name: file.name || 'pasted.png', mime: file.type });
    }
    setAttachments(next);
    await saveItem({ id: item.id, attachments: next });
  }

  async function close() {
    const parsedTags = tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    const changed = title !== item.title || body !== item.body || JSON.stringify(parsedTags) !== JSON.stringify(item.tags);
    if (changed) await saveItem({ id: item.id, title, body, tags: parsedTags });
    onClose();
  }

  return (
    <div className="overlay">
      <div className="panel">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
            if (images.length) { e.preventDefault(); attachFiles(images); }
          }}
          placeholder="Write your note… (paste screenshots directly)"
        />
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" />
        {attachments.length > 0 && (
          <div className="thumbs">
            {attachments.map((att) => (
              <figure key={att.id}>
                {thumbs[att.id]
                  ? <img src={thumbs[att.id]} alt={att.name} />
                  : <span className="muted">loading…</span>}
                <figcaption>{att.name}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <div className="row">
          <label className="ghost file-btn">
            📎 Attach
            <input type="file" accept="image/*" multiple hidden onChange={(e) => attachFiles([...e.target.files])} />
          </label>
          <button className="danger" onClick={async () => { await saveItem({ id: item.id, deleted: true }); onClose(); }}>Delete</button>
          <span className="spacer" />
          <button className="primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}

function SetupScreen({ onSave }) {
  const [value, setValue] = useState('');
  return (
    <div className="shell setup">
      <h1>Nisaba</h1>
      <p>
        One-time setup: this app syncs through <strong>your own Google Drive</strong>, so it
        needs a Google OAuth Client ID you create for yourself. Follow{' '}
        <a href="https://github.com/pbparthas/Nisaba/blob/claude/cross-platform-sync-app-wsoso4/nisaba/docs/GOOGLE_SETUP.md" target="_blank" rel="noreferrer">
          the setup guide
        </a>{' '}
        (~15 minutes), then paste the Client ID here.
      </p>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="1234567890-abc…apps.googleusercontent.com" />
      <button className="primary" disabled={!value.includes('.apps.googleusercontent.com')} onClick={() => onSave(value.trim())}>
        Save
      </button>
      <p className="muted">The Client ID is not a secret — it only identifies the app to Google. Your notes never touch any server except Google Drive.</p>
    </div>
  );
}
