import { createContext, useContext, type ReactNode } from 'react';
import { useFluvaStore, type FluvaActions } from './useFluvaStore';
import type { AppState } from './appTypes';

interface AppContextValue {
  state: AppState;
  actions: FluvaActions;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { state, actions } = useFluvaStore();
  return <AppContext.Provider value={{ state, actions }}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}
