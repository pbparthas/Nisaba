import React from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/saira-condensed/800.css';
import '@fontsource/great-vibes/400.css';
import '@fontsource/sacramento/400.css';

import App from './App.jsx';
import './styles.css';
import { getMode, applyMode } from './lib/theme.js';

// Apply the saved appearance mode before first paint (default: paper).
applyMode(getMode());

createRoot(document.getElementById('root')).render(<App />);
