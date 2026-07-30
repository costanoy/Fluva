import { ChevronDown, FileText, Image as ImageIcon, Upload } from 'lucide-react';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { useApp } from '../state/AppContext';
import { ExportDropdown } from './ExportDropdown';
import '../styles/top-bar.css';

export function TopBar() {
  const { state, actions } = useApp();
  const isEditing = state.screen === 'editing';

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

      <button className="nav-brand top-bar-brand" onClick={actions.reset} title="Voltar ao início">
        <Logo />
        Fluva
      </button>

      {isEditing && (
        <div className="top-bar-export">
          <Button variant="primary" style={{ padding: '11px 20px', fontSize: 14 }} onClick={actions.toggleExport} disabled={!!state.busy}>
            <Upload size={16} strokeWidth={2.75} />
            Exportar
            <ChevronDown size={14} strokeWidth={3} />
          </Button>
          {state.exportOpen && <ExportDropdown />}
        </div>
      )}
    </div>
  );
}
