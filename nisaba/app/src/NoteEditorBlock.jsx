import React, { useMemo, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { toInitialBlocks } from './lib/notebody.js';

/* Phase-2 note editor: BlockNote (MPL-2.0 core) replacing the plain textarea.
   Loaded lazily so the heavy editor chunk never blocks first paint. The note
   `body` is now a BlockNote block tree; images live as image blocks that
   reference Drive attachments through a `nisaba-att:<id>` URL, resolved to an
   object URL on display. This component is only mounted for one note at a time.
   Default export so App can React.lazy() it. */
export default function NoteEditorBlock({ item, store, engine, saveItem, mode, onClose }) {
  const [title, setTitle] = useState(item.title);
  const [tags, setTags] = useState(item.tags.join(', '));

  const initialContent = useMemo(() => toInitialBlocks(item.body), []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useCreateBlockNote({
    initialContent,
    // Paste/insert an image → stash the blob locally, register it on the item
    // (so sync uploads it to Drive), and store a stable reference in the block.
    uploadFile: async (file) => {
      const attId = crypto.randomUUID();
      await store.putBlob(attId, file);
      const existing = await store.getItem(item.id);
      const atts = [...((existing && existing.attachments) || []),
        { id: attId, name: file.name || 'image.png', mime: file.type }];
      await saveItem({ id: item.id, attachments: atts });
      return `nisaba-att:${attId}`;
    },
    // Resolve stored attachment references back to a displayable object URL,
    // fetching the blob from Drive on demand if it isn't local yet.
    resolveFileUrl: async (url) => {
      if (typeof url === 'string' && url.startsWith('nisaba-att:')) {
        const attId = url.slice('nisaba-att:'.length);
        const blob = await (engine ? engine.ensureBlob(attId) : store.getBlob(attId));
        if (blob) return URL.createObjectURL(blob);
      }
      return url;
    },
  });

  async function close() {
    const parsedTags = tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    await saveItem({ id: item.id, title, body: editor.document, tags: parsedTags });
    onClose();
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="panel">
        <input className="editor-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus />
        <div className="bn-wrap">
          <BlockNoteView editor={editor} theme={mode === 'dark' ? 'dark' : 'light'} />
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
