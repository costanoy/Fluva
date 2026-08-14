import { FlaskConical } from 'lucide-react';
import { Button } from '../components/Button';
import { Footer } from '../components/Footer';
import { useApp } from '../state/AppContext';
import { t } from '../i18n/translations';
import '../styles/empty-state.css';

const EMAIL = 'vinicostamaga@outlook.com';
// A sentinel unlikely to appear in real copy. Splitting the translated
// string on it recovers whatever comes before/after the email so it can be
// bolded on its own, regardless of where each language's sentence puts it.
const EMAIL_SENTINEL = '@@EMAIL@@';

/** Invites visitors to email in for early access to a mobile app version — no gate, just a signup. */
export function BetaScreen() {
  const { actions } = useApp();
  // Recomputed every render (not hoisted to module scope) so a language
  // switch is picked up immediately, same as every other `t()` call here.
  const [bodyBefore, bodyAfter] = t('beta.body', { email: EMAIL_SENTINEL }).split(EMAIL_SENTINEL);

  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <div className="empty-state-content">
          <div className="pending-card" style={{ padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="dropzone-icon">
              <FlaskConical size={20} strokeWidth={2.75} color="var(--color-accent)" />
            </div>
            <h4 style={{ textAlign: 'center' }}>{t('beta.title')}</h4>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--color-neutral-700)', margin: 0, textAlign: 'justify' }}>
              {bodyBefore}
              <strong>{EMAIL}</strong>
              {bodyAfter}
            </p>

            <Button variant="primary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => actions.setScreen('empty')}>
              {t('beta.back')}
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}
