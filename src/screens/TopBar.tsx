import { useState } from 'react';
import { ChevronDown, FlaskConical, Heart, FileText, Image as ImageIcon, Upload } from 'lucide-react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Logo } from '../components/Logo';
import { useApp } from '../state/AppContext';
import { ExportDropdown } from './ExportDropdown';
import '../styles/top-bar.css';

const DONATE_MESSAGE =
  'O Fluva é completamente gratuito, mantenho o site online e disponível para todos com os meus próprios recursos. ' +
  'Caso tenha interesse em ajudar, pode fazer uma doação pro pix 142.353.286-46 com qualquer valor. ' +
  'Desde já, sou muito grato pelo seu interesse em ajudar no meu projeto!';

export function TopBar() {
  const { state, actions } = useApp();
  const isEditing = state.screen === 'editing';
  const isHome = state.screen === 'empty';
  const [donateOpen, setDonateOpen] = useState(false);

  return (
    <div className="nav top-bar">
      <div className="top-bar-file text-muted">
        {isEditing && (
          <>
            {state.doc.kind === 'pdf' ? <FileText size={15} strokeWidth={2.75} /> : <ImageIcon size={15} strokeWidth={2.75} />}
            <div className="top-bar-file-text">
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
                title="Renomear arquivo"
                aria-label="Nome do arquivo para exportação"
                spellCheck={false}
              />
              <span className="top-bar-pagecount">
                {state.doc.pages.length} {state.doc.pages.length === 1 ? 'página' : 'páginas'}
              </span>
            </div>
          </>
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
        title="Voltar ao início"
      >
        <Logo className="brand-logo" />
        Fluva
      </a>

      {isHome && (
        <div className="top-bar-home-actions">
          <Button variant="primary" onClick={() => actions.setScreen('beta')}>
            <FlaskConical size={15} strokeWidth={2.75} />
            Teste o nosso app
          </Button>
          <Button variant="primary" onClick={() => setDonateOpen(true)}>
            <Heart size={15} strokeWidth={2.75} />
            Doe para o Fluva
          </Button>
        </div>
      )}

      {isEditing && (
        <div className="top-bar-export">
          <Button variant="primary" style={{ padding: '11px 20px', fontSize: 16 }} onClick={actions.toggleExport} disabled={!!state.busy}>
            <Upload size={16} strokeWidth={2.75} />
            <span className="top-bar-export-label">Exportar</span>
            <ChevronDown size={14} strokeWidth={3} />
          </Button>
          {state.exportOpen && <ExportDropdown />}
        </div>
      )}

      {donateOpen && (
        <Dialog title="Ajude o Fluva a continuar no ar" onClose={() => setDonateOpen(false)}>
          {DONATE_MESSAGE}
        </Dialog>
      )}
    </div>
  );
}
