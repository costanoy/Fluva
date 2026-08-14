import { useEffect, useRef } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { TopBar } from './screens/TopBar';
import { EmptyState } from './screens/EmptyState';
import { BetaScreen } from './screens/BetaScreen';
import { EditingScreen } from './screens/EditingScreen';
import { t } from './i18n/translations';

function AppShell() {
  const { state, actions } = useApp();
  const pushedHistoryRef = useRef(false);

  // Closing the tab, refreshing, or navigating away with unexported edits would
  // silently lose them — nothing here is saved anywhere but this browser tab.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.dirty]);

  // Leave a breadcrumb in the browser's own history the moment a document is
  // opened, so its Back button returns to Fluva's start screen instead of
  // leaving the site outright — this is a single-page app with no routing, so
  // without this the very first Back press would navigate away entirely.
  useEffect(() => {
    if (state.screen === 'editing' && !pushedHistoryRef.current) {
      window.history.pushState({ fluvaScreen: 'editing' }, '', window.location.href);
      pushedHistoryRef.current = true;
    } else if (state.screen === 'empty') {
      pushedHistoryRef.current = false;
    }
  }, [state.screen]);

  useEffect(() => {
    const onPopState = () => {
      if (state.screen !== 'editing') return;
      if (state.dirty && !window.confirm(t('nav.unsavedChanges'))) {
        // Cancel the back navigation by re-planting the same breadcrumb.
        window.history.pushState({ fluvaScreen: 'editing' }, '', window.location.href);
        return;
      }
      actions.reset();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [state.screen, state.dirty, actions]);

  return (
    <div style={{ width: '100%', height: '100dvh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar />
      {state.screen === 'empty' ? <EmptyState /> : state.screen === 'beta' ? <BetaScreen /> : <EditingScreen />}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
