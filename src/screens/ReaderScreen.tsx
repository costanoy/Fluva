import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../components/Button';
import { PageView } from '../components/PageView';
import { useApp } from '../state/AppContext';
import { loadFile, formatBytes, type LoadedFile } from '../pdf/loader';
import { displaySize } from '../pdf/model';
import { t } from '../i18n/translations';
import '../styles/reader-screen.css';

/** Deliberately its own, smaller range/step than the full editor's canvas —
 * this is a viewer, not kept in lockstep with EditorCanvas.tsx on purpose, so
 * nothing here pulls that (lazy-loaded) module in. */
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.15;
const VIEWPORT_PADDING = 48;
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

const CONVERT_TARGETS: Array<{ key: 'pdf' | 'png' | 'jpg'; label: string }> = [
  { key: 'pdf', label: 'PDF' },
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
];

/**
 * The fast, lightweight landing spot for a single dropped/picked file —
 * loads and renders pages with none of the editor's machinery (no overlays,
 * no undo history, no pdf-lib/docx in its dependency graph). "Editar" is the
 * explicit, deliberate step up into the full experience.
 */
export function ReaderScreen() {
  const { state, actions } = useApp();
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [converting, setConverting] = useState(false);
  const [target, setTarget] = useState<'pdf' | 'png' | 'jpg'>('pdf');
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 800, height: 600 });

  const file = state.readerFile;

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    setPageIndex(0);
    setZoom(null);
    setConverting(false);
    if (!file) return;
    loadFile(file)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setAvailable({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    setAvailable({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  if (!file) return null;

  const page = loaded?.pages[pageIndex];
  const shown = page ? displaySize(page) : { width: 1, height: 1 };
  const fitWidthScale = (available.width - VIEWPORT_PADDING * 2) / shown.width;
  const defaultScale = Number.isFinite(fitWidthScale) && fitWidthScale > 0 ? Math.min(fitWidthScale, 2) : 1;
  const safeScale = clampScale(zoom ?? defaultScale);

  return (
    <div className="reader-screen">
      <div className="reader-header">
        <div className="reader-header-info">
          <strong className="reader-header-name">{file.name}</strong>
          <span className="reader-header-meta">
            {formatBytes(file.size)}
            {loaded && loaded.pages.length > 1 ? ` · ${t('reader.pageOf', { n: pageIndex + 1, total: loaded.pages.length })}` : ''}
          </span>
        </div>
        <div className="reader-header-actions">
          <Button onClick={() => setConverting((v) => !v)} disabled={!loaded}>
            {t('home.changeFormat')}
          </Button>
          <Button variant="primary" onClick={actions.openReaderFileInEditor} disabled={!loaded}>
            <Pencil size={15} strokeWidth={2.75} />
            {t('home.edit')}
          </Button>
        </div>
      </div>

      {converting && loaded && (
        <div className="batch-format-box reader-convert-box">
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
          <Button
            variant="primary"
            style={{ justifyContent: 'center' }}
            disabled={!!state.busy}
            onClick={async () => {
              await actions.convertReaderFile(target);
              setConverting(false);
            }}
          >
            {t('home.convertAndDownload')}
          </Button>
        </div>
      )}

      {loadError && (
        <div className="inline-error reader-error">
          <span>{loadError}</span>
        </div>
      )}

      <div className="reader-viewport" ref={containerRef}>
        {page && loaded ? (
          <div className="reader-page-wrap">
            <PageView page={page} source={loaded.source} scale={safeScale} className="reader-page" />
          </div>
        ) : (
          !loadError && <div className="reader-loading">{t('reader.loading')}</div>
        )}
      </div>

      <div className="reader-footer-bar">
        <div className="reader-nav">
          <Button icon aria-label={t('reader.prevPage')} disabled={pageIndex === 0} onClick={() => setPageIndex((i) => i - 1)}>
            <ChevronLeft size={16} strokeWidth={2.75} />
          </Button>
          <span>{loaded ? t('reader.pageOf', { n: pageIndex + 1, total: loaded.pages.length }) : ''}</span>
          <Button
            icon
            aria-label={t('reader.nextPage')}
            disabled={!loaded || pageIndex >= loaded.pages.length - 1}
            onClick={() => setPageIndex((i) => i + 1)}
          >
            <ChevronRight size={16} strokeWidth={2.75} />
          </Button>
        </div>
        <div className="reader-zoom">
          <Button icon aria-label={t('reader.zoomOut')} onClick={() => setZoom(clampScale(safeScale - ZOOM_STEP))}>
            <ZoomOut size={15} strokeWidth={2.75} />
          </Button>
          <span>{Math.round(safeScale * 100)}%</span>
          <Button icon aria-label={t('reader.zoomIn')} onClick={() => setZoom(clampScale(safeScale + ZOOM_STEP))}>
            <ZoomIn size={15} strokeWidth={2.75} />
          </Button>
        </div>
      </div>
    </div>
  );
}
