import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { useApp } from '../state/AppContext';
import type { ToolMode } from '../state/appTypes';
import { t, type TranslationKey } from '../i18n/translations';
import { MIN_SCALE, MAX_SCALE } from './EditorCanvas';
import '../styles/toolbar.css';

const ZOOM_STEP = 0.1;
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

type ToolId = 'edit' | 'merge' | 'split' | 'compress' | 'rotate' | 'watermark' | 'reorder';

interface ToolDef {
  id: ToolId;
  icon: IconName;
  labelKey: TranslationKey;
}

/** Every tool the editor has for the open document, in toolbar order. */
function useTools(): ToolDef[] {
  const { state } = useApp();
  const isPdf = state.doc.kind === 'pdf';
  const tools: ToolDef[] = [{ id: 'edit', icon: 'pencil', labelKey: 'toolbar.edit' }];
  if (isPdf) tools.push({ id: 'merge', icon: 'merge', labelKey: 'toolbar.merge' });
  if (isPdf) tools.push({ id: 'split', icon: 'split', labelKey: 'toolbar.split' });
  tools.push({ id: 'compress', icon: 'compress', labelKey: 'toolbar.compress' });
  tools.push({ id: 'rotate', icon: 'rotate', labelKey: 'toolbar.rotate' });
  tools.push({ id: 'watermark', icon: 'watermark', labelKey: 'toolbar.watermark' });
  if (state.doc.pages.length > 1) tools.push({ id: 'reorder', icon: 'reorder', labelKey: 'toolbar.reorder' });
  return tools;
}

function useToolActions() {
  const { state, actions } = useApp();
  const isActive = (id: ToolId) => (id === 'edit' ? !state.toolMode : id !== 'rotate' && state.toolMode === id);
  const run = (id: ToolId) => {
    if (id === 'rotate') actions.rotateActivePage();
    else actions.setTool(id === 'edit' ? null : (id as Exclude<ToolMode, null>));
  };
  return { isActive, run };
}

function ZoomGroup({ className }: { className?: string }) {
  const { state, actions } = useApp();
  const pct = Math.round(state.effectiveZoom * 100);
  return (
    <div className={`seg-group toolbar-zoom${className ? ` ${className}` : ''}`}>
      <button aria-label={t('toolbar.zoomOut')} onClick={() => actions.setZoom(clampScale(state.effectiveZoom - ZOOM_STEP))}>
        <Icon name="minus" size={18} strokeWidth={2.4} />
      </button>
      <button className="seg-group-value" title={t('toolbar.zoomTitle', { pct })} aria-label={t('toolbar.zoomAria')} onClick={() => actions.setZoom(null)}>
        {pct}%
      </button>
      <button aria-label={t('toolbar.zoomIn')} onClick={() => actions.setZoom(clampScale(state.effectiveZoom + ZOOM_STEP))}>
        <Icon name="plus" size={18} strokeWidth={2.4} />
      </button>
    </div>
  );
}

function UndoRedo() {
  const { state, actions } = useApp();
  const busy = !!state.busy;
  return (
    <>
      <button className="btn-ghost toolbar-icon" disabled={!state.history.length || busy} title={t('toolbar.undo')} aria-label={t('toolbar.undo')} onClick={actions.undo}>
        <Icon name="undo" size={19} />
      </button>
      <button className="btn-ghost toolbar-icon" disabled={!state.future.length || busy} title={t('toolbar.redo')} aria-label={t('toolbar.redo')} onClick={actions.redo}>
        <Icon name="redo" size={19} />
      </button>
    </>
  );
}

/** Barra de ferramentas do editor (desktop) e a sub-barra do celular. */
export function Toolbar() {
  const { state, actions } = useApp();
  const tools = useTools();
  const { isActive, run } = useToolActions();
  const busy = !!state.busy;
  const total = state.doc.pages.length;

  return (
    <>
      <div className="toolbar" onClick={(e) => e.stopPropagation()}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            className="btn-ghost toolbar-btn"
            aria-pressed={tool.id === 'rotate' ? undefined : isActive(tool.id)}
            onClick={() => run(tool.id)}
            disabled={busy}
            title={tool.id === 'rotate' ? t('toolbar.rotateTitle') : t(tool.labelKey)}
          >
            <Icon name={tool.icon} size={18} />
            {t(tool.labelKey)}
          </button>
        ))}

        <div className="toolbar-divider" />
        <UndoRedo />
        <div className="toolbar-spacer" />
        <ZoomGroup />
      </div>

      <div className="toolbar-mobile" onClick={(e) => e.stopPropagation()}>
        <UndoRedo />
        <div className="toolbar-spacer" />
        <label className="page-select">
          <span>{t('toolbar.pageSelect', { n: state.activePageIndex + 1, total })}</span>
          <Icon name="chevronDown" size={16} strokeWidth={2.4} />
          <select value={state.activePageIndex} onChange={(e) => actions.setActivePage(Number(e.target.value))} aria-label={t('rail.pageAria', { n: state.activePageIndex + 1 })}>
            {state.doc.pages.map((p, i) => (
              <option key={p.id} value={i}>
                {t('toolbar.pageSelect', { n: i + 1, total })}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

/** Tab bar inferior do celular: as quatro primeiras ferramentas + "Mais". */
export function MobileTabBar() {
  const { state, actions } = useApp();
  const tools = useTools();
  const { isActive, run } = useToolActions();
  const [moreOpen, setMoreOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const busy = !!state.busy;
  const isPdf = state.doc.kind === 'pdf';

  // Same order as the design's tab bar: Editar · Juntar · Dividir · Girar, then
  // whatever the document still has room for; everything else goes in "Mais".
  const priority: ToolId[] = ['edit', 'merge', 'split', 'rotate', 'compress', 'watermark'];
  const main = priority.map((id) => tools.find((tool) => tool.id === id)).filter((tool): tool is ToolDef => !!tool).slice(0, 4);
  const extra = tools.filter((tool) => !main.includes(tool));
  const moreActive = extra.some((tool) => isActive(tool.id));

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const tab = (key: string, icon: IconName, label: string, active: boolean, onClick: () => void, pressed?: boolean) => (
    <button key={key} className="tabbar-btn" aria-pressed={pressed} onClick={onClick} disabled={busy}>
      <span className={active ? 'tabbar-icon tabbar-icon-active' : 'tabbar-icon'}>
        <Icon name={icon} size={active ? 18 : 20} />
      </span>
      {label}
    </button>
  );

  return (
    <div className="tabbar" ref={ref} onClick={(e) => e.stopPropagation()}>
      {moreOpen && (
        <div className="sheet more-sheet" role="menu">
          <div className="sheet-grip" />
          {extra.map((tool) => (
            <button
              key={tool.id}
              className="more-item"
              role="menuitem"
              aria-pressed={isActive(tool.id)}
              onClick={() => {
                setMoreOpen(false);
                run(tool.id);
              }}
            >
              <Icon name={tool.icon} size={20} />
              {t(tool.labelKey)}
            </button>
          ))}
          <button
            className="more-item"
            role="menuitem"
            onClick={() => {
              setMoreOpen(false);
              actions.addBlankPage();
            }}
          >
            <Icon name="plus" size={20} />
            {t('rail.addBlankPage')}
          </button>
          <button
            className="more-item"
            role="menuitem"
            onClick={() => {
              setMoreOpen(false);
              actions.toggleExport();
            }}
          >
            <Icon name="convert" size={20} />
            {t('home.changeFormat')}
          </button>
          {isPdf && (
            <button
              className="more-item"
              role="menuitem"
              onClick={() => {
                setMoreOpen(false);
                actions.setSignDialogOpen(true);
              }}
            >
              <Icon name="signature" size={20} />
              {t('export.signLabel')}
            </button>
          )}
        </div>
      )}
      {main.map((tool) =>
        tab(tool.id, tool.icon, t(tool.labelKey), tool.id !== 'rotate' && isActive(tool.id), () => run(tool.id), tool.id === 'rotate' ? undefined : isActive(tool.id)),
      )}
      {tab('more', 'more', t('toolbar.more'), moreActive || moreOpen, () => setMoreOpen((v) => !v))}
    </div>
  );
}
