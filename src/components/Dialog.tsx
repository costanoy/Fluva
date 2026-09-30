import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { t } from '../i18n/translations';
import '../styles/dialog.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Base de todo diálogo: véu grafite sem blur, cartão de papel, Esc e clique
 * fora fecham, e o foco fica preso dentro enquanto está aberto (voltando
 * para onde estava ao fechar).
 */
export function Modal({
  children,
  onClose,
  labelledBy,
  className,
}: {
  children: ReactNode;
  onClose: () => void;
  labelledBy?: string;
  className?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const first = card?.querySelector<HTMLElement>('[data-autofocus]') ?? card?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !card) return;
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      } else if (!card.contains(document.activeElement)) {
        e.preventDefault();
        head.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={cardRef}
        className={`dialog-card${className ? ` ${className}` : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogClose({ onClose }: { onClose: () => void }) {
  return (
    <button className="dialog-close" onClick={onClose} aria-label={t('topbar.close')}>
      <Icon name="close" size={20} strokeWidth={2.4} />
    </button>
  );
}

/** A simple centered modal — backdrop click, the close button, or Escape all dismiss it. */
export function Dialog({ title, children, onClose }: { title?: string; children: ReactNode; onClose: () => void }) {
  return (
    <Modal onClose={onClose} labelledBy={title ? 'dialog-title' : undefined}>
      <div className="dialog-main">
        <div className="dialog-head">
          {title && (
            <h2 id="dialog-title" className="display dialog-title">
              {title}
            </h2>
          )}
          <DialogClose onClose={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </Modal>
  );
}
