import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Button } from '../components/Button';
import { Footer } from '../components/Footer';
import { Icon, type IconName } from '../components/Icon';
import { Logo, RisoHeading } from '../components/Logo';
import { SiteHeader } from '../components/SiteHeader';
import { useApp } from '../state/AppContext';
import type { FileRejection } from '../state/appTypes';
import { formatBytes } from '../pdf/loader';
import { t, type TranslationKey } from '../i18n/translations';
import '../styles/empty-state.css';

const CONVERT_TARGETS: Array<{ key: 'pdf' | 'png' | 'jpg'; label: string }> = [
  { key: 'pdf', label: 'PDF' },
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
];

/** What Fluva can already do — kept to the real toolbar/export feature set,
 * nothing aspirational. Tints alternate green/pink as in the design. */
const FEATURES: Array<{ icon: IconName; labelKey: TranslationKey; subKey?: TranslationKey; tone: 'green' | 'pink' }> = [
  { icon: 'edit', labelKey: 'home.featureEdit', tone: 'green' },
  { icon: 'merge', labelKey: 'home.featureMerge', tone: 'pink' },
  { icon: 'split', labelKey: 'home.featureSplit', tone: 'green' },
  { icon: 'compress', labelKey: 'home.featureCompress', tone: 'pink' },
  { icon: 'rotate', labelKey: 'home.featureRotate', tone: 'pink' },
  { icon: 'watermark', labelKey: 'home.featureWatermark', tone: 'green' },
  { icon: 'convert', labelKey: 'home.featureConvert', tone: 'pink' },
  { icon: 'sign', labelKey: 'home.featureSign', subKey: 'home.featureSignSub', tone: 'green' },
];

const SHEET_EXT = /^(xlsx?|xlsm|ods|csv|numbers)$/;
const DOC_EXT = /^(docx?|odt|rtf|txt|pages|md)$/;
const SLIDES_EXT = /^(pptx?|odp|key)$/;
const IMAGE_EXT = /^(gif|webp|heic|heif|bmp|tiff?|svg|avif|ico|raw)$/;

function rejectionText(r: FileRejection): { title: string; body: string } {
  if (r.kind === 'size') {
    return { title: t('home.tooLargeTitle'), body: t('home.tooLargeBody', { name: r.name, size: formatBytes(r.size) }) };
  }
  const dot = r.name.lastIndexOf('.');
  const ext = dot > 0 ? r.name.slice(dot + 1).toLowerCase() : '';
  const title = ext ? t('home.badTypeTitle', { ext }) : t('home.badTypeTitleNoExt');
  if (IMAGE_EXT.test(ext)) return { title, body: t('home.badTypeBodyImage', { what: t('home.kindImage') }) };
  const what = SHEET_EXT.test(ext)
    ? t('home.kindSheet')
    : DOC_EXT.test(ext)
      ? t('home.kindDocument')
      : SLIDES_EXT.test(ext)
        ? t('home.kindPresentation')
        : t('home.kindFile');
  return { title, body: t('home.badTypeBodyPdf', { what }) };
}

function Alert({ title, body, onClose }: { title: string; body: string; onClose?: () => void }) {
  return (
    <div className="alert" role="alert">
      <span className="alert-mark" aria-hidden="true">
        !
      </span>
      <div className="alert-body">
        <div className="alert-title">{title}</div>
        <div className="alert-text">{body}</div>
      </div>
      {onClose && (
        <button className="alert-close" aria-label={t('home.dismiss')} onClick={onClose}>
          <Icon name="close" size={18} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
}

export function EmptyState() {
  const { state, actions } = useApp();
  const [dragOver, setDragOver] = useState(false);
  const [converting, setConverting] = useState(false);
  const [target, setTarget] = useState<'pdf' | 'png' | 'jpg'>('pdf');
  const dragDepth = useRef(0);

  // Arrastar um arquivo sobre qualquer parte da janela já mostra "Solte para
  // abrir" — e soltar em qualquer lugar abre, em vez de o navegador trocar a
  // página pelo arquivo.
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) actions.addFiles(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [actions]);

  const hasQueue = state.queue.length > 0;
  const rejections = state.fileRejections;
  const hasProblem = rejections.length > 0;
  const pick = (e?: MouseEvent) => {
    e?.stopPropagation();
    void actions.pickFiles();
  };

  const [titleFirst, ...titleRest] = t('home.pageTitle').split(' ');

  return (
    <div className="home grain">
      <SiteHeader showToolsLink />

      <section className="home-hero">
        <div className="home-hero-copy">
          <RisoHeading as="h1" className="home-title" shadowText={t('home.pageTitle')} offset={[4, 3]}>
            <span className="home-title-accent">{titleFirst}</span> {titleRest.join(' ')}
          </RisoHeading>
          <p className="home-subtitle">{t('home.heroSubtitle')}</p>
          <div className="home-badges">
            <span className="pill pill-green">
              <span className="pill-dot" />
              {t('home.badgeNoSignup')}
            </span>
            <span className="pill pill-green only-desktop">
              <span className="pill-dot" />
              {t('home.badgeNoInstall')}
            </span>
            <span className="pill pill-pink">
              <span className="pill-dot" />
              <span className="only-desktop">{t('home.badgeLocal')}</span>
              <span className="only-mobile">{t('home.badgeLocalMobile')}</span>
            </span>
          </div>
        </div>
        <div className="home-art" aria-hidden="true">
          <div className="home-art-dots" />
          <div className="home-art-pink" />
          <Logo width={300} className="home-art-logo" />
        </div>
        <div className="home-art-mobile" aria-hidden="true" />
      </section>

      <div className="home-drop-wrap">
        {dragOver ? (
          <div className="dropzone dropzone-over">
            <div className="dropzone-over-dots" />
            <div className="dropzone-over-card">
              <div className="doc-card-line" />
              <div className="doc-card-line" style={{ width: '70%' }} />
              <div className="doc-card-tag">PDF</div>
            </div>
            <RisoHeading as="div" className="dropzone-over-title" shadowText={t('home.dropToOpen')} offset={[4, 3]} shadowColor="var(--ink-green)">
              {t('home.dropToOpen')}
            </RisoHeading>
          </div>
        ) : (
          <div
            className={`dropzone${hasProblem ? ' dropzone-problem' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={t('home.dropzoneTitle')}
            onClick={() => pick()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick();
              }
            }}
          >
            {hasProblem ? (
              rejections.map((r) => {
                const { title, body } = rejectionText(r);
                return <Alert key={r.id} title={title} body={body} />;
              })
            ) : (
              <div className="dropzone-icon">
                <Icon name="upload" size={34} />
              </div>
            )}
            <div className={hasProblem ? 'dropzone-title dropzone-title-sm' : 'dropzone-title'}>
              <span className="only-desktop">{t('home.dropzoneTitle')}</span>
              <span className="only-mobile">{t('home.dropzoneTitleTouch')}</span>
            </div>
            <div className="dropzone-sub">{t('home.dropzoneSub')}</div>
            <button className="btn btn-primary btn-lg dropzone-btn" tabIndex={-1} onClick={pick}>
              {hasProblem ? t('home.chooseAnother') : t('home.selectFiles')}
            </button>
          </div>
        )}

        {state.error && <Alert title={t('home.errorTitle')} body={state.error} onClose={actions.clearError} />}

        {hasQueue && (
          <div className="queue-card">
            <div className="queue-card-head">
              <span>{t('home.selectedFiles')}</span>
              <button className="link-btn" onClick={() => pick()}>
                {t('home.addMore')}
              </button>
            </div>
            {state.queue.map((item) => (
              <div className="queue-row" key={item.id}>
                <span className={`format-tag ${item.kind === 'pdf' ? 'format-tag-green' : 'format-tag-pink'}`}>
                  {item.kind === 'pdf' ? 'PDF' : item.name.split('.').pop()?.toUpperCase().slice(0, 4) || 'IMG'}
                </span>
                <span className="queue-row-name">{item.name}</span>
                <span className="queue-row-size">{formatBytes(item.size)}</span>
                <button className="alert-close" aria-label={t('home.remove', { name: item.name })} onClick={() => actions.removeQueued(item.id)}>
                  <Icon name="close" size={18} strokeWidth={2.4} />
                </button>
              </div>
            ))}

            <div className="queue-actions">
              {!converting ? (
                <>
                  <Button variant="primary" onClick={actions.openQueue} disabled={!!state.busy}>
                    <Icon name="pencil" size={18} />
                    {t('home.edit')}
                  </Button>
                  <Button onClick={() => setConverting(true)} disabled={!!state.busy}>
                    <Icon name="convert" size={18} />
                    {t('home.changeFormat')}
                  </Button>
                </>
              ) : (
                <div className="convert-box">
                  <div className="eyebrow">{t('home.convertAllTo')}</div>
                  <div className="seg-group convert-seg">
                    {CONVERT_TARGETS.map((opt) => (
                      <button key={opt.key} aria-pressed={opt.key === target} onClick={() => setTarget(opt.key)}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="queue-actions-row">
                    <Button onClick={() => setConverting(false)}>{t('home.cancel')}</Button>
                    <Button
                      variant="primary"
                      disabled={!!state.busy}
                      onClick={async () => {
                        await actions.convertQueue(target);
                        setConverting(false);
                      }}
                    >
                      <Icon name="download" size={18} />
                      {state.busy ? state.busy.label : t('home.convertAndDownload')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {state.busy && (
              <div className="queue-busy" role="status">
                {state.busy.label}
                {state.busy.total ? ` ${state.busy.done ?? 0} / ${state.busy.total}` : ''}
              </div>
            )}
          </div>
        )}

        <div className="home-privacy">
          <Icon name="lock" size={18} color="var(--ink-green-text)" />
          {t('home.privacyNote')}
        </div>
      </div>

      <section className="home-tools" id="ferramentas">
        <RisoHeading as="h2" className="home-tools-title" shadowText={t('home.featuresTitle')}>
          {t('home.featuresTitle')}
        </RisoHeading>
        <div className="tool-grid">
          {FEATURES.map(({ icon, labelKey, subKey, tone }) => (
            <button className="tool-card" key={labelKey} onClick={() => pick()}>
              <span className={`tool-card-icon halftone-${tone}`}>
                <Icon name={icon} size={30} />
              </span>
              <span className="tool-card-text">
                <span className="tool-card-name">{t(labelKey)}</span>
                {subKey && <span className="tool-card-sub only-desktop">{t(subKey)}</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
