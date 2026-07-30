import { RotateCw, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { useApp } from '../../state/AppContext';
import { SUBSTITUTE_FAMILIES } from '../../pdf/fonts';
import type { Overlay } from '../../pdf/model';

const SHAPE_COLORS = ['#1D9E75', '#D85A30', '#534AB7', '#2C2C2A', '#FFFFFF'];
const TEXT_COLORS = ['#2C2C2A', '#1D9E75', '#D85A30', '#534AB7', '#FFFFFF'];

/** Editor for the overlay the user has selected on the page. */
export function OverlayPanel({ overlay }: { overlay: Overlay }) {
  const { actions } = useApp();
  const update = (patch: Partial<Overlay>) => actions.updateOverlay(overlay.id, patch, true);

  if (overlay.kind === 'text') {
    return (
      <>
        <h6 style={{ color: 'var(--color-accent-700)' }}>Texto</h6>

        <div className="panel-label">Conteúdo</div>
        <textarea className="text-input" rows={3} value={overlay.text} onChange={(e) => update({ text: e.target.value })} />

        <div className="panel-label">Fonte</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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

        <div className="panel-label">Cor</div>
        <Swatches colors={SHAPE_COLORS} value={overlay.color} onChange={(color) => update({ color })} />

        <Button block onClick={() => update({ shape: overlay.shape === 'rect' ? 'circle' : 'rect' })}>
          Alternar para {overlay.shape === 'rect' ? 'círculo' : 'retângulo'}
        </Button>

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
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {colors.map((c) => (
        <button
          key={c}
          className="swatch"
          aria-label={`Cor ${c}`}
          style={{ background: c, outline: c === value ? '2px solid var(--color-accent)' : 'none', outlineOffset: 2 }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
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
