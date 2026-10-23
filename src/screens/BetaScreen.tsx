import { Button } from '../components/Button';
import { ExternalLink, PORTFOLIO_URL } from '../components/ExternalLink';
import { Footer } from '../components/Footer';
import { Icon } from '../components/Icon';
import { RisoHeading } from '../components/Logo';
import { SiteHeader } from '../components/SiteHeader';
import { useApp } from '../state/AppContext';
import { t } from '../i18n/translations';
import '../styles/empty-state.css';

// A sentinel unlikely to appear in real copy. Splitting the translated
// string on it recovers whatever comes before/after the link so it can be
// bolded on its own, regardless of where each language's sentence puts it.
const LINK_SENTINEL = '@@LINK@@';

/** Invites visitors to get in touch (through the author's portfolio) for early access to a mobile app version — no gate, just a signup. */
export function BetaScreen() {
  const { actions } = useApp();
  // Recomputed every render (not hoisted to module scope) so a language
  // switch is picked up immediately, same as every other `t()` call here.
  const [bodyBefore, bodyAfter] = t('beta.body', { link: LINK_SENTINEL }).split(LINK_SENTINEL);

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
          <ExternalLink href={PORTFOLIO_URL}>
            <strong>{PORTFOLIO_URL.replace(/^https:\/\//, '')}</strong>
          </ExternalLink>
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
