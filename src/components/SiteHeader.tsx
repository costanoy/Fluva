import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { useApp } from '../state/AppContext';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { buildPixPayload, normalizePixKey } from '../pix';
import { t, type Lang } from '../i18n/translations';

const PIX_PAYLOAD = buildPixPayload({ key: normalizePixKey('142.353.286-46'), name: 'VINICIUS COSTA', city: 'BRASILIA' });

/** Renders the static Pix BR Code as a scannable QR — any bank app reads it
 * straight into a transfer to this key, amount left for the payer to choose. */
function PixQrCode() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(PIX_PAYLOAD, { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!dataUrl) return null;
  return (
    <div className="pix-qr">
      <img src={dataUrl} alt={t('topbar.donateQrAlt')} width={220} height={220} />
    </div>
  );
}

const LANGS: Array<{ key: Lang; label: string }> = [
  { key: 'pt', label: 'PT' },
  { key: 'en', label: 'EN' },
];

export function LangToggle() {
  const { state, actions } = useApp();
  return (
    <div className="seg-group lang-toggle" role="group" aria-label={t('topbar.lang')}>
      {LANGS.map((l) => (
        <button key={l.key} aria-pressed={state.lang === l.key} onClick={() => actions.setLang(l.key)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Cabeçalho do site (início e tela do app de testes): logo à esquerda,
 * navegação à direita; no celular a navegação vira um menu. */
export function SiteHeader({ showToolsLink = false }: { showToolsLink?: boolean }) {
  const { actions } = useApp();
  const install = useInstallPrompt();
  const [donateOpen, setDonateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && e.target instanceof Node && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const links = (onPick: () => void) => (
    <>
      {showToolsLink && (
        <a className="site-nav-link" href="#ferramentas" onClick={onPick}>
          {t('home.navTools')}
        </a>
      )}
      <button
        className="site-nav-link"
        onClick={() => {
          onPick();
          actions.setScreen('beta');
        }}
      >
        {t('topbar.testApp')}
      </button>
      <button
        className="site-nav-link"
        onClick={() => {
          onPick();
          setDonateOpen(true);
        }}
      >
        {t('topbar.donate')}
      </button>
    </>
  );

  return (
    <header className="site-header">
      <a
        href="/"
        className="site-brand"
        onClick={(e) => {
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          actions.setScreen('empty');
        }}
      >
        <Logo width={61} className="site-brand-logo" />
        <span className="wordmark site-brand-word">Fluva</span>
      </a>

      <nav className="site-nav" aria-label="Fluva">
        {links(() => {})}
        <LangToggle />
        {install && (
          <button className="btn btn-secondary" onClick={install}>
            {t('home.installApp')}
          </button>
        )}
      </nav>

      <div className="site-menu" ref={menuRef}>
        <button
          className="site-menu-btn"
          aria-label={t('home.menu')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        {menuOpen && (
          <div className="popover site-menu-panel">
            {links(() => setMenuOpen(false))}
            {install && (
              <button
                className="site-nav-link"
                onClick={() => {
                  setMenuOpen(false);
                  install();
                }}
              >
                <Icon name="download" size={18} />
                {t('home.installApp')}
              </button>
            )}
            <div className="site-menu-lang">
              <LangToggle />
            </div>
          </div>
        )}
      </div>

      {donateOpen && (
        <Dialog title={t('topbar.donateTitle')} onClose={() => setDonateOpen(false)}>
          <p className="dialog-text">{t('topbar.donateMessage')}</p>
          <PixQrCode />
        </Dialog>
      )}
    </header>
  );
}
