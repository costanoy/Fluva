import { AppProvider, useApp } from './state/AppContext';
import { TopBar } from './screens/TopBar';
import { EmptyState } from './screens/EmptyState';
import { EditingScreen } from './screens/EditingScreen';

function AppShell() {
  const { state } = useApp();

  return (
    <div style={{ width: '100%', height: '100dvh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar />
      {state.screen === 'empty' ? <EmptyState /> : <EditingScreen />}
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
