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

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 96 96" aria-hidden="true">
      <rect x="6" y="6" width="84" height="84" rx="22" fill="#e4640b" />
      <rect x="24" y="20" width="48" height="56" rx="9" fill="#fff7ec" />
      <line x1="33" y1="34" x2="63" y2="34" stroke="#e4640b" strokeWidth="6" strokeLinecap="round" />
      <line x1="33" y1="46" x2="55" y2="46" stroke="#e9d9bd" strokeWidth="6" strokeLinecap="round" />
      <path d="M33 60 l7 7 l14 -14" fill="none" stroke="#2e9e6b" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STATUS_LABEL = {
  'local only': 'local', syncing: 'syncing…', synced: 'synced',
  offline: 'offline', 'sign in to sync': 'tap to sync', 'update-needed': 'update app',
};

export default function App() {
  const [clientId, setClientId] = useState(() => localStorage.getItem('ns_client_id') || DEFAULT_CLIENT_ID);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState('local only');
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('notes');
  const [editing, setEditing] = useState(null); // item open in the note editor

  const { auth, engine } = useMemo(() => {
    if (!clientId) return {};
    const auth = createAuth(clientId);
    const drive = createDriveClient({ getToken: () => auth.getToken() });
    const engine = createSyncEngine({
      store,
      drive,
      onStatus: (s) => {
        if (s === 'auth-needed') { setSignedIn(false); setStatus('sign in to sync'); return; }
        setStatus(s);
        // A successful sync proves we hold a valid Google session — reflect it.
        if (s === 'synced') { setSignedIn(true); refresh(); }
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
  const tasks = items.filter((i) => i.type === 'task');

  return (
    <div className="shell">
      <header className="topbar">
        <Logo />
        <h1>Nisaba</h1>
        <span className={'pill ' + status.split(' ')[0]}>{STATUS_LABEL[status] || status}</span>
        {signedIn
          ? <button className="ghost small" onClick={() => { auth.signOut(); setSignedIn(false); setStatus('local only'); }}>Sign out</button>
          : <button className="ghost small" onClick={signIn}>Sign in</button>}
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
            <ul className="items">
              {notes.map((n) => (
                <li key={n.id} onClick={() => setEditing(n)}>
                  <div className="body">
                    <h3>{n.title || <em>Untitled</em>}</h3>
                    <p>
                      {(n.attachments || []).length > 0 && <span className="tag">📎{n.attachments.length}</span>}
                      {n.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
                      {(n.body || '').slice(0, 120) || <span className="faint">No text</span>}
                    </p>
                  </div>
                  <span className="when">{relativeDay(n.updated_at)}</span>
                </li>
              ))}
              {notes.length === 0 && <EmptyState text="Capture your first note with the ＋ button." />}
            </ul>
            <button className="fab" aria-label="New note" onClick={async () => setEditing(await saveItem({ type: 'note' }))}>＋</button>
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

function relativeDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) -
    new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function dueLabel(due, today) {
  if (!due) return null;
  const diff = Math.round((new Date(due) - new Date(today)) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 0) return `${-diff}d late`;
  if (diff < 7) return new Date(due).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function EmptyState({ text }) {
  return <p className="muted empty">{text}</p>;
}

function Tasks({ tasks, saveItem }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [openId, setOpenId] = useState(null); // task with its detail panel expanded
  const today = new Date().toISOString().slice(0, 10);

  const byDue = (a, b) => String(a.due || '~').localeCompare(String(b.due || '~')) || b.updated_at - a.updated_at;
  const sections = [
    { name: 'Overdue', list: tasks.filter((t) => !t.done && t.due && t.due < today).sort(byDue) },
    { name: 'Today', list: tasks.filter((t) => !t.done && t.due === today).sort(byDue) },
    { name: 'Upcoming', list: tasks.filter((t) => !t.done && (!t.due || t.due > today)).sort(byDue) },
    { name: 'Done', list: tasks.filter((t) => t.done).sort((a, b) => b.updated_at - a.updated_at) },
  ];

  return (
    <>
      <form className="task-form" onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        await saveItem({ ...newItem({ type: 'task' }), title: title.trim(), due: due || null });
        setTitle(''); setDue('');
      }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" />
        <label className="due-field">
          <span>Due date</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button className="primary" type="submit">Add</button>
      </form>

      {tasks.length === 0 && <EmptyState text="Add a task above — give it a due date and subtasks." />}

      {sections.map(({ name, list }) => list.length > 0 && (
        <section key={name}>
          <h2 className={'section-h' + (name === 'Overdue' ? ' alert' : '')}>{name}</h2>
          <ul className="items">
            {list.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                today={today}
                open={openId === t.id}
                onToggleOpen={() => setOpenId(openId === t.id ? null : t.id)}
                saveItem={saveItem}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function TaskRow({ task: t, today, open, onToggleOpen, saveItem }) {
  const [newSub, setNewSub] = useState('');
  const subs = t.subtasks || [];
  const doneCount = subs.filter((s) => s.done).length;

  async function setSubtasks(subtasks) {
    await saveItem({ id: t.id, subtasks });
  }

  return (
    <li className={'task' + (t.done ? ' done' : '') + (open ? ' open' : '')}>
      <div className="task-row">
        <input type="checkbox" checked={!!t.done} onChange={(e) => saveItem({ id: t.id, done: e.target.checked })} />
        <div className="body" onClick={onToggleOpen}>
          <h3>{t.title}</h3>
          {subs.length > 0 && (
            <span className={'subcount' + (doneCount === subs.length ? ' all-done' : '')}>
              {doneCount}/{subs.length}
            </span>
          )}
        </div>
        {t.due && <span className={'due' + (!t.done && t.due < today ? ' overdue' : '')}>{dueLabel(t.due, today)}</span>}
        <button className="chevron" aria-label="details" onClick={onToggleOpen}>{open ? '▾' : '▸'}</button>
      </div>

      {open && (
        <div className="subtasks">
          <div className="task-edit">
            <input
              defaultValue={t.title}
              aria-label="task title"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.title) saveItem({ id: t.id, title: v }); }}
            />
            <label className="due-field">
              <span>Due date</span>
              <input type="date" defaultValue={t.due || ''} onChange={(e) => saveItem({ id: t.id, due: e.target.value || null })} />
            </label>
          </div>

          {subs.map((s) => (
            <label key={s.id} className={'subtask' + (s.done ? ' done' : '')}>
              <input
                type="checkbox"
                checked={!!s.done}
                onChange={(e) => setSubtasks(subs.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)))}
              />
              <span>{s.title}</span>
              <button
                className="chevron"
                aria-label="remove subtask"
                onClick={(e) => { e.preventDefault(); setSubtasks(subs.filter((x) => x.id !== s.id)); }}
              >✕</button>
            </label>
          ))}
          <form className="subtask-form" onSubmit={(e) => {
            e.preventDefault();
            if (!newSub.trim()) return;
            setSubtasks([...subs, { id: crypto.randomUUID(), title: newSub.trim(), done: false }]);
            setNewSub('');
          }}>
            <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add a subtask…" />
            <button type="submit" className="ghost">＋</button>
          </form>
          <div className="row subtask-footer">
            <button className="danger" onClick={() => confirm('Delete this task?') && saveItem({ id: t.id, deleted: true })}>
              Delete task
            </button>
          </div>
        </div>
      )}
    </li>
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
        <input className="editor-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus />
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
      <h1><Logo /> Nisaba</h1>
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
