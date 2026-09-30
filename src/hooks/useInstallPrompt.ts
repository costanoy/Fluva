import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Captured at module load, not inside the hook — the browser fires
// `beforeinstallprompt` once, early, often before any component mounts.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/**
 * The PWA's own "install" prompt, when the browser offers one — `null` when
 * it doesn't (already installed, unsupported browser, iOS Safari), so the
 * "Instalar app" button only ever shows up when clicking it would actually
 * do something.
 */
export function useInstallPrompt(): (() => void) | null {
  const [available, setAvailable] = useState(!!deferred);

  useEffect(() => {
    const update = () => setAvailable(!!deferred);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (!available) return null;
  return () => {
    const ev = deferred;
    if (!ev) return;
    void ev.prompt();
    void ev.userChoice.finally(() => {
      deferred = null;
      listeners.forEach((l) => l());
    });
  };
}
