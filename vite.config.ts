import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ships every update automatically instead of pinning visitors to
      // whatever was cached on their first visit — this app changes often,
      // and a PWA that silently never updates itself is worse than no PWA.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Fluva',
        short_name: 'Fluva',
        description: 'Edite, junte, divida, comprima e converta arquivos PDF e imagens gratuitamente, direto no navegador.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#DBDBD6',
        theme_color: '#1D9E75',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The pdf.js worker and pdf-lib chunks each run over 1MB — comfortably
        // under this, but the default 2MB ceiling was close enough to worry
        // about the next dependency bump silently dropping a chunk from the
        // precache instead of failing the build loudly.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // The default navigateFallback sends every direct navigation to
        // index.html — right for a bookmarked/offline app reload, wrong for
        // a bot or a browser fetching a real static file at the root
        // (robots.txt, sitemap.xml, the OG share image): without this, a
        // visitor whose browser already has the service worker installed
        // gets the app shell back instead of the actual file.
        navigateFallbackDenylist: [/^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/og-image\.png$/, /^\/manifest\.webmanifest$/],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // pdfjs-dist and react are needed eagerly (the reader renders pages
        // with pdf.js on first load), so they're still worth pulling into
        // their own named, long-cacheable vendor chunks. pdf-lib/fontkit and
        // docx are deliberately NOT listed here — they're only ever reached
        // through a dynamic import() now (see useFluvaStore.ts/fonts.ts), and
        // the object form of manualChunks was forcing Vite to still treat
        // them as always-preloaded from the entry HTML regardless, which
        // defeated the whole point of deferring them. Leaving them out lets
        // Rollup's automatic splitting place them in genuinely async chunks.
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          react: ['react', 'react-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
