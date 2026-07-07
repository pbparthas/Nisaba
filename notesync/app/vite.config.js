import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves from /<repo>/ — override at build time if needed.
  base: process.env.NOTESYNC_BASE || '/',
  test: {
    environment: 'node',
  },
});
