import { X } from 'lucide-react';
import { Toast } from '../components/Toast';
import { useApp } from '../state/AppContext';
import { EditorCanvas } from './EditorCanvas';
import { RightPanel } from './RightPanel';
import { ThumbnailRail } from './ThumbnailRail';
import { Toolbar } from './Toolbar';
import { t } from '../i18n/translations';
import '../styles/editing-screen.css';

export function EditingScreen() {
  const { state, actions } = useApp();

  return (
    <div className="editing-shell">
      <Toolbar />

      <div className="editing-screen" onClick={actions.closeExport}>
        <ThumbnailRail />
        <EditorCanvas />
        <RightPanel />
      </div>

      {state.busy && (
        <div className="busy-overlay">
          <div className="busy-card">
            <div className="busy-spinner" />
            <span>{state.busy.label}</span>
            {state.busy.total ? (
              <span className="busy-progress">
                {state.busy.done ?? 0} / {state.busy.total}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {state.error && (
        <div className="error-banner">
          <span>{state.error}</span>
          <button aria-label={t('home.dismiss')} onClick={actions.clearError}>
            <X size={14} strokeWidth={2.75} />
          </button>
        </div>
      )}

      {state.toast && <Toast message={state.toast} onDismiss={actions.dismissToast} />}
    </div>
  );
}
