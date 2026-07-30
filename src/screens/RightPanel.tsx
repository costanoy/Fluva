import { Crop, Image as ImageIcon, RotateCw, Square, Trash2, Type } from 'lucide-react';
import { Button } from '../components/Button';
import { useApp } from '../state/AppContext';
import { OverlayPanel } from './panels/OverlayPanel';
import { TextRunPanel } from './panels/TextRunPanel';
import { CompressPanel, MergePanel, ReorderPanel, SplitPanel, WatermarkPanel } from './panels/ToolPanels';
import '../styles/panel.css';

export function RightPanel() {
  const { state, actions } = useApp();
  const page = state.doc.pages[state.activePageIndex];
  const selectedOverlay = page?.overlays.find((o) => o.id === state.selectedOverlayId);
  const cropping = state.cropDraft !== null;

  return (
    <div className="right-panel" onClick={(e) => e.stopPropagation()}>
      <div className="panel-grip" />

      {state.toolMode === 'merge' && <MergePanel />}
      {state.toolMode === 'split' && <SplitPanel />}
      {state.toolMode === 'compress' && <CompressPanel />}
      {state.toolMode === 'watermark' && <WatermarkPanel />}
      {state.toolMode === 'reorder' && <ReorderPanel />}

      {!state.toolMode && (
        <>
          {selectedOverlay ? (
            <OverlayPanel overlay={selectedOverlay} />
          ) : state.textRunTarget ? (
            <TextRunPanel />
          ) : (
            <>
              <h6 style={{ marginBottom: 2, color: 'var(--color-neutral-600)' }}>Adicionar à página {state.activePageIndex + 1}</h6>

              <Button block style={panelBtn} onClick={actions.addText}>
                <Type size={19} strokeWidth={2.75} color="var(--color-accent)" />
                Adicionar texto
              </Button>

              <Button block style={panelBtn} onClick={actions.addImage} disabled={!!state.busy}>
                <ImageIcon size={19} strokeWidth={2.75} color="var(--color-accent-2-700)" />
                Adicionar imagem
              </Button>

              <Button block style={panelBtn} onClick={actions.addShape}>
                <Square size={19} strokeWidth={2.75} />
                Adicionar forma
              </Button>

              <div className="panel-divider" />

              <Button
                block
                style={{ ...panelBtn, background: cropping ? 'var(--color-accent-100)' : undefined }}
                onClick={() => actions.setCropDraft(cropping ? null : { x: 0, y: 0, width: 0, height: 0 })}
              >
                <Crop size={19} strokeWidth={2.75} />
                {cropping ? 'Cancelar recorte' : 'Recortar página'}
              </Button>

              <Button block style={panelBtn} onClick={actions.rotateActivePage}>
                <RotateCw size={19} strokeWidth={2.75} />
                Girar página 90°
              </Button>

              <Button
                block
                style={{ ...panelBtn, color: 'var(--color-accent-2-700)' }}
                disabled={state.doc.pages.length <= 1}
                onClick={() => actions.deletePage(state.activePageIndex)}
              >
                <Trash2 size={19} strokeWidth={2.75} />
                Excluir página
              </Button>

              {state.doc.kind === 'pdf' && (
                <div className="panel-note panel-note-quiet">
                  Clique em um trecho de texto na página para substituí-lo.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

const panelBtn = { justifyContent: 'flex-start' as const, gap: 12, padding: '15px 18px', fontSize: 14 };
