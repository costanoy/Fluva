import { Move, Wand2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { useApp } from '../../state/AppContext';
import { SUBSTITUTE_FAMILIES, familyByKey } from '../../pdf/fonts';
import type { Rect } from '../../pdf/model';

/**
 * Editor for one original text run. PDF text cannot be mutated in place, so
 * confirming here paints over the original and draws the new text on top.
 *
 * Every field here writes straight into the shared draft, which the canvas
 * renders live (see TextRunPreview) — the page updates as you type, and
 * "Substituir"/"Mover" just commits that draft into a real overlay.
 */
export function TextRunPanel() {
  const { state, actions } = useApp();
  const target = state.textRunTarget;
  const draft = state.textRunDraft;

  if (!target || !draft) return null;
  const { text, fontKey, size, bold, italic } = draft;
  const family = familyByKey(fontKey);

  const detachFromPage = (bounds: Rect, enterMoveMode = false) => {
    actions.replaceTextRun(bounds, text, fontKey, size, bold, italic, enterMoveMode);
    actions.setTextRunTarget(null);
  };

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>Substituir texto</h6>

      <div className="panel-label">Texto</div>
      <textarea className="text-input" rows={6} value={text} onChange={(e) => actions.setTextRunDraft({ text: e.target.value })} />

      <div className="font-detected">
        <span className="font-detected-label">Fonte original</span>
        <strong>{target.originalFont}</strong>
        <span className={target.exactSubstitute ? 'font-badge font-badge-exact' : 'font-badge'}>
          {target.exactSubstitute ? 'substituta com métrica idêntica' : 'substituta aproximada'}
        </span>
      </div>

      <div className="panel-label">Fonte substituta</div>
      <div className="font-option-list">
        {SUBSTITUTE_FAMILIES.map((f) => (
          <button
            key={f.key}
            className="font-option"
            style={{ background: f.key === fontKey ? 'var(--color-accent-100)' : 'transparent' }}
            onClick={() => actions.setTextRunDraft({ fontKey: f.key })}
          >
            <span style={{ fontFamily: f.cssFamily, fontWeight: 700 }}>{f.label}</span>
            <span style={{ color: 'var(--color-neutral-600)', fontSize: 13 }}> — no lugar de {f.metricMatches.slice(0, 2).join(', ')}</span>
          </button>
        ))}
      </div>

      <button
        className="panel-group-subaction"
        style={{ justifyContent: 'center', border: '1px dashed var(--color-divider)' }}
        title="Procura, em todas as páginas, outros textos com a mesma fonte original e aplica esta mesma substituta a todos, mantendo o negrito/itálico e as cores de cada um"
        onClick={() => actions.applyFontToMatchingRuns(target.originalFont, fontKey, target.id)}
      >
        <Wand2 size={14} strokeWidth={2.5} />
        Aplicar esta fonte a todo o documento
      </button>

      <div className="font-preview" style={{ fontFamily: family.cssFamily, fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal' }}>
        {text.split('\n')[0] || 'Aa Bb Cc'}
      </div>

      <div className="panel-label">Tamanho</div>
      <div className="panel-row">
        <input
          type="number"
          min={4}
          max={144}
          step={0.5}
          value={size}
          onChange={(e) => actions.setTextRunDraft({ size: Number(e.target.value) })}
          className="number-input"
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-secondary"
          style={{ flex: 1, fontWeight: 800, background: bold ? 'var(--color-accent)' : undefined, color: bold ? '#fff' : undefined }}
          onClick={() => actions.setTextRunDraft({ bold: !bold })}
        >
          N
        </button>
        <button
          className="btn btn-secondary"
          style={{ flex: 1, fontStyle: 'italic', fontWeight: 700, background: italic ? 'var(--color-accent)' : undefined, color: italic ? '#fff' : undefined }}
          onClick={() => actions.setTextRunDraft({ italic: !italic })}
        >
          I
        </button>
      </div>

      <Button
        variant="primary"
        block
        disabled={!text.trim()}
        onClick={() => detachFromPage({ x: target.x, y: target.y, width: target.width, height: target.height })}
      >
        Substituir texto
      </Button>
      <Button
        block
        disabled={!text.trim()}
        title="Solta o texto do PDF original para você arrastá-lo livremente pela página"
        onClick={() => detachFromPage({ x: target.x, y: target.y, width: target.width, height: target.height }, true)}
      >
        <Move size={16} strokeWidth={2.75} />
        Mover texto
      </Button>
      <Button
        block
        onClick={() => {
          actions.setEditingText(null);
          actions.setTextRunTarget(null);
        }}
      >
        Cancelar
      </Button>
    </>
  );
}
