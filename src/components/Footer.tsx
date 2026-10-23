import type { MouseEvent } from 'react';
import { Logo } from './Logo';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { t } from '../i18n/translations';

const CONTACT_URL = 'https://portfolio.cyberhat.com.br';

/** In the app, a link would open the page inside the app's own window, with
 * no way back: it goes to the system's browser instead. */
function openOutside(e: MouseEvent<HTMLAnchorElement>) {
  if (!('__TAURI_INTERNALS__' in window)) return;
  e.preventDefault();
  const url = e.currentTarget.href;
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('plugin:opener|open_url', { url }));
}

/** Rodapé verde com grão e a logo mono. */
export function Footer() {
  const install = useInstallPrompt();

  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <div className="site-footer-brand">
          <div className="site-footer-logo">
            <Logo width={55} variant="mono" />
            <span className="wordmark">Fluva</span>
          </div>
          <p className="site-footer-tagline">
            <span className="only-desktop">{t('footer.taglineLong')}</span>
            <span className="only-mobile">{t('footer.taglineDevice')}</span>
          </p>
        </div>
        <div className="site-footer-links">
          <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer" onClick={openOutside}>
            {t('footer.contact')}
          </a>
          {install && (
            <button type="button" onClick={install}>
              {t('home.installApp')}
            </button>
          )}
        </div>
      </div>
      <div className="site-footer-legal">
        <span>© {new Date().getFullYear()} Fluva</span>
        <span>fluva.cyberhat.com.br</span>
      </div>
    </footer>
  );
}
