import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * pdf.js decodes the image formats scanned documents use (CCITT fax, JBIG2,
 * JPEG 2000) with WebAssembly modules it loads at runtime, and reads CJK
 * text and the non-embedded standard fonts (Symbol, ZapfDingbats — form
 * checkmarks) from data files. None of that is bundled: unless pdf.js is told
 * where to fetch them, those images simply come out blank. This serves them in
 * dev and copies them into the build, under a path that carries the pdf.js
 * version so a long-cached copy can never pair with a newer pdf.js.
 */
const PDFJS_DIR = 'node_modules/pdfjs-dist';
const PDFJS_VERSION: string = JSON.parse(readFileSync(join(PDFJS_DIR, 'package.json'), 'utf8')).version;
const PDFJS_ASSETS = `pdfjs/${PDFJS_VERSION}/`;
const PDFJS_FILES: Record<string, (name: string) => boolean> = {
  // The JavaScript-sandbox module (quickjs) is for scripts inside PDFs, which Fluva never runs.
  wasm: (name) => /\.wasm$|_nowasm_fallback\.js$/.test(name) && !name.startsWith('quickjs'),
  cmaps: (name) => name.endsWith('.bcmap'),
  standard_fonts: (name) => /\.(pfb|ttf)$/.test(name),
};

function pdfjsAssets(): Plugin {
  return {
    name: 'fluva-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use(`/${PDFJS_ASSETS}`, (req, res, next) => {
        const [dir, name] = (req.url ?? '').split('?')[0].replace(/^\//, '').split('/');
        if (!dir || !name || !PDFJS_FILES[dir]?.(name)) return next();
        const file = join(PDFJS_DIR, dir, name);
        if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
        if (name.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        if (name.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const [dir, keep] of Object.entries(PDFJS_FILES)) {
        for (const name of readdirSync(join(PDFJS_DIR, dir)).filter(keep)) {
          this.emitFile({ type: 'asset', fileName: `${PDFJS_ASSETS}${dir}/${name}`, source: readFileSync(join(PDFJS_DIR, dir, name)) });
        }
      }
    },
  };
}

export default defineConfig({
  define: {
    __PDFJS_ASSETS__: JSON.stringify(PDFJS_ASSETS),
  },
  plugins: [
    react(),
    pdfjsAssets(),
    VitePWA({
      // Ships every update automatically instead of pinning visitors to
      // whatever was cached on their first visit — this app changes often,
      // and a PWA that silently never updates itself is worse than no PWA.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Fluva',
        short_name: 'Fluva',
        description: 'Edite, junte, divida, comprima e converta arquivos PDF e imagens gratuitamente, direto no navegador.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F5F0E6',
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
        // The default patterns skip .mjs — which is what the pdf.js worker is,
        // so the installed app couldn't open a single PDF offline.
        globPatterns: ['**/*.{js,mjs,css,html}'],
        // pdf.js's decoders and data files (see pdfjsAssets) are fetched only
        // by the documents that need them — 3 MB nobody should download up
        // front. Cached on first use instead, and their path is versioned.
        globIgnores: ['**/pdfjs/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-assets', expiration: { maxEntries: 300 } },
          },
          {
            // The editing fonts (8 MB in all) load when a font is first used;
            // kept from then on so editing keeps working offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/fonts/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fluva-fonts', expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      // One HTML entry per language: each address ("/" and "/en/") ships its
      // own static <head> and fallback text, which is what search engines and
      // link previews read. Both load the same app (see i18n/translations.ts).
      input: { main: 'index.html', en: 'en/index.html' },
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
