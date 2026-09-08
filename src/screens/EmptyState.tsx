import { useCallback, useState, type DragEvent } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Upload,
  X,
  Pencil,
  Combine,
  Columns2,
  Minimize2,
  RotateCw,
  Droplet,
  Repeat,
  PenLine,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Footer } from '../components/Footer';
import { useApp } from '../state/AppContext';
import { formatBytes } from '../pdf/loader';
import { t, type TranslationKey } from '../i18n/translations';
import '../styles/empty-state.css';

const CONVERT_TARGETS: Array<{ key: 'pdf' | 'png' | 'jpg'; label: string }> = [
  { key: 'pdf', label: 'PDF' },
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
];

/** What Fluva can already do, shown as a quick visual pitch on the home
 * screen — kept to the real toolbar/export feature set, nothing aspirational. */
const FEATURES: Array<{ Icon: LucideIcon; labelKey: TranslationKey }> = [
  { Icon: Pencil, labelKey: 'home.featureEdit' },
  { Icon: Combine, labelKey: 'home.featureMerge' },
  { Icon: Columns2, labelKey: 'home.featureSplit' },
  { Icon: Minimize2, labelKey: 'home.featureCompress' },
  { Icon: RotateCw, labelKey: 'home.featureRotate' },
  { Icon: Droplet, labelKey: 'home.featureWatermark' },
  { Icon: Repeat, labelKey: 'home.featureConvert' },
  { Icon: PenLine, labelKey: 'home.featureSign' },
];

export function EmptyState() {
  const { state, actions } = useApp();
  const [dragOver, setDragOver] = useState(false);
  const [converting, setConverting] = useState(false);
  const [target, setTarget] = useState<'pdf' | 'png' | 'jpg'>('pdf');

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) actions.addFiles(files);
    },
    [actions],
  );

  const hasQueue = state.queue.length > 0;

  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <div className="empty-state-content">
          <div className="hero">
            <h1 className="hero-title">{t('home.pageTitle')}</h1>
            <p className="hero-subtitle">{t('home.heroSubtitle')}</p>
          </div>

          <div
            className={`dropzone${dragOver ? ' dropzone-active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={actions.pickFiles}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void actions.pickFiles();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="dropzone-icon">
              <Upload size={20} strokeWidth={2.75} color="var(--color-accent)" />
            </div>
            <h4 style={{ textAlign: 'center' }}>{t('home.dropzoneTitle')}</h4>
            <div className="dropzone-sub">{t('home.dropzoneSub')}</div>
          </div>

          {state.error && (
            <div className="inline-error">
              <span>{state.error}</span>
              <button className="icon-btn-plain" aria-label={t('home.dismiss')} onClick={actions.clearError}>
                <X size={14} strokeWidth={2.75} />
              </button>
            </div>
          )}

          {hasQueue && (
            <div className="pending-card">
              {state.queue.map((item) => (
                <div className="pending-row" key={item.id}>
                  {item.kind === 'pdf' ? (
                    <FileText size={16} strokeWidth={2.75} color="var(--color-neutral-600)" />
                  ) : (
                    <ImageIcon size={16} strokeWidth={2.75} color="var(--color-neutral-600)" />
                  )}
                  <span className="pending-row-name">{item.name}</span>
                  <span className="pending-row-size">{formatBytes(item.size)}</span>
                  <button className="icon-btn-plain" aria-label={t('home.remove', { name: item.name })} onClick={() => actions.removeQueued(item.id)}>
                    <X size={16} strokeWidth={2.75} />
                  </button>
                </div>
              ))}

              <div className="pending-actions">
                {!converting ? (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Button variant="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={actions.openQueue} disabled={!!state.busy}>
                      {t('home.edit')}
                    </Button>
                    <Button style={{ flex: 1, justifyContent: 'center' }} onClick={() => setConverting(true)} disabled={!!state.busy}>
                      {t('home.changeFormat')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="batch-format-box">
                      <div className="batch-format-label">{t('home.convertAllTo')}</div>
                      <div className="batch-format-chips">
                        {CONVERT_TARGETS.map((opt) => (
                          <button
                            key={opt.key}
                            className="batch-format-chip"
                            style={{
                              background: opt.key === target ? 'var(--color-accent)' : 'transparent',
                              color: opt.key === target ? 'var(--color-bg)' : 'var(--color-text)',
                            }}
                            onClick={() => setTarget(opt.key)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Button style={{ flex: 1, justifyContent: 'center' }} onClick={() => setConverting(false)}>
                        {t('home.cancel')}
                      </Button>
                      <Button
                        variant="primary"
                        style={{ flex: 1, justifyContent: 'center' }}
                        disabled={!!state.busy}
                        onClick={async () => {
                          await actions.convertQueue(target);
                          setConverting(false);
                        }}
                      >
                        {t('home.convertAndDownload')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {!hasQueue && (
            <div className="feature-section">
              <h2 className="feature-section-title">{t('home.featuresTitle')}</h2>
              <div className="feature-grid">
                {FEATURES.map(({ Icon, labelKey }) => (
                  <div className="feature-item" key={labelKey}>
                    <span className="feature-item-icon">
                      <Icon size={16} strokeWidth={2.75} />
                    </span>
                    {t(labelKey)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <Footer />
      </div>
    </div>
  );
}
