import { Icon } from '../components/Icon';
import { Toast } from '../components/Toast';
import { useApp } from '../state/AppContext';
import { EditorCanvas } from './EditorCanvas';
import { RightPanel } from './RightPanel';
import { ThumbnailRail } from './ThumbnailRail';
import { MobileTabBar, Toolbar } from './Toolbar';
import { t } from '../i18n/translations';
import '../styles/editing-screen.css';

export function EditingScreen() {
  const { state, actions } = useApp();

  return (
    <div className="editing-shell">
      <Toolbar />

      <div className={`editing-screen${state.toolMode === 'merge' ? ' editing-screen-merge' : ''}`} onClick={actions.closeExport}>
        <ThumbnailRail />
        <EditorCanvas />
        <RightPanel />
      </div>

      <MobileTabBar />

      {state.busy && (
        <div className="busy-overlay">
          <div className="busy-card" role="status">
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
        <div className="error-banner alert" role="alert">
          <span className="alert-mark" aria-hidden="true">
            !
          </span>
          <div className="alert-body">
            <div className="alert-text">{state.error}</div>
          </div>
          <button className="alert-close" aria-label={t('home.dismiss')} onClick={actions.clearError}>
            <Icon name="close" size={18} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {state.toast && <Toast message={state.toast} onDismiss={actions.dismissToast} />}
    </div>
  );
}
