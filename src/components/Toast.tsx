import { Icon } from './Icon';
import { t } from '../i18n/translations';

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      <button onClick={onDismiss} aria-label={t('topbar.close')}>
        <Icon name="close" size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}
