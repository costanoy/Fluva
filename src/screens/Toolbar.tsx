import { AlignJustify, Columns2, Combine, Droplet, Minimize2, Pencil, Redo2, RotateCw, Search, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../components/Button';
import { useApp } from '../state/AppContext';
import type { ToolMode } from '../state/appTypes';
import { MIN_SCALE, MAX_SCALE } from './EditorCanvas';
import '../styles/toolbar.css';

export function Toolbar() {
  const { state, actions } = useApp();
  const { toolMode } = state;
  const isPdf = state.doc.kind === 'pdf';
  const busy = !!state.busy;

  const tool = (mode: ToolMode, icon: ReactNode, label: string) => (
    <Button
      className="toolbar-btn"
      style={{ background: toolMode === mode ? 'var(--color-accent-100)' : 'transparent' }}
      onClick={() => actions.setTool(mode)}
      disabled={busy}
      title={label}
    >
      {icon}
      <span className="toolbar-btn-label">{label}</span>
    </Button>
  );

  return (
    <div className="toolbar" onClick={(e) => e.stopPropagation()}>
      <Button
        className="toolbar-btn"
        style={{ background: !toolMode ? 'var(--color-accent-100)' : 'transparent' }}
        onClick={() => actions.setTool(null)}
        disabled={busy}
        title="Editar"
      >
        <Pencil size={15} strokeWidth={2.75} />
        <span className="toolbar-btn-label">Editar</span>
      </Button>

      {isPdf && tool('merge', <Combine size={15} strokeWidth={2.75} />, 'Juntar PDFs')}
      {isPdf && tool('split', <Columns2 size={15} strokeWidth={2.75} />, 'Dividir PDF')}
      {tool('compress', <Minimize2 size={15} strokeWidth={2.75} />, 'Comprimir')}

      <Button className="toolbar-btn" onClick={actions.rotateActivePage} disabled={busy} title="Rodar página">
        <RotateCw size={15} strokeWidth={2.75} />
        <span className="toolbar-btn-label">Rodar</span>
      </Button>

      {tool('watermark', <Droplet size={15} strokeWidth={2.75} />, "Marca d'água")}
      {state.doc.pages.length > 1 && tool('reorder', <AlignJustify size={15} strokeWidth={2.75} />, 'Organizar')}

      <div className="toolbar-spacer" />

      <Button icon disabled={!state.history.length || busy} title="Desfazer (Ctrl+Z)" onClick={actions.undo}>
        <Undo2 size={15} strokeWidth={2.75} />
      </Button>
      <Button icon disabled={!state.future.length || busy} title="Refazer (Ctrl+Shift+Z)" onClick={actions.redo}>
        <Redo2 size={15} strokeWidth={2.75} />
      </Button>

      <div className="toolbar-zoom">
        <Search size={15} strokeWidth={2.5} aria-label="Zoom" />
        <input
          type="range"
          className="toolbar-zoom-slider"
          min={Math.round(MIN_SCALE * 100)}
          max={Math.round(MAX_SCALE * 100)}
          step={1}
          value={Math.round(state.effectiveZoom * 100)}
          onChange={(e) => actions.setZoom(Number(e.target.value) / 100)}
          title={`Zoom: ${Math.round(state.effectiveZoom * 100)}%`}
          aria-label="Zoom da página"
        />
        <span className="toolbar-zoom-value">{Math.round(state.effectiveZoom * 100)}%</span>
      </div>
    </div>
  );
}
