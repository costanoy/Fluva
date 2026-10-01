import { Logo } from './Logo';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { t } from '../i18n/translations';

const CONTACT_EMAIL = 'vinicostamaga@outlook.com';

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
          <a href={`mailto:${CONTACT_EMAIL}`}>{t('footer.contact')}</a>
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
