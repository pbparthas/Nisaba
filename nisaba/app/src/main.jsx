import React from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/800.css';
import '@fontsource/great-vibes/400.css';
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/500.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/500.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/500.css';
import '@fontsource/nunito/600.css';

import { registerSW } from 'virtual:pwa-register';

import App from './App.jsx';
import './styles.css';
import { getMode, applyMode } from './lib/theme.js';
import { applyNotePrefs } from './lib/notePrefs.js';
import './lib/pwaInstall.js'; // registers the install-prompt capture before the browser fires it

// Apply saved appearance + note typography before first paint.
applyMode(getMode());
applyNotePrefs();

// Offline app shell. autoUpdate installs a new build and reloads on its own;
// re-check hourly so long-lived sessions don't go stale. The sync engine stays
// in the page (not the SW) by design.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update(), 60 * 60 * 1000); },
});

// Ask the browser to keep our IndexedDB (notes, tasks, attachment blobs) from
// being evicted. Installed PWAs are usually granted this silently.
(async () => {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* unsupported or blocked */ }
})();

// If a lazy chunk 404s because a deploy rotated the hashes mid-session, reload
// once to pick up the new chunk map instead of crashing.
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('ns:reloadedForChunk')) {
    sessionStorage.setItem('ns:reloadedForChunk', '1');
    window.location.reload();
  }
});

createRoot(document.getElementById('root')).render(<App />);
