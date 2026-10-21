import { useEffect, useState, type ReactNode } from 'react';
import { Check, Eraser, Eye, FlipHorizontal2, FlipVertical2, Highlighter, Link2, PenLine, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { RangeField, signed } from '../../components/RangeField';
import { useApp } from '../../state/AppContext';
import { displaySize, imageEditsOf, isImagePage, type DocumentState, type ImageAdjust, type ImageFilterId, type WorkPage } from '../../pdf/model';
import { CROP_ASPECTS, type CropAspect } from '../../pdf/crop';
import { baseKey, FILTER_IDS, filterTiles, tonalActive } from '../../pdf/imageEdit';
import { photoTile } from '../../pdf/render';
import { MAX_CANVAS_PIXELS } from '../../pdf/geometry';
import type { DrawTool } from '../../state/appTypes';
import { Swatches } from './OverlayPanel';
import { t, type TranslationKey } from '../../i18n/translations';

/** Shown in place of a photo tool's panel when the open page isn't a photo. */
function NotAPhoto({ title }: { title: string }) {
  return (
    <>
      <h6 className="panel-title">{title}</h6>
      <div className="panel-note">{t('photo.notPhoto')}</div>
    </>
  );
}

/** A row of choices of which exactly one is on. */
function ChipGroup<T extends string | number>({
  label,
  options,
  value,
  onPick,
  render,
}: {
  label: string;
  options: T[];
  value: T | null;
  onPick: (option: T) => void;
  render: (option: T) => ReactNode;
}) {
  return (
    <div className="chip-grid" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option} type="button" className="chip" role="radio" aria-checked={value === option} onClick={() => onPick(option)}>
          {render(option)}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ cortar */

const ASPECT_LABEL: Partial<Record<CropAspect, TranslationKey>> = { free: 'crop.free', original: 'crop.original' };

export function CropPanel() {
  const { state, actions } = useApp();
  const page = state.doc.pages[state.activePageIndex];
  const draft = state.cropDraft;
  const photo = isImagePage(state.doc, page);

  // Opened, or the page changed under it (deleted, undone): start on this one.
  useEffect(() => {
    if (page && draft?.pageId !== page.id) actions.beginCrop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, draft?.pageId]);

  if (!page || !draft) return null;
  const turned = ((draft.rotation % 360) + 360) % 180 !== 0;
  const shownW = Math.round(turned ? draft.rect.height : draft.rect.width);
  const shownH = Math.round(turned ? draft.rect.width : draft.rect.height);

  return (
    <>
      <h6 className="panel-title">{t('crop.title')}</h6>
      <div className="panel-note">{t('crop.note')}</div>

      <div className="panel-label">{t('crop.aspect')}</div>
      <ChipGroup
        label={t('crop.aspect')}
        options={CROP_ASPECTS}
        value={draft.aspect}
        onPick={actions.setCropAspect}
        render={(aspect) => (ASPECT_LABEL[aspect] ? t(ASPECT_LABEL[aspect]!) : aspect)}
      />
      {photo && <div className="panel-note panel-note-tight">{t('crop.size', { w: shownW, h: shownH })}</div>}

      <div className="panel-label">{photo ? t('crop.turnAndFlip') : t('crop.turn')}</div>
      <div className="tile-row">
        <button type="button" className="tile-btn" onClick={() => actions.turnCropDraft(-1)} title={t('crop.rotateLeft')}>
          <RotateCcw size={18} strokeWidth={2.5} />
          <span>{t('crop.rotateLeftShort')}</span>
        </button>
        <button type="button" className="tile-btn" onClick={() => actions.turnCropDraft(1)} title={t('crop.rotateRight')}>
          <RotateCw size={18} strokeWidth={2.5} />
          <span>{t('crop.rotateRightShort')}</span>
        </button>
        {photo && (
          <>
            {/* As the page is seen: on a page turned a quarter, mirroring
                left to right is the photo's own top-to-bottom flip. */}
            <button type="button" className="tile-btn" aria-pressed={turned ? draft.flipV : draft.flipH} onClick={() => actions.updateCropDraft(turned ? { flipV: !draft.flipV } : { flipH: !draft.flipH })} title={t('crop.flipH')}>
              <FlipHorizontal2 size={18} strokeWidth={2.5} />
              <span>{t('crop.flipHShort')}</span>
            </button>
            <button type="button" className="tile-btn" aria-pressed={turned ? draft.flipH : draft.flipV} onClick={() => actions.updateCropDraft(turned ? { flipH: !draft.flipH } : { flipV: !draft.flipV })} title={t('crop.flipV')}>
              <FlipVertical2 size={18} strokeWidth={2.5} />
              <span>{t('crop.flipVShort')}</span>
            </button>
          </>
        )}
      </div>

      {photo && (
        <RangeField
          label={t('crop.straighten')}
          value={draft.straighten}
          min={-45}
          max={45}
          step={0.5}
          resetTo={0}
          format={(v) => `${signed(v).replace('.', state.lang === 'pt' ? ',' : '.')}°`}
          onLive={(straighten) => actions.updateCropDraft({ straighten })}
          onCommit={(straighten) => actions.updateCropDraft({ straighten })}
        />
      )}

      <Button block onClick={actions.resetCropDraft}>
        <Undo2 size={16} strokeWidth={2.75} />
        {t('crop.reset')}
      </Button>
      <div className="panel-actions">
        <Button onClick={actions.cancelCrop}>{t('crop.cancel')}</Button>
        <Button variant="primary" onClick={actions.applyCrop}>
          <Check size={16} strokeWidth={2.75} />
          {t('crop.apply')}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ ajustar */

const FILTER_LABEL: Record<ImageFilterId, TranslationKey> = {
  none: 'filter.none',
  bw: 'filter.bw',
  noir: 'filter.noir',
  sepia: 'filter.sepia',
  vintage: 'filter.vintage',
  vivid: 'filter.vivid',
  warm: 'filter.warm',
  cool: 'filter.cool',
  dramatic: 'filter.dramatic',
  fade: 'filter.fade',
};

const ADJUST_GROUPS: Array<{ label: TranslationKey; keys: Array<keyof ImageAdjust> }> = [
  { label: 'adjust.light', keys: ['exposure', 'brightness', 'contrast', 'highlights', 'shadows'] },
  { label: 'adjust.colour', keys: ['saturation', 'vibrance', 'warmth', 'tint'] },
  { label: 'adjust.detail', keys: ['sharpness', 'blur', 'vignette'] },
];

const ADJUST_LABEL: Record<keyof ImageAdjust, TranslationKey> = {
  exposure: 'adjust.exposure',
  brightness: 'adjust.brightness',
  contrast: 'adjust.contrast',
  highlights: 'adjust.highlights',
  shadows: 'adjust.shadows',
  saturation: 'adjust.saturation',
  vibrance: 'adjust.vibrance',
  warmth: 'adjust.warmth',
  tint: 'adjust.tint',
  sharpness: 'adjust.sharpness',
  blur: 'adjust.blur',
  vignette: 'adjust.vignette',
};

/** Sliders that only go one way, from nothing. */
const ONE_WAY = new Set<keyof ImageAdjust>(['sharpness', 'blur', 'vignette']);

/** The filter picker's tiles: the page's photo with each filter, small. */
function useFilterTiles(doc: DocumentState, page: WorkPage | undefined): Record<ImageFilterId, string> | null {
  const [tiles, setTiles] = useState<Record<ImageFilterId, string> | null>(null);
  const source = page?.sourceId ? doc.sources[page.sourceId] : undefined;
  const key = page && source?.kind === 'image' ? `${page.id}|${baseKey(page)}` : null;
  const latest = { page, source };
  useEffect(() => {
    const { page: target, source: photo } = latest;
    if (!key || !target || !photo) {
      setTiles(null);
      return;
    }
    let cancelled = false;
    // Not on every step of a slider: once it rests a moment.
    const timer = window.setTimeout(async () => {
      try {
        const base = await photoTile(photo, target, 132);
        if (cancelled) return;
        const out = filterTiles(base, target);
        base.width = base.height = 0;
        if (!cancelled) setTiles(out);
      } catch {
        /* the tiles just stay plain */
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return tiles;
}

export function AdjustPanel() {
  const { state, actions } = useApp();
  const page = state.doc.pages[state.activePageIndex];
  const tiles = useFilterTiles(state.doc, page);
  if (!page || !isImagePage(state.doc, page)) return <NotAPhoto title={t('adjust.title')} />;
  const e = imageEditsOf(page);
  const edited = tonalActive(e);
  const compare = (on: boolean) => {
    if (on !== state.comparing) actions.setComparing(on);
  };

  return (
    <>
      <h6 className="panel-title">{t('adjust.title')}</h6>

      <div className="panel-label">{t('adjust.filters')}</div>
      <div className="filter-grid" role="radiogroup" aria-label={t('adjust.filters')}>
        {FILTER_IDS.map((filter) => (
          <button key={filter} type="button" className="filter-tile" role="radio" aria-checked={e.filter === filter} onClick={() => actions.setImageFilter(filter)}>
            <span className="filter-thumb" style={{ backgroundImage: tiles?.[filter] ? `url(${tiles[filter]})` : undefined }} />
            <span className="filter-name">{t(FILTER_LABEL[filter])}</span>
          </button>
        ))}
      </div>
      {e.filter !== 'none' && (
        <RangeField
          label={t('adjust.filterStrength')}
          value={e.filterStrength}
          min={0}
          max={100}
          resetTo={100}
          format={(v) => `${v}%`}
          onLive={(v) => actions.setFilterStrength(v, false)}
          onCommit={(v) => actions.setFilterStrength(v, true)}
        />
      )}

      {ADJUST_GROUPS.map((group) => (
        <details key={group.label} className="adjust-group" open>
          <summary>{t(group.label)}</summary>
          {group.keys.map((key) => (
            <RangeField
              key={key}
              label={t(ADJUST_LABEL[key])}
              value={e.adjust[key]}
              min={ONE_WAY.has(key) ? 0 : -100}
              max={100}
              resetTo={0}
              format={ONE_WAY.has(key) ? String : signed}
              onLive={(v) => actions.updateImageAdjust(key, v, false)}
              onCommit={(v) => actions.updateImageAdjust(key, v, true)}
            />
          ))}
        </details>
      ))}

      <div className="panel-actions">
        <Button
          disabled={!edited}
          aria-pressed={state.comparing}
          title={t('adjust.compareHint')}
          onPointerDown={() => compare(true)}
          onPointerUp={() => compare(false)}
          onPointerLeave={() => compare(false)}
          onPointerCancel={() => compare(false)}
          onKeyDown={(ev) => (ev.key === ' ' || ev.key === 'Enter') && !ev.repeat && compare(true)}
          onKeyUp={() => compare(false)}
          onBlur={() => compare(false)}
          onContextMenu={(ev) => ev.preventDefault()}
        >
          <Eye size={16} strokeWidth={2.75} />
          {t('adjust.compare')}
        </Button>
        <Button disabled={!edited} onClick={actions.resetImageTone}>
          <Undo2 size={16} strokeWidth={2.75} />
          {t('adjust.reset')}
        </Button>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- redimensionar */

const PERCENTS = [25, 50, 75, 100, 150, 200];

export function ResizePanel() {
  const { state, actions } = useApp();
  const page = state.doc.pages[state.activePageIndex];
  const photo = isImagePage(state.doc, page);
  const scale = page ? imageEditsOf(page).scale : 1;
  const base = page ? displaySize(page) : { width: 1, height: 1 };
  const outW = Math.max(1, Math.round(base.width * scale));
  const outH = Math.max(1, Math.round(base.height * scale));
  const [width, setWidth] = useState(String(outW));
  const [height, setHeight] = useState(String(outH));
  useEffect(() => {
    setWidth(String(outW));
    setHeight(String(outH));
  }, [outW, outH]);

  if (!page || !photo) return <NotAPhoto title={t('resize.title')} />;
  // From one pixel on its shorter side up to what one image can hold.
  const minScale = 1 / Math.min(base.width, base.height);
  const maxScale = Math.min(8, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)), 16384 / Math.max(base.width, base.height));
  const photoPages = state.doc.pages.filter((p) => isImagePage(state.doc, p)).length;

  const apply = (next: number) => {
    if (!Number.isFinite(next) || next <= 0) {
      setWidth(String(outW));
      setHeight(String(outH));
      return;
    }
    const clamped = Math.min(maxScale, Math.max(minScale, next));
    if (Math.abs(clamped - scale) > 1e-9) actions.setImageScale(clamped);
    else {
      setWidth(String(outW));
      setHeight(String(outH));
    }
  };
  const field = (value: string, set: (v: string) => void, side: number, label: string) => (
    <label className="unit-input resize-input">
      <span>{label}</span>
      <input
        inputMode="numeric"
        value={value}
        aria-label={label}
        onChange={(ev) => set(ev.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => apply(Number(value) / side)}
        onKeyDown={(ev) => ev.key === 'Enter' && apply(Number(value) / side)}
      />
      <span>px</span>
    </label>
  );

  return (
    <>
      <h6 className="panel-title">{t('resize.title')}</h6>
      <div className="panel-note">{t('resize.current', { w: Math.round(base.width), h: Math.round(base.height) })}</div>

      <div className="panel-label">{t('resize.newSize')}</div>
      <div className="resize-fields">
        {field(width, setWidth, base.width, t('resize.width'))}
        <Link2 size={16} strokeWidth={2.5} aria-hidden="true" className="resize-link" />
        {field(height, setHeight, base.height, t('resize.height'))}
      </div>
      <ChipGroup
        label={t('resize.percent')}
        options={PERCENTS}
        value={PERCENTS.find((p) => Math.abs(scale * 100 - p) < 0.01) ?? null}
        onPick={(p) => apply(p / 100)}
        render={(p) => `${p}%`}
      />
      <div className="panel-note">{t('resize.note')}</div>
      {photoPages > 1 && (
        <Button block onClick={() => actions.setImageScale(scale, true)}>
          {t('resize.applyAll', { count: photoPages })}
        </Button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ desenhar */

const PEN_COLORS = ['#E5383B', '#161616', '#FFFFFF', '#2B6CB0', '#1D9E75', '#FFB703'];
const HIGHLIGHT_COLORS = ['#FFE14D', '#7CF27C', '#FF8AD8', '#6FD3FF', '#FFAA4D'];

const DRAW_TOOLS: Array<{ id: DrawTool; label: TranslationKey; icon: ReactNode }> = [
  { id: 'pen', label: 'draw.pen', icon: <PenLine size={16} strokeWidth={2.5} /> },
  { id: 'highlighter', label: 'draw.highlighter', icon: <Highlighter size={16} strokeWidth={2.5} /> },
  { id: 'eraser', label: 'draw.eraser', icon: <Eraser size={16} strokeWidth={2.5} /> },
];

export function DrawPanel() {
  const { state, actions } = useApp();
  const { tool } = state.draw;
  const style = tool === 'highlighter' ? state.draw.highlighter : state.draw.pen;

  return (
    <>
      <h6 className="panel-title">{t('draw.title')}</h6>
      <div className="panel-note">{tool === 'eraser' ? t('draw.eraserNote') : t('draw.note')}</div>

      <div className="segmented" role="radiogroup" aria-label={t('draw.tool')}>
        {DRAW_TOOLS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className="segmented-btn segmented-btn-icon"
            role="radio"
            aria-checked={tool === id}
            style={{ background: tool === id ? 'var(--color-accent)' : 'transparent', color: 'var(--graphite)' }}
            onClick={() => actions.setDrawSettings({ tool: id })}
          >
            {icon}
            {t(label)}
          </button>
        ))}
      </div>

      {tool !== 'eraser' && (
        <>
          <div className="panel-label">{t('overlay.color')}</div>
          <Swatches colors={tool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS} value={style.color} onChange={(color) => actions.setPenStyle(tool, { color })} />
          <RangeField
            label={t('draw.thickness')}
            value={style.thickness}
            min={1}
            max={100}
            onLive={(thickness) => actions.setPenStyle(tool, { thickness })}
            onCommit={(thickness) => actions.setPenStyle(tool, { thickness })}
          />
        </>
      )}

      <Button variant="primary" block onClick={() => actions.setTool(null)}>
        <Check size={16} strokeWidth={2.75} />
        {t('draw.done')}
      </Button>
    </>
  );
}
