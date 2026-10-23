import type { MouseEvent, ReactNode } from 'react';

/** Where "Contato" leads: the author's portfolio, with every way to reach him. */
export const PORTFOLIO_URL = 'https://portfolio.cyberhat.com.br';

/** In the app, a link would open the page inside the app's own window, with
 * no way back: it goes to the system's browser instead (the app may open
 * only the portfolio — see src-tauri/capabilities/default.json). */
function openOutside(e: MouseEvent<HTMLAnchorElement>) {
  if (!('__TAURI_INTERNALS__' in window)) return;
  e.preventDefault();
  const url = e.currentTarget.href;
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('plugin:opener|open_url', { url }));
}

/** A link to another site: a new tab on the website, the system's browser in the app. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={openOutside}>
      {children}
    </a>
  );
}
