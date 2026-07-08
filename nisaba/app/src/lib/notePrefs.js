// User-chosen note typography (global) + the per-note background palette.
// Font/size/weight/style/ink are global prefs in localStorage, applied as CSS
// variables on <html>; the note colour is stored per item ([data-color]).

const KEYS = { font: 'ns:noteFont', size: 'ns:noteSize', weight: 'ns:noteWeight', style: 'ns:noteStyle', ink: 'ns:noteInk' };

export const NOTE_FONTS = {
  sans: '"Inter", system-ui, -apple-system, sans-serif',
  serif: '"Spectral", Georgia, "Times New Roman", serif',
  book: '"Lora", Georgia, serif',
  rounded: '"Nunito", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};
export const NOTE_FONT_OPTIONS = [
  ['sans', 'Sans'], ['serif', 'Serif'], ['book', 'Book'], ['rounded', 'Rounded'], ['mono', 'Mono'],
];
export const NOTE_SIZE_OPTIONS = [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']];
const SIZE_PX = { s: '15px', m: '16.5px', l: '18.5px' };
export const NOTE_WEIGHT_OPTIONS = [['regular', 'Regular'], ['medium', 'Medium'], ['semibold', 'Semibold']];
const WEIGHT_N = { regular: '400', medium: '500', semibold: '600' };
export const NOTE_STYLE_OPTIONS = [['normal', 'Normal'], ['italic', 'Italic']];

// Ink resolves through CSS ([data-note-ink]) so each has a legible paper + dark
// value; only the key is stored.
export const NOTE_INK_OPTIONS = [
  ['default', 'Default'], ['sepia', 'Sepia'], ['forest', 'Forest'], ['slate', 'Slate'],
];

// Per-note background palette (values in CSS, theme-aware).
export const NOTE_COLORS = [
  ['default', '#efe7d2'], ['sage', '#e3ead9'], ['sky', '#dbe5ec'],
  ['sand', '#efe1c9'], ['blush', '#f0e1dd'], ['stone', '#e7e1d4'],
];

const get = (k, d) => { try { return localStorage.getItem(KEYS[k]) || d; } catch { return d; } };
export const getNoteFont = () => get('font', 'sans');
export const getNoteSize = () => get('size', 'm');
export const getNoteWeight = () => get('weight', 'regular');
export const getNoteStyle = () => get('style', 'normal');
export const getNoteInk = () => get('ink', 'default');

export function applyNotePrefs() {
  const r = document.documentElement;
  const font = getNoteFont();
  r.style.setProperty('--note-font', NOTE_FONTS[font] || NOTE_FONTS.sans);
  r.style.setProperty('--note-size', SIZE_PX[getNoteSize()] || SIZE_PX.m);
  r.style.setProperty('--note-weight', WEIGHT_N[getNoteWeight()] || '400');
  r.style.setProperty('--note-style', getNoteStyle() === 'italic' ? 'italic' : 'normal');
  r.dataset.noteInk = getNoteInk();
}

export function setNotePref(kind, value) {
  try { localStorage.setItem(KEYS[kind], value); } catch { /* private */ }
  applyNotePrefs();
}
