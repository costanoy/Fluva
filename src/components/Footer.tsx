import { t } from '../i18n/translations';

export function Footer() {
  return (
    <footer className="site-footer">
      <span className="site-footer-brand">Fluva</span>
      <span className="site-footer-dot">·</span>
      <span>{t('footer.tagline')}</span>
      <span className="site-footer-dot">·</span>
      <span>© {new Date().getFullYear()}</span>
      <span className="site-footer-dot">·</span>
      <span>Cyberhat</span>
    </footer>
  );
}
