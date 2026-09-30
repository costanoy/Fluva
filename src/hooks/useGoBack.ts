import { useApp } from '../state/AppContext';

/**
 * Same navigation the explicit "Voltar" button and clicking the brand both
 * trigger — delegating to the browser's own Back button when a breadcrumb
 * was left (see App.tsx's popstate handler) keeps this in lockstep with
 * pressing Back for real, unsaved-changes confirmation included.
 */
export function useGoBack(): () => void {
  const { state, actions } = useApp();
  const hasHistoryBreadcrumb = state.screen === 'editing' || state.screen === 'reading';
  return () => {
    if (hasHistoryBreadcrumb) window.history.back();
    else actions.reset();
  };
}
