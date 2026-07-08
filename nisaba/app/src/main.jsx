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

import App from './App.jsx';
import './styles.css';
import { getMode, applyMode } from './lib/theme.js';
import { applyNotePrefs } from './lib/notePrefs.js';

// Apply saved appearance + note typography before first paint.
applyMode(getMode());
applyNotePrefs();

createRoot(document.getElementById('root')).render(<App />);
