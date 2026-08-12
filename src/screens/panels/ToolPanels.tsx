import { useState } from 'react';
import { Download, GripVertical, X } from 'lucide-react';
import { Button } from '../../components/Button';
import { useApp } from '../../state/AppContext';
import { formatBytes } from '../../pdf/loader';
import { compressLabel, type CompressLevel } from '../../pdf/ops';

/* ------------------------------------------------------------------ juntar */

export function MergePanel() {
  const { state, actions } = useApp();
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const selected = state.mergeSelected.map((id) => state.doc.sources[id]).filter(Boolean);
  const totalPages = selected.reduce((sum, s) => sum + s.pageCount, 0);

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>Juntar PDFs</h6>
      <div className="panel-note">
        Marque na coluna à esquerda os arquivos a juntar. Aqui você define a ordem em que as páginas entram no final do
        documento atual.
      </div>

      {selected.length === 0 ? (
        <div className="panel-empty">Nenhum arquivo selecionado.</div>
      ) : (
        <>
          <div className="panel-label">Ordem de junção</div>
          {selected.map((source, index) => (
            <div
              key={source.id}
              className={`merge-order-row${dragIndex === index ? ' dragging' : ''}`}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null && dragIndex !== index) actions.reorderMergeSelection(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <GripVertical size={14} strokeWidth={2.5} color="var(--color-neutral-500)" />
              <span className="merge-order-index">{index + 1}.</span>
              <span className="merge-order-name">
                {source.name}
                <span className="merge-order-meta">{source.pageCount} pág.</span>
              </span>
              <button className="icon-btn-plain" aria-label={`Remover ${source.name}`} onClick={() => actions.toggleMergeSource(source.id)}>
                <X size={13} strokeWidth={3} />
              </button>
            </div>
          ))}

          <Button variant="primary" block onClick={actions.confirmMerge} disabled={!!state.busy}>
            Juntar {selected.length} arquivo(s) · +{totalPages} páginas
          </Button>
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------- comprimir */

const LEVELS: CompressLevel[] = ['low', 'medium', 'high'];

export function CompressPanel() {
  const { state, actions } = useApp();
  const outcome = state.compressOutcome;

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>Comprimir</h6>

      <div className="panel-label">Intensidade</div>
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
            {compressLabel(level)}
          </button>
        ))}
      </div>

      <div className="panel-note">
        Documentos digitalizados ou com muitas imagens são recodificados como imagem, o que reduz bastante o tamanho.
        Arquivos de texto já otimizados são mantidos como estão, sem perder qualidade.
      </div>

      <Button variant="primary" block onClick={actions.runCompress} disabled={!!state.busy}>
        Comprimir agora
      </Button>

      {outcome && (
        <div className={outcome.reductionPct > 0 ? 'compress-result' : 'compress-result compress-result-warn'}>
          <div className="compress-row">
            <span>Antes</span>
            <strong>{formatBytes(outcome.originalSize)}</strong>
          </div>
          <div className="compress-row">
            <span>Depois</span>
            <strong>{formatBytes(outcome.compressedSize)}</strong>
          </div>
          <div className="compress-headline">
            {outcome.reductionPct > 0
              ? `−${outcome.reductionPct}% de tamanho`
              : 'Este arquivo já está no menor tamanho possível.'}
          </div>
          <div className="panel-note">
            {outcome.strategy === 'raster'
              ? 'As páginas viraram imagem, então o texto não fica mais selecionável.'
              : 'Recodificar como imagem deixaria o arquivo maior, então o documento foi mantido com o texto selecionável.'}
          </div>
          <Button variant="primary" block onClick={actions.downloadCompressed}>
            <Download size={16} strokeWidth={2.75} />
            Baixar PDF
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

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>Marca d'água</h6>

      <Button
        variant={wm.enabled ? 'primary' : 'secondary'}
        block
        style={{ marginTop: 0, justifyContent: 'center' }}
        onClick={() => commit({ enabled: !wm.enabled })}
      >
        {wm.enabled ? 'Marca d\'água ativa' : 'Ativar marca d\'água'}
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
              Texto
            </button>
            <button
              className="segmented-btn"
              style={{
                background: wm.source.kind === 'image' ? 'var(--color-accent)' : 'transparent',
                color: wm.source.kind === 'image' ? '#FFFFFF' : 'var(--color-text)',
              }}
              onClick={actions.uploadWatermarkImage}
            >
              Imagem
            </button>
          </div>

          {wm.source.kind === 'text' ? (
            <>
              <div className="panel-label">Texto</div>
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
              <span className="panel-note" style={{ margin: 0 }}>Imagem carregada</span>
              <Button onClick={actions.clearWatermarkImage}>Trocar por texto</Button>
            </div>
          )}

          <Button
            block
            style={{ background: wm.allPages ? 'var(--color-accent-100)' : undefined }}
            onClick={() => commit({ allPages: !wm.allPages })}
          >
            {wm.allPages ? 'Em todas as páginas' : 'Somente na primeira página'}
          </Button>

          <Slider label="Posição horizontal" min={0} max={100} value={wm.x} onLive={(x) => live({ x })} onCommit={(x) => commit({ x })} suffix="%" />
          <Slider label="Posição vertical" min={0} max={100} value={wm.y} onLive={(y) => live({ y })} onCommit={(y) => commit({ y })} suffix="%" />
          <Slider label="Tamanho" min={20} max={250} value={wm.scale} onLive={(scale) => live({ scale })} onCommit={(scale) => commit({ scale })} suffix="%" />
          <Slider label="Rotação" min={-90} max={90} value={wm.rotation} onLive={(rotation) => live({ rotation })} onCommit={(rotation) => commit({ rotation })} suffix="°" />
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
  const { state, actions } = useApp();
  const total = state.doc.pages.length;

  return (
    <>
      <h6 style={{ color: 'var(--color-accent-700)' }}>Organizar páginas</h6>
      <div className="panel-note">Arraste as miniaturas à esquerda para reordenar, ou informe as posições abaixo.</div>

      <div className="panel-row">
        <span className="panel-unit">página</span>
        <input
          type="number"
          min={1}
          max={total}
          value={state.reorderFrom}
          onChange={(e) => actions.setReorderFrom(e.target.value)}
          className="number-input"
        />
        <span className="panel-unit">para</span>
        <input
          type="number"
          min={1}
          max={total}
          value={state.reorderTo}
          onChange={(e) => actions.setReorderTo(e.target.value)}
          className="number-input"
        />
      </div>

      <Button variant="primary" block onClick={actions.confirmReorder}>
        Mover página
      </Button>
    </>
  );
}
