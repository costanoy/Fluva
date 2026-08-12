import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import '../styles/dialog.css';

/** A simple centered modal — backdrop click, the close button, or Escape all dismiss it. */
export function Dialog({ title, children, onClose }: { title?: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="dialog-close" onClick={onClose} aria-label="Fechar">
          <X size={16} strokeWidth={2.75} />
        </button>
        {title && <h6 className="dialog-title">{title}</h6>}
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
