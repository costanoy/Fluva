import { useEffect, useState } from 'react';

export const DESKTOP_BREAKPOINT = 900;

export function useIsDesktop(breakpoint = DESKTOP_BREAKPOINT): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(`(min-width: ${breakpoint}px)`).matches);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = () => setIsDesktop(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isDesktop;
}
