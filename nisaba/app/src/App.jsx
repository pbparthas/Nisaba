import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createIdbStore } from './lib/store-idb.js';
import { createAuth } from './lib/auth.js';
import { createDriveClient } from './lib/drive.js';
import { createSyncEngine } from './lib/sync.js';
import { newItem } from './lib/merge.js';
import { getMode, applyMode } from './lib/theme.js';
import { blocksToText } from './lib/notebody.js';
import {
  getNoteFont, getNoteSize, getNoteWeight, getNoteStyle, getNoteInk, setNotePref,
  NOTE_FONTS, NOTE_FONT_OPTIONS, NOTE_SIZE_OPTIONS, NOTE_WEIGHT_OPTIONS, NOTE_STYLE_OPTIONS, NOTE_INK_OPTIONS,
} from './lib/notePrefs.js';

const store = createIdbStore();

// The BlockNote editor is heavy; load it only when a note is opened.
const NoteEditor = React.lazy(() => import('./NoteEditorBlock.jsx'));

// Long-press to enter multi-select; a normal tap runs onClick. A press that
// crosses the hold threshold suppresses the click that follows it.
function useLongPress(onLong, onClick) {
  const timer = useRef(null);
  const fired = useRef(false);
  const start = () => { fired.current = false; timer.current = setTimeout(() => { fired.current = true; onLong(); }, 450); };
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: start, onPointerUp: cancel, onPointerLeave: cancel, onPointerMove: cancel,
    onClick: (e) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); return; } onClick(e); },
  };
}

// Free-text match across title, body, tags and subtasks.
function matchItem(item, q) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if ((item.title || '').toLowerCase().includes(s)) return true;
  if (blocksToText(item.body).toLowerCase().includes(s)) return true;
  if ((item.tags || []).some((t) => t.toLowerCase().includes(s))) return true;
  if ((item.subtasks || []).some((st) => (st.title || '').toLowerCase().includes(s))) return true;
  return false;
}

function SearchBar({ value, onChange, placeholder }) {
  return (
    <div className="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" />
      </svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <button className="search-x" aria-label="Clear search" onClick={() => onChange('')}>✕</button>}
    </div>
  );
}

const createdAt = (i) => i.created_at || i.updated_at;
const startOfDay = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
function dayHeading(ts) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(ts).toLocaleDateString(undefined, { weekday: 'long' });
  const d = new Date(ts);
  const opts = d.getFullYear() === new Date().getFullYear()
    ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}
// Group items into date-created buckets (newest day first).
function groupByCreated(items) {
  const sorted = [...items].sort((a, b) => createdAt(b) - createdAt(a));
  const groups = [];
  let cur = null;
  for (const it of sorted) {
    const key = startOfDay(createdAt(it));
    if (!cur || cur.key !== key) { cur = { key, label: dayHeading(createdAt(it)), items: [] }; groups.push(cur); }
    cur.items.push(it);
  }
  return groups;
}

// The owner's OAuth Client ID (public by design — it only identifies the app
// to Google; access still requires signing in to the matching account).
// A different deployment can override it from the first-run screen, which
// stores the override in localStorage.
const DEFAULT_CLIENT_ID = '652122307592-300cfvid9hl2s4t59hm9c4mivbtm3beq.apps.googleusercontent.com';

/* Nisaba mark — an eight-fold star-rosette (the star of Inanna / Mesopotamian
   rosette; the same eight-point motif with rounded petals and rays between).
   Strictly 8-fold by design. Theme-aware: petals take the current ink colour,
   the rays + core take the accent — so it prints on paper, in lights-out, and
   as the app icon. Eight ellipse-petals + eight rays offset 22.5°. */
function Logo({ size = 30 }) {
  const petals = Array.from({ length: 8 }, (_, k) => (
    <ellipse key={'p' + k} cx="32" cy="15" rx="4.2" ry="9" fill="none" stroke="currentColor" strokeWidth="2.1" transform={`rotate(${k * 45} 32 32)`} />
  ));
  const rays = Array.from({ length: 8 }, (_, k) => (
    <line key={'r' + k} x1="32" y1="32" x2="32" y2="13" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" transform={`rotate(${k * 45 + 22.5} 32 32)`} />
  ));
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {petals}{rays}
      <circle cx="32" cy="32" r="4.5" fill="var(--accent)" />
    </svg>
  );
}

const CalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round" />
  </svg>
);

const STATUS_LABEL = {
  'local only': 'local', syncing: 'syncing…', synced: 'synced',
  offline: 'offline', 'sign in to sync': 'tap to sync', 'update-needed': 'update app',
};

export default function App() {
  const [clientId, setClientId] = useState(() => localStorage.getItem('ns_client_id') || DEFAULT_CLIENT_ID);
  const [signedIn, setSignedIn] = useState(false);
  const [status, setStatus] = useState('local only');
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('notes'); // 'notes' | 'tasks' | 'settings'
  const [editing, setEditing] = useState(null);
  const [mode, setMode] = useState(getMode);
  const [selMode, setSelMode] = useState(false);
  const [selIds, setSelIds] = useState(() => new Set());
  const [query, setQuery] = useState('');

  const clearSel = useCallback(() => { setSelMode(false); setSelIds(new Set()); }, []);
  const enterSel = (id) => { setSelMode(true); setSelIds(new Set([id])); };
  const toggleSel = (id) => setSelIds((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
    if (n.size === 0) setSelMode(false);
    return n;
  });
  const goTab = (t) => { clearSel(); setQuery(''); setTab(t); };
  async function deleteSel() {
    for (const id of selIds) await saveItem({ id, deleted: true });
    clearSel();
  }

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

  function setAppMode(m) { applyMode(m); setMode(m); }

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

  function signOut() {
    auth.signOut();
    setSignedIn(false);
    setStatus('local only');
  }

  if (!clientId) return <SetupScreen onSave={(id) => { localStorage.setItem('ns_client_id', id); setClientId(id); }} />;

  const notes = items.filter((i) => i.type === 'note').sort((a, b) => b.updated_at - a.updated_at);
  const tasks = items.filter((i) => i.type === 'task');
  const statusKey = status.split(' ')[0];

  return (
    <div className="shell">
      <header className="hdr">
        <div className="hdr-inner">
          <a className="brand" href="#" onClick={(e) => { e.preventDefault(); goTab('notes'); }}>
            <Logo size={30} />
            <span className="word">Nisaba</span>
          </a>
          <span className="spacer" />
          <span className={'status ' + statusKey}>{STATUS_LABEL[status] || status}</span>
          <button
            className={'gear' + (tab === 'settings' ? ' active' : '')}
            aria-label="Settings"
            onClick={() => goTab('settings')}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2.5v2.5M12 19v2.5M4.2 6.5l1.8 1.8M18 15.7l1.8 1.8M2.5 12H5M19 12h2.5M4.2 17.5l1.8-1.8M18 8.3l1.8-1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {tab === 'notes' && (
        <main className="screen">
          {(notes.length > 0 || query) && <SearchBar value={query} onChange={setQuery} placeholder="Search notes" />}
          {groupByCreated(notes.filter((n) => matchItem(n, query))).map((g) => (
            <section key={g.key} className="section">
              <span className="eyebrow">{g.label}</span>
              <ul className="list" style={{ listStyle: 'none' }}>
                {g.items.map((n) => (
                  <NoteCard
                    key={n.id} n={n} selMode={selMode} selected={selIds.has(n.id)}
                    onOpen={() => setEditing(n)} onToggle={() => toggleSel(n.id)} onLong={() => enterSel(n.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {notes.length === 0 && <p className="empty">Capture your first note with the ＋ button.</p>}
          {notes.length > 0 && query && notes.filter((n) => matchItem(n, query)).length === 0 && <p className="empty">No notes match “{query}”.</p>}
          {!selMode && <button className="fab" aria-label="New note" onClick={async () => { const n = await saveItem({ type: 'note' }); setEditing({ ...n, _new: true }); }}>＋</button>}
        </main>
      )}

      {tab === 'tasks' && <Tasks tasks={tasks} saveItem={saveItem} selMode={selMode} selIds={selIds} toggleSel={toggleSel} enterSel={enterSel} query={query} setQuery={setQuery} />}

      {tab === 'settings' && (
        <Settings
          mode={mode} setAppMode={setAppMode}
          signedIn={signedIn} status={status} statusKey={statusKey}
          onSignIn={signIn} onSignOut={signOut}
          itemCount={items.length}
        />
      )}

      {selMode ? (
        <div className="selbar">
          <button className="btn" onClick={clearSel}>Cancel</button>
          <span className="selcount">{selIds.size} selected</span>
          <button
            className="btn danger-fill"
            onClick={() => { if (confirm(`Delete ${selIds.size} item${selIds.size > 1 ? 's' : ''}?`)) deleteSel(); }}
          >Delete</button>
        </div>
      ) : (
        <nav className="tabs" aria-label="Sections">
          <div className="tabs-inner">
            <button className={'tab' + (tab === 'notes' ? ' on' : '')} onClick={() => goTab('notes')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" strokeLinecap="round" /></svg>
              NOTES
            </button>
            <button className={'tab' + (tab === 'tasks' ? ' on' : '')} onClick={() => goTab('tasks')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 6.5l2 2 3.5-4M4 17.5l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" /><path d="M13 6.5h7M13 17.5h7" strokeLinecap="round" /></svg>
              TASKS
            </button>
          </div>
        </nav>
      )}

      {editing && (
        <React.Suspense fallback={<div className="overlay"><div className="panel"><p className="lead">Loading editor…</p></div></div>}>
          <NoteEditor
            item={editing}
            store={store}
            engine={engine}
            saveItem={saveItem}
            mode={mode}
            onClose={() => { setEditing(null); refresh(); }}
          />
        </React.Suspense>
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

function NoteCard({ n, selMode, selected, onOpen, onToggle, onLong }) {
  const lp = useLongPress(onLong, () => (selMode ? onToggle() : onOpen()));
  return (
    <li className={'card note' + (selected ? ' selected' : '')} data-color={n.color || undefined} {...lp}>
      <h3>{n.title || <em>Untitled</em>}</h3>
      <p className="snip">{blocksToText(n.body).slice(0, 140) || <span className="faint">No text yet</span>}</p>
      <div className="meta">
        {(n.attachments || []).length > 0 && <span className="chip">📎 {n.attachments.length}</span>}
        {n.tags.map((t) => <span key={t} className="chip grain">#{t}</span>)}
        <span className="when">{relativeDay(n.updated_at)}</span>
      </div>
      {selMode && <span className="selcheck">{selected ? '✓' : ''}</span>}
    </li>
  );
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

function Tasks({ tasks, saveItem, selMode, selIds, toggleSel, enterSel, query, setQuery }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [openId, setOpenId] = useState(null);
  const [grouping, setGrouping] = useState(() => { try { return localStorage.getItem('ns:taskGroup') || 'created'; } catch { return 'created'; } });
  const today = new Date().toISOString().slice(0, 10);
  const setGroupMode = (g) => { try { localStorage.setItem('ns:taskGroup', g); } catch { /* private */ } setGrouping(g); };

  const shown = tasks.filter((t) => matchItem(t, query));

  // Two ways to group: by date created, or the due-date agenda.
  let groups;
  if (grouping === 'due') {
    const byDue = (a, b) => String(a.due || '~').localeCompare(String(b.due || '~')) || createdAt(b) - createdAt(a);
    groups = [
      { key: 'overdue', label: 'Overdue', alert: true, items: shown.filter((t) => !t.done && t.due && t.due < today).sort(byDue) },
      { key: 'today', label: 'Today', items: shown.filter((t) => !t.done && t.due === today).sort(byDue) },
      { key: 'upcoming', label: 'Upcoming', items: shown.filter((t) => !t.done && (!t.due || t.due > today)).sort(byDue) },
      { key: 'done', label: 'Done', items: shown.filter((t) => t.done).sort((a, b) => b.updated_at - a.updated_at) },
    ].filter((g) => g.items.length > 0);
  } else {
    groups = groupByCreated(shown).map((g) => ({
      ...g, items: [...g.items].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1)),
    }));
  }

  async function add() {
    if (!title.trim()) { setAdding(false); return; }
    await saveItem({ ...newItem({ type: 'task' }), title: title.trim(), due: null });
    setTitle(''); // stay open for rapid entry
  }

  return (
    <main className="screen">
      {(tasks.length > 0 || query) && <SearchBar value={query} onChange={setQuery} placeholder="Search tasks" />}
      {tasks.length > 0 && (
        <div className="group-toggle">
          <button className={grouping === 'created' ? 'on' : ''} onClick={() => setGroupMode('created')}>By date</button>
          <button className={grouping === 'due' ? 'on' : ''} onClick={() => setGroupMode('due')}>By due</button>
        </div>
      )}
      {adding ? (
        <div className="add-composer">
          <span className="dot" />
          <input
            autoFocus value={title}
            placeholder="New task…"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setTitle(''); setAdding(false); } }}
            onBlur={() => { if (!title.trim()) setAdding(false); }}
          />
        </div>
      ) : (
        <button className="add-task" onClick={() => setAdding(true)}>
          <span className="plus">＋</span> Add task
        </button>
      )}

      {tasks.length === 0 && !adding && <p className="empty">Add a task, then open it to set a due date and subtasks.</p>}

      {tasks.length > 0 && query && shown.length === 0 && <p className="empty">No tasks match “{query}”.</p>}

      {groups.map((g) => (
        <section key={g.key} className="section">
          <span className={'eyebrow' + (g.alert ? ' alert' : '')}>{g.label}</span>
          <ul className="list" style={{ listStyle: 'none' }}>
            {g.items.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                today={today}
                open={!selMode && openId === t.id}
                onToggleOpen={() => setOpenId(openId === t.id ? null : t.id)}
                saveItem={saveItem}
                selMode={selMode}
                selected={selIds.has(t.id)}
                onToggleSel={() => toggleSel(t.id)}
                onLong={() => enterSel(t.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

function TaskRow({ task: t, today, open, onToggleOpen, saveItem, selMode, selected, onToggleSel, onLong }) {
  const [newSub, setNewSub] = useState('');
  const [menu, setMenu] = useState(false);
  const subs = t.subtasks || [];
  const doneCount = subs.filter((s) => s.done).length;
  const late = !t.done && t.due && t.due < today;
  const mainLp = useLongPress(onLong, () => (selMode ? onToggleSel() : onToggleOpen()));

  async function setSubtasks(subtasks) { await saveItem({ id: t.id, subtasks }); }

  return (
    <li className={'card task' + (t.done ? ' done' : '') + (open ? ' open' : '') + (selected ? ' selected' : '')}>
      <div className="task-row">
        <button
          className={'tick' + (t.done ? ' done' : '')}
          aria-label={t.done ? 'Mark not done' : 'Mark done'}
          onClick={() => (selMode ? onToggleSel() : saveItem({ id: t.id, done: !t.done }))}
        >{t.done ? '✓' : ''}</button>
        {/* One title only: a heading that becomes an inline editable field when
            the card is open — never a second copy of the title in a box. */}
        {open ? (
          <input
            className="edit-title"
            defaultValue={t.title}
            aria-label="Task title"
            placeholder="Task title"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.title) saveItem({ id: t.id, title: v }); }}
          />
        ) : (
          <div className="task-main" {...mainLp}>
            <div className="task-title">{t.title || 'Untitled task'}</div>
            {(t.due || subs.length > 0) && (
              <div className="task-sub">
                {t.due && (
                  <span className={'due-chip' + (late ? ' late' : ' set')}>
                    <CalIcon />{dueLabel(t.due, today)}
                  </span>
                )}
                {subs.length > 0 && (
                  <span className={'count' + (doneCount === subs.length ? ' all' : '')}>{doneCount}/{subs.length}</span>
                )}
              </div>
            )}
          </div>
        )}
        {selMode
          ? <span className="selcheck">{selected ? '✓' : ''}</span>
          : <span className="chev" onClick={onToggleOpen}>›</span>}
      </div>

      {open && (
        <div className="task-detail">
          <div className="detail-meta">
            <label className={'due-chip big' + (t.due ? ' set' : '')}>
              <CalIcon />{t.due ? dueLabel(t.due, today) : 'Add date'}
              <input type="date" value={t.due || ''} onChange={(e) => saveItem({ id: t.id, due: e.target.value || null })} />
            </label>
          </div>

          {subs.map((s) => (
            <div key={s.id} className={'sub' + (s.done ? ' done' : '')}>
              <button
                className={'tick' + (s.done ? ' done' : '')}
                aria-label={s.done ? 'Undo subtask' : 'Complete subtask'}
                onClick={() => setSubtasks(subs.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))}
              >{s.done ? '✓' : ''}</button>
              <span>{s.title}</span>
              <button className="x" aria-label="Remove subtask" onClick={() => setSubtasks(subs.filter((x) => x.id !== s.id))}>✕</button>
            </div>
          ))}

          <form className="add-item" onSubmit={(e) => {
            e.preventDefault();
            if (!newSub.trim()) return;
            setSubtasks([...subs, { id: crypto.randomUUID(), title: newSub.trim(), done: false }]);
            setNewSub('');
          }}>
            <span className="plus">＋</span>
            <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add item" />
          </form>

          <div className="detail-foot">
            <span className="hint">Tap the title to edit</span>
            <button className="overflow" aria-label="More actions" onClick={() => setMenu(!menu)}>⋯</button>
          </div>
          {menu && (
            <div className="menu" role="menu">
              <button className="danger" onClick={() => { if (confirm('Delete this task?')) saveItem({ id: t.id, deleted: true }); setMenu(false); }}>
                Delete task
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Settings({ mode, setAppMode, signedIn, status, statusKey, onSignIn, onSignOut, itemCount }) {
  const [install, setInstall] = useState(null); // captured beforeinstallprompt event
  const [prefs, setPrefs] = useState(() => ({
    font: getNoteFont(), size: getNoteSize(), weight: getNoteWeight(), style: getNoteStyle(), ink: getNoteInk(),
  }));
  const updatePref = (kind, val) => { setNotePref(kind, val); setPrefs((p) => ({ ...p, [kind]: val })); };
  const seg = (kind, options, renderLabel) => (
    <div className="seg wrap">
      {options.map(([k, l]) => (
        <button key={k} className={prefs[kind] === k ? 'on' : ''} onClick={() => updatePref(kind, k)}>
          {renderLabel ? renderLabel(k, l) : l}
        </button>
      ))}
    </div>
  );

  const [storage, setStorage] = useState(null); // { persisted, usedMB }

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstall(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    (async () => {
      try {
        const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
        const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
        setStorage({ persisted, usedMB: est?.usage ? (est.usage / 1048576).toFixed(1) : null });
      } catch { /* unsupported */ }
    })();
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function keepData() {
    try { const ok = await navigator.storage.persist(); setStorage((s) => ({ ...s, persisted: ok })); } catch { /* blocked */ }
  }

  return (
    <main className="screen">
      <span className="eyebrow">Settings · Notes &amp; Tasks</span>
      <p className="lead" style={{ marginTop: 8 }}>One place for both — everything here applies across the whole app.</p>

      <div className="card set-card">
        <span className="eyebrow">Appearance</span>
        <div className="toggle">
          {[['paper', '📜 Paper'], ['dark', '🌙 Lights out']].map(([m, label]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setAppMode(m)}>{label}</button>
          ))}
        </div>
        <p className="lead" style={{ marginTop: 10 }}>Same warm design either way — paper for daylight, lights out for late nights.</p>
      </div>

      <div className="card set-card">
        <span className="eyebrow">Note text</span>
        <div className="pref">
          <label>Font</label>
          {seg('font', NOTE_FONT_OPTIONS, (k, l) => <span style={{ fontFamily: NOTE_FONTS[k] }}>{l}</span>)}
        </div>
        <div className="pref">
          <label>Size</label>
          {seg('size', NOTE_SIZE_OPTIONS)}
        </div>
        <div className="pref">
          <label>Weight</label>
          {seg('weight', NOTE_WEIGHT_OPTIONS, (k, l) => <span style={{ fontWeight: k === 'semibold' ? 600 : k === 'medium' ? 500 : 400 }}>{l}</span>)}
        </div>
        <div className="pref">
          <label>Style</label>
          {seg('style', NOTE_STYLE_OPTIONS, (k, l) => <span style={{ fontStyle: k }}>{l}</span>)}
        </div>
        <div className="pref">
          <label>Colour</label>
          <div className="ink-row">
            {NOTE_INK_OPTIONS.map(([k, label]) => (
              <button key={k} className={'ink-chip' + (prefs.ink === k ? ' on' : '')} onClick={() => updatePref('ink', k)}>
                <span className="ink-dot" data-ink={k} />{label}
              </button>
            ))}
          </div>
        </div>
        <p className="lead" style={{ marginTop: 12 }}>Applies to all note text. Each note's background colour is set inside the note.</p>
      </div>

      <div className="card set-card">
        <span className="eyebrow">Account &amp; sync</span>
        <div className="set-row">
          <span>Google Drive</span>
          <span className={'status-pill' + (signedIn ? '' : ' off')} style={{ marginLeft: 'auto' }}>
            {signedIn ? (STATUS_LABEL[status] || status) : 'not connected'}
          </span>
        </div>
        <div className="set-row"><span>Stored on this device</span><span className="val">{itemCount} item{itemCount === 1 ? '' : 's'}</span></div>
        <div className="btn-row">
          {signedIn
            ? <button className="btn" onClick={onSignOut}>Sign out</button>
            : <button className="btn accent" onClick={onSignIn}>Connect Google Drive</button>}
        </div>
        <p className="lead" style={{ marginTop: 12 }}>Your notes and tasks sync only through your own Drive — no server of ours ever sees them.</p>
      </div>

      <div className="card set-card">
        <span className="eyebrow">App &amp; storage</span>
        <div className="set-row">
          <span>On this device</span>
          <span className="val">{itemCount} item{itemCount === 1 ? '' : 's'}{storage?.usedMB ? ` · ${storage.usedMB} MB` : ''}</span>
        </div>
        <div className="set-row">
          <span>Offline copy</span>
          <span className={'status-pill' + (storage?.persisted ? '' : ' off')} style={{ marginLeft: 'auto' }}>
            {storage?.persisted ? 'kept' : storage?.persisted === false ? 'best-effort' : '—'}
          </span>
        </div>
        <div className="btn-row">
          {install && <button className="btn accent" onClick={async () => { install.prompt(); await install.userChoice; setInstall(null); }}>📲 Install app</button>}
          {storage?.persisted === false && <button className="btn" onClick={keepData}>Keep data on device</button>}
        </div>
        <p className="lead" style={{ marginTop: 12 }}>
          Works offline once installed. {install ? '' : 'Add to your home screen from the browser menu to install. '}
          Your notes stay on this device and in your Drive.
        </p>
      </div>

      <div className="card set-card" style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>
        <span className="eyebrow" style={{ marginBottom: 8 }}>About</span>
        Nisaba — notes &amp; tasks that live in your own Google Drive as plain JSON that outlives the app.
        No accounts of ours, no analytics. Named for the Sumerian goddess of writing.
      </div>
    </main>
  );
}

function SetupScreen({ onSave }) {
  const [value, setValue] = useState('');
  return (
    <div className="setup">
      <div className="brand"><Logo size={44} /> <span className="word big">Nisaba</span></div>
      <p>
        One-time setup: this app syncs through <strong>your own Google Drive</strong>, so it
        needs a Google OAuth Client ID you create for yourself. Follow{' '}
        <a href="https://github.com/pbparthas/Nisaba/blob/claude/cross-platform-sync-app-wsoso4/nisaba/docs/GOOGLE_SETUP.md" target="_blank" rel="noreferrer">
          the setup guide
        </a>{' '}
        (~15 minutes), then paste the Client ID here.
      </p>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="1234567890-abc…apps.googleusercontent.com" />
      <button className="btn accent" disabled={!value.includes('.apps.googleusercontent.com')} onClick={() => onSave(value.trim())}>
        Save
      </button>
      <p className="lead">The Client ID is not a secret — it only identifies the app to Google. Your notes never touch any server except Google Drive.</p>
    </div>
  );
}
