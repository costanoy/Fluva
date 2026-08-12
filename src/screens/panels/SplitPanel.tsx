import type { CSSProperties } from 'react';
import { Check, Columns2, Files, Plus, Scissors, X } from 'lucide-react';
import { Button } from '../../components/Button';
import { useApp } from '../../state/AppContext';
import type { FluvaActions } from '../../state/useFluvaStore';
import type { AppState, SplitRangeItem } from '../../state/appTypes';

const segStyle = (active: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: active ? 'var(--color-accent)' : 'transparent',
  color: active ? '#FFFFFF' : 'var(--color-text)',
});

const subModeStyle = (active: boolean): CSSProperties => ({
  background: active ? 'var(--color-accent-100)' : 'var(--color-neutral-100)',
  borderColor: active ? 'var(--color-accent)' : 'var(--color-divider)',
  color: active ? 'var(--color-accent-700)' : 'var(--color-text)',
  fontWeight: active ? 700 : 500,
});

export function SplitPanel() {
  const { state, actions } = useApp();

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-2-700)' }}>Dividir PDF</h6>

      <div className="segmented">
        <button className="segmented-btn" style={segStyle(state.splitMode === 'range')} onClick={() => actions.setSplitMode('range')}>
          <Columns2 size={15} strokeWidth={2.75} />
          Intervalo
        </button>
        <button className="segmented-btn" style={segStyle(state.splitMode === 'pages')} onClick={() => actions.setSplitMode('pages')}>
          <Files size={15} strokeWidth={2.75} />
          Páginas
        </button>
      </div>

      {state.splitMode === 'range' ? <RangePanel state={state} actions={actions} /> : <PagesPanel state={state} actions={actions} />}
    </>
  );
}

function RangePanel({ state, actions }: { state: AppState; actions: FluvaActions }) {
  const total = state.doc.pages.length;

  return (
    <>
      <div className="panel-row" style={{ gap: 8 }}>
        <button className="shape-type-btn" style={subModeStyle(state.splitRangeSubMode === 'auto')} onClick={() => actions.setSplitRangeSubMode('auto')}>
          Intervalo automático
        </button>
        <button className="shape-type-btn" style={subModeStyle(state.splitRangeSubMode === 'custom')} onClick={() => actions.setSplitRangeSubMode('custom')}>
          Escolher intervalo
        </button>
      </div>

      {state.splitRangeSubMode === 'auto' ? (
        <>
          <div className="panel-label">Dividir em quantas partes?</div>
          <input
            type="number"
            min={1}
            max={total}
            value={state.splitAutoParts}
            onChange={(e) => actions.setSplitAutoParts(Number(e.target.value))}
            className="number-input"
            style={{ width: '100%' }}
          />
          <div className="panel-note">
            As {total} páginas serão divididas em {state.splitAutoParts} arquivo(s), o mais equilibrado possível.
          </div>
        </>
      ) : (
        <>
          <div className="panel-label">Intervalos</div>
          {state.splitCustomRanges.length === 0 && <div className="panel-empty">Nenhum intervalo adicionado ainda.</div>}
          {state.splitCustomRanges.map((range: SplitRangeItem, i: number) => (
            <div key={range.id} className="panel-row">
              <span className="panel-unit">de</span>
              <input
                type="number"
                min={1}
                max={total}
                value={range.start}
                onChange={(e) => actions.updateSplitCustomRange(range.id, { start: Number(e.target.value) })}
                className="number-input"
              />
              <span className="panel-unit">até</span>
              <input
                type="number"
                min={1}
                max={total}
                value={range.end}
                onChange={(e) => actions.updateSplitCustomRange(range.id, { end: Number(e.target.value) })}
                className="number-input"
              />
              <button className="icon-btn-plain" aria-label={`Remover intervalo ${i + 1}`} onClick={() => actions.removeSplitCustomRange(range.id)}>
                <X size={14} strokeWidth={3} />
              </button>
            </div>
          ))}
          <Button block onClick={actions.addSplitCustomRange}>
            <Plus size={15} strokeWidth={2.75} />
            Adicionar intervalo
          </Button>
        </>
      )}

      <Button
        variant="primary"
        block
        onClick={actions.runSplit}
        disabled={!!state.busy || (state.splitRangeSubMode === 'custom' && state.splitCustomRanges.length === 0)}
      >
        <Scissors size={15} strokeWidth={2.75} />
        Dividir
      </Button>
    </>
  );
}

function PagesPanel({ state, actions }: { state: AppState; actions: FluvaActions }) {
  const total = state.doc.pages.length;

  return (
    <>
      <div className="panel-row" style={{ gap: 8 }}>
        <button className="shape-type-btn" style={subModeStyle(state.splitPagesSubMode === 'all')} onClick={() => actions.setSplitPagesSubMode('all')}>
          Extrair todas
        </button>
        <button className="shape-type-btn" style={subModeStyle(state.splitPagesSubMode === 'select')} onClick={() => actions.setSplitPagesSubMode('select')}>
          Selecionar páginas
        </button>
      </div>

      {state.splitPagesSubMode === 'all' ? (
        <div className="panel-note">Cada uma das {total} páginas vira um PDF separado, entregues em um .zip.</div>
      ) : (
        <>
          <div className="panel-note">Clique nas páginas na área central para selecioná-las.</div>
          <button
            className="panel-group-subaction"
            style={{ border: '1px solid var(--color-divider)', justifyContent: 'flex-start' }}
            onClick={() => actions.setSplitMergeSelected(!state.splitMergeSelected)}
          >
            <span
              className="merge-checkbox"
              style={{
                borderColor: state.splitMergeSelected ? 'var(--color-accent)' : 'var(--color-neutral-400)',
                background: state.splitMergeSelected ? 'var(--color-accent)' : 'transparent',
              }}
            >
              {state.splitMergeSelected && <Check size={10} strokeWidth={3.5} color="#fff" />}
            </span>
            Mesclar páginas selecionadas em um único PDF
          </button>
          <div className="panel-note">{state.splitSelectedPages.length} página(s) selecionada(s).</div>
        </>
      )}

      <Button
        variant="primary"
        block
        onClick={actions.runSplit}
        disabled={!!state.busy || (state.splitPagesSubMode === 'select' && state.splitSelectedPages.length === 0)}
      >
        <Scissors size={15} strokeWidth={2.75} />
        {state.splitPagesSubMode === 'all' ? `Extrair ${total} arquivos` : 'Extrair selecionadas'}
      </Button>
    </>
  );
}
