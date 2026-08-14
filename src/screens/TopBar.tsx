import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ChevronDown, FlaskConical, Heart, FileText, Image as ImageIcon, Upload } from 'lucide-react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Logo } from '../components/Logo';
import { useApp } from '../state/AppContext';
import { buildPixPayload, normalizePixKey } from '../pix';
import { t, type Lang } from '../i18n/translations';
import { ExportDropdown } from './ExportDropdown';
import '../styles/top-bar.css';

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
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-3)' }}>
      <img src={dataUrl} alt={t('topbar.donateQrAlt')} width={220} height={220} style={{ borderRadius: 'var(--radius-md)' }} />
    </div>
  );
}

const LANGS: Array<{ key: Lang; label: string }> = [
  { key: 'pt', label: 'PT' },
  { key: 'en', label: 'EN' },
];

function LangToggle() {
  const { state, actions } = useApp();
  return (
    <div className="lang-toggle" role="group" aria-label={t('topbar.lang')}>
      {LANGS.map((l) => (
        <button
          key={l.key}
          className="lang-toggle-btn"
          aria-pressed={state.lang === l.key}
          style={{
            background: state.lang === l.key ? 'var(--color-accent)' : 'transparent',
            color: state.lang === l.key ? '#FFFFFF' : 'var(--color-text)',
          }}
          onClick={() => actions.setLang(l.key)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export function TopBar() {
  const { state, actions } = useApp();
  const isEditing = state.screen === 'editing';
  const isHome = state.screen === 'empty';
  const [donateOpen, setDonateOpen] = useState(false);

  return (
    <div className="nav top-bar">
      <div className="top-bar-file text-muted">
        {isEditing && (
          <div className="top-bar-file-text">
            <div className="top-bar-file-row">
              {state.doc.kind === 'pdf' ? <FileText size={15} strokeWidth={2.75} /> : <ImageIcon size={15} strokeWidth={2.75} />}
              <input
                className="top-bar-filename-input"
                value={state.doc.name}
                // Every export filename comes from this same name (see baseNameFor
                // in pdf/exporters.ts) — editing it here is the one place that
                // controls what the downloaded file is actually called.
                onChange={(e) => actions.renameDocument(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  // An empty name would export as "documento" silently (baseNameFor's
                  // fallback) — restoring a visible placeholder here instead keeps
                  // that behavior from looking like the field just ate the text.
                  if (!e.target.value.trim()) actions.renameDocument('documento');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                title={t('topbar.renameTitle')}
                aria-label={t('topbar.renameAria')}
                spellCheck={false}
              />
            </div>
            <span className="top-bar-pagecount">
              {state.doc.pages.length === 1
                ? t('topbar.page', { count: state.doc.pages.length })
                : t('topbar.pages', { count: state.doc.pages.length })}
            </span>
          </div>
        )}
      </div>

      <a
        href="/"
        className="nav-brand top-bar-brand"
        onClick={(e) => {
          // A real <a href> so the middle mouse button (or Ctrl/Cmd-click) opens
          // Fluva's home in a new tab the normal browser way — none of those
          // reach onClick at all, so only a plain left click needs handling here,
          // delegating to the browser's own Back button so it stays in lockstep
          // with pressing Back for real (see App.tsx's popstate handler).
          if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          if (isEditing) window.history.back();
          else actions.reset();
        }}
        title={t('topbar.backHome')}
      >
        <Logo className="brand-logo" />
        Fluva
      </a>

      {isHome && (
        <div className="top-bar-home-actions">
          <LangToggle />
          <Button variant="primary" onClick={() => actions.setScreen('beta')}>
            <FlaskConical size={15} strokeWidth={2.75} />
            {t('topbar.testApp')}
          </Button>
          <Button variant="primary" onClick={() => setDonateOpen(true)}>
            <Heart size={15} strokeWidth={2.75} />
            {t('topbar.donate')}
          </Button>
        </div>
      )}

      {isEditing && (
        <div className="top-bar-export">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LangToggle />
            <Button variant="primary" style={{ padding: '11px 20px', fontSize: 16 }} onClick={actions.toggleExport} disabled={!!state.busy}>
              <Upload size={16} strokeWidth={2.75} />
              <span className="top-bar-export-label">{t('topbar.export')}</span>
              <ChevronDown size={14} strokeWidth={3} />
            </Button>
          </div>
          {state.exportOpen && <ExportDropdown />}
        </div>
      )}

      {donateOpen && (
        <Dialog title={t('topbar.donateTitle')} onClose={() => setDonateOpen(false)}>
          {t('topbar.donateMessage')}
          <PixQrCode />
        </Dialog>
      )}
    </div>
  );
}
