import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { PageView } from '../components/PageView';
import { FormatMenu } from './ExportDropdown';
import { useApp } from '../state/AppContext';
import { useGoBack } from '../hooks/useGoBack';
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
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

/**
 * The fast, lightweight landing spot for a single dropped/picked file —
 * loads and renders pages with none of the editor's machinery (no overlays,
 * no undo history, no pdf-lib/docx in its dependency graph). "Editar" is the
 * explicit, deliberate step up into the full experience.
 */
export function ReaderScreen() {
  const { state, actions } = useApp();
  const goBack = useGoBack();
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 800, height: 600 });

  const file = state.readerFile;

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    setPageIndex(0);
    setZoom(null);
    setFormatOpen(false);
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

  const total = loaded?.pages.length ?? 0;
  const page = loaded?.pages[pageIndex];
  const shown = page ? displaySize(page) : { width: 1, height: 1 };
  const isNarrow = available.width < 700;
  // Desktop opens at 100% (a 612pt page at 612px, as in the design) unless
  // that wouldn't fit; phones open in "Ajustar" — the screen's width minus 24px.
  const fitWidthScale = (available.width - (isNarrow ? 24 : 96)) / shown.width;
  const defaultScale = Number.isFinite(fitWidthScale) && fitWidthScale > 0 ? Math.min(fitWidthScale, isNarrow ? 2 : 1) : 1;
  const safeScale = clampScale(zoom ?? defaultScale);
  const zoomLabel = zoom === null && isNarrow ? t('reader.fit') : `${Math.round(safeScale * 100)}%`;

  const meta = [
    loaded ? (total === 1 ? t('topbar.page', { count: total }) : t('topbar.pages', { count: total })) : null,
    formatBytes(file.size),
  ]
    .filter(Boolean)
    .join(' · ');

  const goToPage = (n: number) => {
    if (!total) return;
    setPageIndex(Math.min(total - 1, Math.max(0, n)));
  };

  const pager = (
    <div className="seg-group reader-pager">
      <button aria-label={t('reader.prevPage')} disabled={pageIndex === 0 || !loaded} onClick={() => goToPage(pageIndex - 1)}>
        <Icon name="chevronLeft" size={18} strokeWidth={2.4} />
      </button>
      <div className="seg-group-value">
        <input
          className="reader-page-input"
          inputMode="numeric"
          aria-label={t('reader.pageInputAria')}
          value={pageDraft ?? String(loaded ? pageIndex + 1 : '–')}
          disabled={!loaded}
          onFocus={(e) => {
            setPageDraft(String(pageIndex + 1));
            e.target.select();
          }}
          onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ''))}
          onBlur={() => {
            if (pageDraft) goToPage(Number(pageDraft) - 1);
            setPageDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {t('reader.of', { total: total || '–' })}
      </div>
      <button aria-label={t('reader.nextPage')} disabled={!loaded || pageIndex >= total - 1} onClick={() => goToPage(pageIndex + 1)}>
        <Icon name="chevronRight" size={18} strokeWidth={2.4} />
      </button>
    </div>
  );

  const zoomGroup = (
    <div className="seg-group reader-zoom">
      <button aria-label={t('reader.zoomOut')} disabled={!loaded} onClick={() => setZoom(clampScale(safeScale - ZOOM_STEP))}>
        <Icon name="minus" size={18} strokeWidth={2.4} />
      </button>
      <button className="seg-group-value" title={t('reader.fit')} disabled={!loaded} onClick={() => setZoom(null)}>
        {zoomLabel}
      </button>
      <button aria-label={t('reader.zoomIn')} disabled={!loaded} onClick={() => setZoom(clampScale(safeScale + ZOOM_STEP))}>
        <Icon name="plus" size={18} strokeWidth={2.4} />
      </button>
    </div>
  );

  const formatButton = (iconOnly: boolean) => (
    <div className="menu-anchor">
      <button
        className={`btn btn-secondary${iconOnly ? ' btn-icon reader-icon-btn' : ''}`}
        aria-label={iconOnly ? t('home.changeFormat') : undefined}
        aria-expanded={formatOpen}
        disabled={!loaded || !!state.busy}
        onClick={() => setFormatOpen((v) => !v)}
      >
        <Icon name="convert" size={iconOnly ? 20 : 18} />
        {!iconOnly && t('home.changeFormat')}
      </button>
      {formatOpen && (
        <FormatMenu
          onClose={() => setFormatOpen(false)}
          onPick={async (format) => {
            setFormatOpen(false);
            await actions.convertReaderFile(format);
          }}
        />
      )}
    </div>
  );

  return (
    <div className="reader-screen">
      <div className="reader-bar grain">
        <div className="reader-bar-left">
          <button className="btn btn-secondary reader-back" onClick={goBack} aria-label={t('topbar.backHome')}>
            <Icon name="chevronLeft" size={20} />
            <span className="reader-back-label">{t('topbar.back')}</span>
          </button>
          <Logo width={46} className="reader-bar-logo" />
          <div className="reader-file">
            <div className="reader-file-name" title={file.name}>
              {file.name}
            </div>
            <div className="reader-file-meta">{meta}</div>
          </div>
        </div>
        <div className="reader-bar-center">
          {pager}
          {zoomGroup}
        </div>
        <div className="reader-bar-right">
          <div className="reader-desktop-only">{formatButton(false)}</div>
          <div className="reader-mobile-only">{formatButton(true)}</div>
          <button className="btn btn-primary reader-desktop-only" onClick={actions.openReaderFileInEditor} disabled={!loaded || !!state.busy}>
            <Icon name="pencil" size={18} />
            {t('home.edit')}
          </button>
        </div>
      </div>

      {(loadError || state.error) && (
        <div className="reader-error">
          <div className="alert" role="alert">
            <span className="alert-mark" aria-hidden="true">
              !
            </span>
            <div className="alert-body">
              <div className="alert-title">{t('home.errorTitle')}</div>
              <div className="alert-text">{loadError ?? state.error}</div>
            </div>
            {!loadError && (
              <button className="alert-close" aria-label={t('home.dismiss')} onClick={actions.clearError}>
                <Icon name="close" size={18} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="reader-viewport" ref={containerRef}>
        {page && loaded ? (
          <div className="reader-page-wrap">
            <PageView page={page} source={loaded.source} scale={safeScale} className="reader-page" />
          </div>
        ) : (
          !loadError && (
            <div className="loading-card" role="status">
              <div className="loading-doc">
                <div className="doc-card-line" />
                <div className="doc-card-line" style={{ width: '70%' }} />
                <div className="doc-card-tag">{/\.pdf$/i.test(file.name) ? 'PDF' : 'IMG'}</div>
              </div>
              <div className="loading-title">{t('reader.loadingTitle')}</div>
              <div className="loading-meta">
                {file.name} · {formatBytes(file.size)}
              </div>
              <div className="progress progress-indeterminate" aria-hidden="true">
                <div className="progress-fill" />
              </div>
              <button className="btn btn-secondary" onClick={goBack}>
                {t('home.cancel')}
              </button>
              <div className="loading-note">{t('reader.loadingNote')}</div>
            </div>
          )
        )}
        {state.busy && (
          <div className="reader-busy" role="status">
            <span className="busy-spinner" />
            {state.busy.label}
          </div>
        )}
      </div>

      <div className="reader-bottom grain">
        <div className="reader-bottom-row">
          {pager}
          {zoomGroup}
        </div>
        <button className="btn btn-primary reader-bottom-edit" onClick={actions.openReaderFileInEditor} disabled={!loaded || !!state.busy}>
          <Icon name="pencil" size={18} />
          {t('home.edit')}
        </button>
      </div>
    </div>
  );
}
