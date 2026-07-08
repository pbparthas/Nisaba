/* Appearance mode: "paper" (default) or "dark" ("lights out"), ported from the
   Golazo "Matchday Programme" system. The attribute lives on <html> so the CSS
   variable overrides apply before React mounts, and the browser chrome colour
   follows via the theme-color meta. Default is always paper — the owner chose
   paper-on-open regardless of the OS setting. */
const KEY = 'ns:mode';
const THEME_COLOR = { paper: '#e2d6ba', dark: '#171410' };

export function getMode() {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'paper';
  } catch {
    return 'paper';
  }
}

export function applyMode(mode) {
  const m = mode === 'dark' ? 'dark' : 'paper';
  try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
  if (m === 'dark') document.documentElement.dataset.mode = 'dark';
  else delete document.documentElement.dataset.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[m]);
}
