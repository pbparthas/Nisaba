import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We ship our own public/manifest.webmanifest (linked in index.html).
      manifest: false,
      includeAssets: ['icon.svg', 'manifest.webmanifest', 'pwa-192.png', 'pwa-512.png', 'pwa-512-maskable.png'],
      workbox: {
        // Precache the app shell + code; fonts are cached on demand (only the
        // families the user actually picks) to keep the install lean.
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Network-first for the app document (fresh code when online, cached
        // shell when offline) — never cache-first for HTML, which once served
        // stale builds. Hashed assets are immutable so precache is fine.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/drive/, /googleapis/, /accounts\.google/],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'pages', networkTimeoutSeconds: 3 },
          },
          {
            urlPattern: ({ url }) => /\.woff2?$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  // GitHub Pages serves from /<repo>/ — override at build time if needed.
  base: process.env.NISABA_BASE || '/',
  test: {
    environment: 'node',
  },
});
