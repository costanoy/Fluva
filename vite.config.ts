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
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // The PDF libraries are large and change far less often than app code.
        // Splitting them keeps their chunks cached across deploys.
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
          pdflib: ['pdf-lib', '@pdf-lib/fontkit'],
          // Only pulled in when the user exports to Word.
          docx: ['docx'],
          react: ['react', 'react-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
