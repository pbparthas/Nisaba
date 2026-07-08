import React, { useMemo, useState } from 'react';
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { filterSuggestionItems } from '@blocknote/core';
import '@blocknote/mantine/style.css';
import { toInitialBlocks } from './lib/notebody.js';
import { NOTE_COLORS } from './lib/notePrefs.js';

/* Phase-2 note editor: BlockNote (MPL-2.0 core) replacing the plain textarea.
   Loaded lazily so the heavy editor chunk never blocks first paint. The note
   `body` is now a BlockNote block tree; images live as image blocks that
   reference Drive attachments through a `nisaba-att:<id>` URL, resolved to an
   object URL on display. Default export so App can React.lazy() it. */

// A curated, essentials-only slash menu — the full default list overflows
// behind the on-screen keyboard on a phone, so we keep the common blocks.
const SLASH_TITLES = new Set([
  'Paragraph', 'Heading 1', 'Heading 2', 'Heading 3',
  'Bullet List', 'Numbered List', 'Check List', 'Quote', 'Image', 'Table',
]);

export default function NoteEditorBlock({ item, store, engine, saveItem, mode, onClose }) {
  const [title, setTitle] = useState(item.title);
  const [tags, setTags] = useState(item.tags.join(', '));
  const [color, setColor] = useState(item.color || 'default');

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

  async function close() {
    const parsedTags = tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    await saveItem({ id: item.id, title, body: editor.document, tags: parsedTags });
    onClose();
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="panel" data-color={color === 'default' ? undefined : color}>
        <input className="editor-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus />
        <div className="bn-wrap">
          <BlockNoteView editor={editor} theme={mode === 'dark' ? 'dark' : 'light'} slashMenu={false}>
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) =>
                filterSuggestionItems(
                  getDefaultReactSlashMenuItems(editor).filter((i) => SLASH_TITLES.has(i.title)),
                  query,
                )}
            />
          </BlockNoteView>
        </div>
        <div className="swatches" aria-label="Note colour">
          {NOTE_COLORS.map(([key, preview]) => (
            <button
              key={key}
              className={'swatch' + (color === key ? ' on' : '')}
              style={{ background: preview }}
              aria-label={key}
              aria-pressed={color === key}
              onClick={() => pickColor(key)}
            />
          ))}
        </div>
        <input className="tag-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" />
        <div className="row">
          <button className="btn ghost" style={{ color: 'var(--overdue)' }} onClick={async () => { await saveItem({ id: item.id, deleted: true }); onClose(); }}>Delete</button>
          <span className="spacer" />
          <button className="btn accent" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
