import { X } from 'lucide-react';
import { t } from '../i18n/translations';

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--color-neutral-900)',
        color: 'var(--color-neutral-100)',
        padding: '12px 18px',
        borderRadius: 'var(--radius-md)',
        fontSize: 15,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: 'var(--shadow-lg)',
        zIndex: 60,
        maxWidth: '90%',
      }}
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        aria-label={t('topbar.close')}
        style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'flex', flexShrink: 0, padding: 0 }}
      >
        <X size={14} strokeWidth={2.75} />
      </button>
    </div>
  );
}
