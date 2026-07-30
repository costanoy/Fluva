import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { useApp } from '../../state/AppContext';
import { SUBSTITUTE_FAMILIES, familyByKey } from '../../pdf/fonts';

/**
 * Editor for one original text run. PDF text cannot be mutated in place, so
 * confirming here paints over the original and draws the new text on top — the
 * panel is explicit about that.
 */
export function TextRunPanel() {
  const { state, actions } = useApp();
  const target = state.textRunTarget;

  const [text, setText] = useState('');
  const [fontKey, setFontKey] = useState('sans');
  const [size, setSize] = useState(12);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);

  useEffect(() => {
    if (!target) return;
    setText(target.text);
    setFontKey(target.substituteKey);
    setSize(Math.round(target.fontSize * 10) / 10);
    setBold(target.bold);
    setItalic(target.italic);
  }, [target]);

  if (!target) return null;
  const family = familyByKey(fontKey);

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>Substituir texto</h6>

      <div className="panel-note">
        O texto original está no conteúdo do PDF e não pode ser alterado no lugar. Ao confirmar, ele é coberto e o novo
        texto é desenhado por cima.
      </div>

      <div className="panel-label">Texto</div>
      <textarea className="text-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />

      <div className="font-detected">
        <span className="font-detected-label">Fonte original</span>
        <strong>{target.originalFont}</strong>
        <span className={target.exactSubstitute ? 'font-badge font-badge-exact' : 'font-badge'}>
          {target.exactSubstitute ? 'substituta com métrica idêntica' : 'substituta aproximada'}
        </span>
      </div>

      <div className="panel-label">Fonte substituta</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {SUBSTITUTE_FAMILIES.map((f) => (
          <button
            key={f.key}
            className="font-option"
            style={{ background: f.key === fontKey ? 'var(--color-accent-100)' : 'transparent' }}
            onClick={() => setFontKey(f.key)}
          >
            <span style={{ fontFamily: f.cssFamily, fontWeight: 700 }}>{f.label}</span>
            <span style={{ color: 'var(--color-neutral-600)', fontSize: 11 }}> — no lugar de {f.metricMatches.slice(0, 2).join(', ')}</span>
          </button>
        ))}
      </div>

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
          onChange={(e) => setSize(Number(e.target.value))}
          className="number-input"
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-secondary"
          style={{ flex: 1, fontWeight: 800, background: bold ? 'var(--color-accent)' : undefined, color: bold ? '#fff' : undefined }}
          onClick={() => setBold(!bold)}
        >
          N
        </button>
        <button
          className="btn btn-secondary"
          style={{ flex: 1, fontStyle: 'italic', fontWeight: 700, background: italic ? 'var(--color-accent)' : undefined, color: italic ? '#fff' : undefined }}
          onClick={() => setItalic(!italic)}
        >
          I
        </button>
      </div>

      <Button
        variant="primary"
        block
        disabled={!text.trim()}
        onClick={() => {
          actions.replaceTextRun(
            { x: target.x, y: target.y, width: target.width, height: target.height },
            text,
            fontKey,
            size,
            bold,
            italic,
          );
          actions.setTextRunTarget(null);
        }}
      >
        Substituir texto
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
