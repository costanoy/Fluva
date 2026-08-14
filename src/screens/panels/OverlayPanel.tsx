import { Check, Circle, Move, Palette, Pipette, RotateCw, Square, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { useApp } from '../../state/AppContext';
import { SUBSTITUTE_FAMILIES } from '../../pdf/fonts';
import type { Overlay } from '../../pdf/model';

const SHAPE_COLORS = ['#1D9E75', '#D85A30', '#534AB7', '#2C2C2A', '#FFFFFF'];
const TEXT_COLORS = ['#2C2C2A', '#1D9E75', '#D85A30', '#534AB7', '#FFFFFF'];

/** Editor for the overlay the user has selected on the page. */
export function OverlayPanel({ overlay }: { overlay: Overlay }) {
  const { state, actions } = useApp();
  const update = (patch: Partial<Overlay>) => actions.updateOverlay(overlay.id, patch, true);
  const isPending = state.pendingOverlayId === overlay.id;

  if (overlay.kind === 'text') {
    return (
      <>
        <h6 style={{ color: 'var(--color-accent-700)' }}>Texto</h6>

        <div className="panel-label">Conteúdo</div>
        <textarea className="text-input" rows={6} value={overlay.text} onChange={(e) => update({ text: e.target.value })} />

        <div className="panel-label">Fonte</div>
        <div className="font-option-list">
          {SUBSTITUTE_FAMILIES.map((f) => (
            <button
              key={f.key}
              className="font-option"
              style={{ background: f.key === overlay.fontKey ? 'var(--color-accent-100)' : 'transparent', fontFamily: f.cssFamily }}
              onClick={() => update({ fontKey: f.key })}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="panel-label">Tamanho</div>
        <div className="panel-row">
          <Button icon onClick={() => update({ size: Math.max(4, overlay.size - 2) })}>−</Button>
          <input
            type="number"
            min={4}
            max={200}
            value={Math.round(overlay.size * 10) / 10}
            onChange={(e) => update({ size: Math.max(4, Math.min(200, Number(e.target.value))) })}
            className="number-input"
            style={{ flex: 1 }}
          />
          <Button icon onClick={() => update({ size: Math.min(200, overlay.size + 2) })}>+</Button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, fontWeight: 800, background: overlay.bold ? 'var(--color-accent)' : undefined, color: overlay.bold ? '#fff' : undefined }}
            onClick={() => update({ bold: !overlay.bold })}
          >
            N
          </button>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, fontStyle: 'italic', fontWeight: 700, background: overlay.italic ? 'var(--color-accent)' : undefined, color: overlay.italic ? '#fff' : undefined }}
            onClick={() => update({ italic: !overlay.italic })}
          >
            I
          </button>
        </div>

        <div className="panel-label">Cor</div>
        <Swatches colors={TEXT_COLORS} value={overlay.color} onChange={(color) => update({ color })} />

        <RotationSlider value={overlay.rotation} onChange={(rotation) => actions.updateOverlay(overlay.id, { rotation }, false)} onCommit={(rotation) => update({ rotation })} />

        {/* A plain click on selected text places a caret to edit it in place —
            dragging it needs its own mode so a press-and-drag to reposition
            isn't misread as a text selection. Image/shape overlays don't need
            this since they have no in-place text to protect. */}
        <Button block onClick={() => actions.setMovingOverlay(overlay.id)}>
          <Move size={16} strokeWidth={2.75} />
          Mover texto
        </Button>

        <Button block onClick={() => actions.removeOverlay(overlay.id)}>
          <Trash2 size={16} strokeWidth={2.75} />
          Remover texto
        </Button>
      </>
    );
  }

  if (overlay.kind === 'image') {
    return (
      <>
        <h6 style={{ color: 'var(--color-accent-2-700)' }}>Imagem</h6>
        <div className="panel-note">Arraste na página para mover, ou use a alça no canto para redimensionar.</div>

        <div className="panel-label">Tamanho</div>
        <div className="panel-row">
          <span className="panel-unit">L</span>
          <input
            type="number"
            className="number-input"
            style={{ flex: 1 }}
            value={Math.round(overlay.width)}
            onChange={(e) => {
              const width = Math.max(8, Number(e.target.value));
              update({ width, height: width * (overlay.height / overlay.width) });
            }}
          />
          <span className="panel-unit">A</span>
          <input
            type="number"
            className="number-input"
            style={{ flex: 1 }}
            value={Math.round(overlay.height)}
            onChange={(e) => update({ height: Math.max(8, Number(e.target.value)) })}
          />
        </div>

        <Button block onClick={() => update({ rotation: (overlay.rotation + 90) % 360 })}>
          <RotateCw size={16} strokeWidth={2.75} />
          Girar 90°
        </Button>
        <RotationSlider value={overlay.rotation} onChange={(rotation) => actions.updateOverlay(overlay.id, { rotation }, false)} onCommit={(rotation) => update({ rotation })} />

        <Button block onClick={() => actions.removeOverlay(overlay.id)}>
          <Trash2 size={16} strokeWidth={2.75} />
          Remover imagem
        </Button>
      </>
    );
  }

  if (overlay.kind === 'shape') {
    return (
      <>
        <h6 style={{ color: 'var(--color-accent-700)' }}>Forma</h6>

        {isPending && (
          <Button variant="primary" block style={{ marginTop: 0 }} onClick={actions.confirmPendingOverlay}>
            <Check size={16} strokeWidth={2.75} />
            Confirmar colocação
          </Button>
        )}

        <div className="panel-label" style={{ marginTop: isPending ? undefined : 6 }}>Formato</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="shape-type-btn"
            aria-label="Retângulo"
            title="Retângulo"
            style={{ background: overlay.shape === 'rect' ? 'var(--color-accent-100)' : undefined, borderColor: overlay.shape === 'rect' ? 'var(--color-accent)' : undefined }}
            onClick={() => update({ shape: 'rect' })}
          >
            <Square size={20} strokeWidth={2.5} />
          </button>
          <button
            className="shape-type-btn"
            aria-label="Círculo"
            title="Círculo"
            style={{ background: overlay.shape === 'circle' ? 'var(--color-accent-100)' : undefined, borderColor: overlay.shape === 'circle' ? 'var(--color-accent)' : undefined }}
            onClick={() => update({ shape: 'circle' })}
          >
            <Circle size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="panel-label">Cor</div>
        <Swatches colors={SHAPE_COLORS} value={overlay.color} onChange={(color) => update({ color })} />

        <div className="panel-label">Tamanho</div>
        <div className="panel-row">
          <span className="panel-unit">L</span>
          <input type="number" className="number-input" style={{ flex: 1 }} value={Math.round(overlay.width)} onChange={(e) => update({ width: Math.max(8, Number(e.target.value)) })} />
          <span className="panel-unit">A</span>
          <input type="number" className="number-input" style={{ flex: 1 }} value={Math.round(overlay.height)} onChange={(e) => update({ height: Math.max(8, Number(e.target.value)) })} />
        </div>

        <Button block onClick={() => actions.removeOverlay(overlay.id)}>
          <Trash2 size={16} strokeWidth={2.75} />
          Remover forma
        </Button>
      </>
    );
  }

  return (
    <>
      <h6>Cobertura</h6>
      <div className="panel-note">Retângulo que cobre o texto original substituído.</div>
      <Button block onClick={() => actions.removeOverlay(overlay.id)}>
        <Trash2 size={16} strokeWidth={2.75} />
        Remover cobertura
      </Button>
    </>
  );
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  const pickFromScreen = async () => {
    try {
      // EyeDropper isn't in the standard DOM lib types yet; the runtime check above guards it.
      const EyeDropperCtor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
      const result = await new EyeDropperCtor().open();
      onChange(result.sRGBHex);
    } catch {
      // User cancelled the pick (Escape) — nothing to do.
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {colors.map((c) => (
        <button
          key={c}
          className="swatch"
          aria-label={`Cor ${c}`}
          style={{ background: c, outline: c === value ? '2px solid var(--color-accent)' : 'none', outlineOffset: 2 }}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="swatch swatch-custom" style={{ background: value }} title="Escolher cor (RGB)">
        <Palette size={13} strokeWidth={2.5} color={isLight(value) ? '#2C2C2A' : '#FFFFFF'} />
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      </label>
      {hasEyeDropper && (
        <button className="swatch swatch-eyedrop" title="Capturar cor da tela" aria-label="Capturar cor da tela" onClick={pickFromScreen}>
          <Pipette size={13} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

function isLight(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length !== 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

function RotationSlider({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <>
      <div className="panel-label">Rotação: {Math.round(value)}°</div>
      <input
        type="range"
        min={-180}
        max={180}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        style={{ width: '100%' }}
      />
    </>
  );
}
