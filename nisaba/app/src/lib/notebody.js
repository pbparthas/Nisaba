// Note bodies moved from plain strings to BlockNote block trees in Phase 2.
// These helpers keep both worlds working: migrate old string bodies into blocks
// on open, and derive a plain-text preview for the note list from either shape.

export function toInitialBlocks(body) {
  if (Array.isArray(body) && body.length) return body;
  if (typeof body === 'string' && body.trim()) {
    // Old plain-text note: one paragraph per line (blank lines become empty
    // paragraphs) so nothing is lost when it opens in the block editor.
    return body.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line, styles: {} }] : [],
    }));
  }
  return undefined; // new/empty note — BlockNote starts with an empty paragraph
}

export function blocksToText(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (!Array.isArray(body)) return '';
  const out = [];
  const walk = (blocks) => {
    for (const b of blocks) {
      if (Array.isArray(b.content)) {
        for (const c of b.content) if (c && typeof c.text === 'string') out.push(c.text);
      }
      if (Array.isArray(b.children) && b.children.length) walk(b.children);
    }
  };
  walk(body);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
