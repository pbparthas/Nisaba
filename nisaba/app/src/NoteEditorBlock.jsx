import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { toInitialBlocks } from './lib/notebody.js';
import { NOTE_COLORS } from './lib/notePrefs.js';

/* Phase-2 note editor: BlockNote (MPL-2.0 core) replacing the plain textarea.
   Loaded lazily so the heavy editor chunk never blocks first paint. The note
   `body` is now a BlockNote block tree; images live as image blocks that
   reference Drive attachments through a `nisaba-att:<id>` URL, resolved to an
   object URL on display. Default export so App can React.lazy() it.

   Existing notes open READ-ONLY (no keyboard) with an Edit button; only a
   freshly created note (item._new) opens straight into edit mode. */

// A small "Colour" pill that opens a tidy popover palette (grid of swatches),
// so the 14 background colours don't sprawl across the editor. Opens upward
// (it sits near the bottom) and closes on outside-click / Escape.
function ColorPopover({ color, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = NOTE_COLORS.find(([k]) => k === color) || NOTE_COLORS[0];
  return (
    <div className="color-pop" ref={ref}>
      <button type="button" className="color-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}>
        <span className="swatch sm" style={{ background: current[1] }} />
        <span>Colour</span>
        <span className="chev">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="color-menu" role="listbox" aria-label="Note colour">
          {NOTE_COLORS.map(([key, preview]) => (
            <button
              type="button"
              key={key}
              className={'swatch' + (color === key ? ' on' : '')}
              style={{ background: preview }}
              aria-label={key}
              aria-pressed={color === key}
              onClick={() => { onPick(key); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function NoteEditorBlock({ item, store, engine, saveItem, mode, onClose }) {
  const [title, setTitle] = useState(item.title);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [color, setColor] = useState(item.color || 'default');
  const [editMode, setEditMode] = useState(!!item._new);

  const initialContent = useMemo(() => toInitialBlocks(item.body), []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useCreateBlockNote({
    initialContent,
    uploadFile: async (file) => {
      const attId = crypto.randomUUID();
      await store.putBlob(attId, file);
      const existing = await store.getItem(item.id);
      const atts = [...((existing && existing.attachments) || []),
        { id: attId, name: file.name || 'image.png', mime: file.type }];
      await saveItem({ id: item.id, attachments: atts });
      return `nisaba-att:${attId}`;
    },
    resolveFileUrl: async (url) => {
      if (typeof url === 'string' && url.startsWith('nisaba-att:')) {
        const attId = url.slice('nisaba-att:'.length);
        const blob = await (engine ? engine.ensureBlob(attId) : store.getBlob(attId));
        if (blob) return URL.createObjectURL(blob);
      }
      return url;
    },
  });

  function pickColor(key) {
    setColor(key);
    saveItem({ id: item.id, color: key === 'default' ? null : key });
  }

  async function saveAndClose() {
    const parsedTags = tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    await saveItem({ id: item.id, title, body: editor.document, tags: parsedTags });
    onClose();
  }

  // Read-only close makes no write; edit-mode close saves first.
  function dismiss() { editMode ? saveAndClose() : onClose(); }

  const tagList = item.tags || [];

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div className="panel" data-color={color === 'default' ? undefined : color}>
        {editMode ? (
          <input className="editor-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus={!!item._new} />
        ) : (
          <h2 className="editor-title-read">{title || <span className="muted-title">Untitled</span>}</h2>
        )}

        <div className="bn-wrap">
          <BlockNoteView editor={editor} editable={editMode} theme={mode === 'dark' ? 'dark' : 'light'} />
        </div>

        {editMode ? (
          <>
            <ColorPopover color={color} onPick={pickColor} />
            <input className="tag-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" />
            <div className="row">
              <button className="btn ghost" style={{ color: 'var(--overdue)' }} onClick={async () => { await saveItem({ id: item.id, deleted: true, deleted_at: Date.now() }); onClose(); }}>Delete</button>
              <span className="spacer" />
              <button className="btn accent" onClick={saveAndClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            {tagList.length > 0 && (
              <div className="meta" style={{ marginTop: 4 }}>
                {tagList.map((t) => <span key={t} className="chip grain">#{t}</span>)}
              </div>
            )}
            <div className="row">
              <button className="btn ghost" style={{ color: 'var(--overdue)' }} onClick={async () => { await saveItem({ id: item.id, deleted: true, deleted_at: Date.now() }); onClose(); }}>Delete</button>
              <span className="spacer" />
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn accent" onClick={() => setEditMode(true)}>✎ Edit</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
