// Global styles first, so each screen's own stylesheet (imported by its
// component) comes after them in the cascade and can override the base rules.
import './styles/tokens.css';
import './styles/base.css';
import './styles/fonts.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// A tab opened before an update asks for files of the old version, which the
// server no longer has: opening the editor would leave a blank page. Reload
// once onto the new version — never with the editor open (its unsaved work
// matters more, and a failed export there already says so).
window.addEventListener('vite:preloadError', (event) => {
  if (document.querySelector('.editing-shell')) return;
  try {
    if (sessionStorage.getItem('fluva-reloaded-for-update')) return;
    sessionStorage.setItem('fluva-reloaded-for-update', '1');
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

// The website keeps working offline through a service worker. The desktop app
// carries its own files: a service worker there only kept serving an older
// version's copies after an update, so it is removed instead (once — the
// reload then runs without it).
if ('serviceWorker' in navigator) {
  if ('__TAURI_INTERNALS__' in window) {
    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      if (!registrations.length) return;
      await Promise.all(registrations.map((registration) => registration.unregister()));
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
      if (navigator.serviceWorker.controller) window.location.reload();
    });
  } else if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' });
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
