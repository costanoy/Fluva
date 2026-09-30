import { Button } from '../components/Button';
import { Footer } from '../components/Footer';
import { Icon } from '../components/Icon';
import { RisoHeading } from '../components/Logo';
import { SiteHeader } from '../components/SiteHeader';
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
    <div className="home grain">
      <SiteHeader />
      <div className="beta-card">
        <span className="tool-card-icon halftone-pink">
          <Icon name="phone" size={30} />
        </span>
        <RisoHeading as="h1" className="beta-card-title" shadowText={t('beta.title')}>
          {t('beta.title')}
        </RisoHeading>
        <p>
          {bodyBefore}
          <a href={`mailto:${EMAIL}`}>
            <strong>{EMAIL}</strong>
          </a>
          {bodyAfter}
        </p>
        <Button variant="primary" style={{ alignSelf: 'flex-start' }} onClick={() => actions.setScreen('empty')}>
          <Icon name="chevronLeft" size={18} />
          {t('beta.back')}
        </Button>
      </div>
      <Footer />
    </div>
  );
}
