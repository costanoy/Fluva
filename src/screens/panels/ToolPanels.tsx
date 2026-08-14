import { useEffect } from 'react';
import { Download, GripVertical, Trash2, X } from 'lucide-react';
import { Button } from '../../components/Button';
import { useApp } from '../../state/AppContext';
import { formatBytes } from '../../pdf/loader';
import type { CompressLevel } from '../../pdf/ops';
import { usePointerReorder } from '../../hooks/usePointerReorder';
import { t } from '../../i18n/translations';

/* ------------------------------------------------------------------ juntar */

export function MergePanel() {
  const { state, actions } = useApp();
  const { dragIndex, itemProps } = usePointerReorder(actions.reorderMergeSelection);

  const selected = state.mergeSelected.map((id) => state.doc.sources[id]).filter(Boolean);
  const totalPages = selected.reduce((sum, s) => sum + s.pageCount, 0);

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>{t('merge.title')}</h6>
      <div className="panel-note">{t('merge.note')}</div>

      {selected.length === 0 ? (
        <div className="panel-empty">{t('merge.noneSelected')}</div>
      ) : (
        <>
          <div className="panel-label">{t('merge.order')}</div>
          {selected.map((source, index) => {
            const { style: reorderStyle, ...reorderProps } = itemProps(index);
            return (
            <div
              key={source.id}
              className={`merge-order-row${dragIndex === index ? ' dragging' : ''}`}
              {...reorderProps}
              style={reorderStyle}
            >
              <GripVertical size={14} strokeWidth={2.5} color="var(--color-neutral-500)" />
              <span className="merge-order-index">{index + 1}.</span>
              <span className="merge-order-name">
                {source.name}
                <span className="merge-order-meta">{t('merge.pages', { count: source.pageCount })}</span>
              </span>
              <button
                className="icon-btn-plain"
                aria-label={t('merge.removeAria', { name: source.name })}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => actions.toggleMergeSource(source.id)}
              >
                <X size={13} strokeWidth={3} />
              </button>
            </div>
            );
          })}

          <Button variant="primary" block onClick={actions.confirmMerge} disabled={!!state.busy}>
            {t('merge.confirm', { count: selected.length, pages: totalPages })}
          </Button>
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------- comprimir */

const LEVELS: CompressLevel[] = ['low', 'medium', 'high'];
const LEVEL_KEY: Record<CompressLevel, 'compress.levelLow' | 'compress.levelMedium' | 'compress.levelHigh'> = {
  low: 'compress.levelLow',
  medium: 'compress.levelMedium',
  high: 'compress.levelHigh',
};

export function CompressPanel() {
  const { state, actions } = useApp();
  const outcome = state.compressOutcome;

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>{t('compress.title')}</h6>

      <div className="panel-label">{t('compress.intensity')}</div>
      <div className="segmented">
        {LEVELS.map((level) => (
          <button
            key={level}
            className="segmented-btn"
            style={{
              background: state.compressLevel === level ? 'var(--color-accent)' : 'transparent',
              color: state.compressLevel === level ? '#FFFFFF' : 'var(--color-text)',
            }}
            onClick={() => actions.setCompressLevel(level)}
          >
            {t(LEVEL_KEY[level])}
          </button>
        ))}
      </div>

      <div className="panel-note">{t('compress.note')}</div>

      <Button variant="primary" block onClick={actions.runCompress} disabled={!!state.busy}>
        {t('compress.runNow')}
      </Button>

      {outcome && (
        <div className={outcome.reductionPct > 0 ? 'compress-result' : 'compress-result compress-result-warn'}>
          <div className="compress-row">
            <span>{t('compress.before')}</span>
            <strong>{formatBytes(outcome.originalSize)}</strong>
          </div>
          <div className="compress-row">
            <span>{t('compress.after')}</span>
            <strong>{formatBytes(outcome.compressedSize)}</strong>
          </div>
          <div className="compress-headline">
            {outcome.reductionPct > 0
              ? t('compress.reduced', { pct: outcome.reductionPct })
              : t('compress.alreadyMin')}
          </div>
          <div className="panel-note">
            {outcome.strategy === 'raster'
              ? t('compress.rasterNote')
              : t('compress.rebuildNote')}
          </div>
          <Button variant="primary" block onClick={actions.downloadCompressed}>
            <Download size={16} strokeWidth={2.75} />
            {t('compress.downloadPdf')}
          </Button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------ marca d'água */

export function WatermarkPanel() {
  const { state, actions } = useApp();
  const wm = state.doc.watermark;
  const live = (patch: Parameters<typeof actions.updateWatermark>[0]) => actions.updateWatermark(patch, false);
  const commit = (patch: Parameters<typeof actions.updateWatermark>[0]) => actions.updateWatermark(patch, true);

  // "Apenas na página selecionada" tracks whichever page is open right now —
  // browsing pages while this panel is open (and single-page mode is on) keeps
  // the target in step, instead of freezing it wherever it happened to be when
  // the toggle was first flipped.
  useEffect(() => {
    if (wm.enabled && !wm.allPages && wm.singlePageIndex !== state.activePageIndex) {
      live({ singlePageIndex: state.activePageIndex });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activePageIndex, wm.enabled, wm.allPages]);

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>{t('wm.title')}</h6>

      <Button
        variant={wm.enabled ? 'primary' : 'secondary'}
        block
        style={{ marginTop: 0, justifyContent: 'center' }}
        onClick={() => commit({ enabled: !wm.enabled })}
      >
        {wm.enabled ? t('wm.active') : t('wm.activate')}
      </Button>

      {wm.enabled && (
        <>
          <div className="segmented" style={{ marginTop: 4 }}>
            <button
              className="segmented-btn"
              style={{
                background: wm.source.kind === 'text' ? 'var(--color-accent)' : 'transparent',
                color: wm.source.kind === 'text' ? '#FFFFFF' : 'var(--color-text)',
              }}
              onClick={() => commit({ source: { kind: 'text', text: wm.source.kind === 'text' ? wm.source.text : 'AMOSTRA' } })}
            >
              {t('wm.text')}
            </button>
            <button
              className="segmented-btn"
              style={{
                background: wm.source.kind === 'image' ? 'var(--color-accent)' : 'transparent',
                color: wm.source.kind === 'image' ? '#FFFFFF' : 'var(--color-text)',
              }}
              onClick={actions.uploadWatermarkImage}
            >
              {t('wm.image')}
            </button>
          </div>

          {wm.source.kind === 'text' ? (
            <>
              <div className="panel-label">{t('wm.text')}</div>
              <input
                type="text"
                className="text-input"
                value={wm.source.text}
                onChange={(e) => live({ source: { kind: 'text', text: e.target.value } })}
                onBlur={(e) => commit({ source: { kind: 'text', text: e.target.value } })}
              />
            </>
          ) : (
            <div className="panel-row" style={{ justifyContent: 'space-between' }}>
              <span className="panel-note" style={{ margin: 0 }}>{t('wm.imageLoaded')}</span>
              <Button onClick={actions.uploadWatermarkImage} disabled={!!state.busy}>{t('wm.swapImage')}</Button>
            </div>
          )}

          <div className="segmented">
            <button
              className="segmented-btn"
              style={{
                background: wm.allPages ? 'var(--color-accent)' : 'transparent',
                color: wm.allPages ? '#FFFFFF' : 'var(--color-text)',
              }}
              onClick={() => commit({ allPages: true })}
            >
              {t('wm.allPages')}
            </button>
            <button
              className="segmented-btn"
              style={{
                background: !wm.allPages ? 'var(--color-accent)' : 'transparent',
                color: !wm.allPages ? '#FFFFFF' : 'var(--color-text)',
              }}
              onClick={() => commit({ allPages: false })}
            >
              {t('wm.onlySelected')}
            </button>
          </div>

          <Slider label={t('wm.posH')} min={0} max={100} value={wm.x} onLive={(x) => live({ x })} onCommit={(x) => commit({ x })} suffix="%" />
          <Slider label={t('wm.posV')} min={0} max={100} value={wm.y} onLive={(y) => live({ y })} onCommit={(y) => commit({ y })} suffix="%" />
          <Slider label={t('wm.scale')} min={20} max={250} value={wm.scale} onLive={(scale) => live({ scale })} onCommit={(scale) => commit({ scale })} suffix="%" />
          <Slider label={t('wm.rotation')} min={-90} max={90} value={wm.rotation} onLive={(rotation) => live({ rotation })} onCommit={(rotation) => commit({ rotation })} suffix="°" />

          <Button block onClick={() => commit({ enabled: false })}>
            <Trash2 size={16} strokeWidth={2.75} />
            {t('wm.remove')}
          </Button>
        </>
      )}
    </>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onLive,
  onCommit,
  suffix,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
  suffix: string;
}) {
  return (
    <>
      <div className="panel-label">
        {label}: {Math.round(value)}
        {suffix}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        style={{ width: '100%' }}
      />
    </>
  );
}

/* --------------------------------------------------------------- organizar */

export function ReorderPanel() {
  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>{t('reorder.title')}</h6>
      <div className="panel-note">{t('reorder.note')}</div>
    </>
  );
}
