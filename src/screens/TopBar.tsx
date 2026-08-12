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
            <span className="top-bar-filename">{state.doc.name}</span>
            <span className="top-bar-pagecount">
              {state.doc.pages.length} {state.doc.pages.length === 1 ? 'página' : 'páginas'}
            </span>
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
          <Button onClick={() => actions.setScreen('beta')}>
            <FlaskConical size={15} strokeWidth={2.75} />
            Teste o nosso app
          </Button>
          <Button onClick={() => setDonateOpen(true)}>
            <Heart size={15} strokeWidth={2.75} />
            Doe para o Fluva
          </Button>
        </div>
      )}

      {isEditing && (
        <div className="top-bar-export">
          <Button variant="primary" style={{ padding: '11px 20px', fontSize: 16 }} onClick={actions.toggleExport} disabled={!!state.busy}>
            <Upload size={16} strokeWidth={2.75} />
            Exportar
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
