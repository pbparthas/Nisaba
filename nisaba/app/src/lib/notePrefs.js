// User-chosen note typography (global) + the per-note background palette.
// Font + ink are global prefs in localStorage, applied as CSS variables on
// <html>; the note colour is stored per item and painted via [data-color].

const FKEY = 'ns:noteFont';
const CKEY = 'ns:noteInk';

export const NOTE_FONTS = {
  sans: '"Inter", system-ui, -apple-system, sans-serif',
  serif: '"Spectral", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};
export const NOTE_FONT_OPTIONS = [
  ['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'],
];

// Ink options resolve through CSS ([data-note-ink]) so each has a paper + dark
// value that stays legible; only the key is stored.
export const NOTE_INK_OPTIONS = [
  ['default', 'Default'], ['sepia', 'Sepia'], ['forest', 'Forest'], ['slate', 'Slate'],
];

// Per-note background palette. Values live in CSS (--nc-*, theme-aware); here we
// only list the keys + a swatch preview colour for the picker (paper tone).
export const NOTE_COLORS = [
  ['default', '#efe7d2'], ['sage', '#e3ead9'], ['sky', '#dbe5ec'],
  ['sand', '#efe1c9'], ['blush', '#f0e1dd'], ['stone', '#e7e1d4'],
];

export function getNoteFont() { try { return localStorage.getItem(FKEY) || 'sans'; } catch { return 'sans'; } }
export function getNoteInk() { try { return localStorage.getItem(CKEY) || 'default'; } catch { return 'default'; } }

export function applyNotePrefs(font = getNoteFont(), ink = getNoteInk()) {
  const r = document.documentElement;
  r.style.setProperty('--note-font', NOTE_FONTS[font] || NOTE_FONTS.sans);
  r.dataset.noteInk = ink;
}
export function setNoteFont(f) { try { localStorage.setItem(FKEY, f); } catch { /* private */ } applyNotePrefs(f, getNoteInk()); }
export function setNoteInk(i) { try { localStorage.setItem(CKEY, i); } catch { /* private */ } applyNotePrefs(getNoteFont(), i); }
