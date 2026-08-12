import { useEffect, useRef } from 'react';
import { Image as ImageIcon, Pipette, RotateCw, Square, Trash2, Type } from 'lucide-react';
import { Button } from '../components/Button';
import { useApp } from '../state/AppContext';
import { OverlayPanel } from './panels/OverlayPanel';
import { TextRunPanel } from './panels/TextRunPanel';
import { CompressPanel, MergePanel, ReorderPanel, WatermarkPanel } from './panels/ToolPanels';
import { SplitPanel } from './panels/SplitPanel';
import '../styles/panel.css';

export function RightPanel() {
  const { state, actions } = useApp();
  const page = state.doc.pages[state.activePageIndex];
  const selectedOverlay = page?.overlays.find((o) => o.id === state.selectedOverlayId);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const isMovingSelected = !!selectedOverlay && state.movingOverlayId === selectedOverlay.id;

  // While the font eyedropper is armed, the very next click anywhere on the
  // page — the document, the toolbar, any text at all — captures that
  // element's rendered font instead of doing whatever it would normally do.
  useEffect(() => {
    if (!state.fontPickerActive) return;
    const onClick = (e: MouseEvent) => {
      if (pickerTriggerRef.current && e.target instanceof Node && pickerTriggerRef.current.contains(e.target)) {
        return; // clicking the trigger again just cancels — see the button's own onClick.
      }
      e.preventDefault();
      e.stopPropagation();
      actions.captureFontFromElement(e.target as Element);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.setFontPickerActive(false);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.cursor = prevCursor;
    };
  }, [state.fontPickerActive, actions]);

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
            isMovingSelected ? (
              <>
                <h6 style={{ color: 'var(--color-accent-700)' }}>Movendo texto</h6>
                <div className="panel-note">
                  Clique em qualquer parte do texto na página e arraste para reposicioná-lo. Pressione Enter ou clique
                  em Ok quando terminar.
                </div>
                <Button variant="primary" block onClick={() => actions.setMovingOverlay(null)}>
                  Ok
                </Button>
              </>
            ) : (
              <OverlayPanel overlay={selectedOverlay} />
            )
          ) : state.textRunTarget ? (
            <TextRunPanel />
          ) : (
            <>
              <h6 style={{ marginBottom: 2, color: 'var(--color-neutral-600)' }}>Adicionar à página {state.activePageIndex + 1}</h6>

              <div className="panel-group">
                <Button style={{ ...panelBtn, marginTop: 0 }} onClick={actions.addText}>
                  <Type size={19} strokeWidth={2.75} color="var(--color-accent)" />
                  Adicionar texto
                </Button>
                <button
                  ref={pickerTriggerRef}
                  className="panel-group-subaction"
                  onClick={() => actions.setFontPickerActive(!state.fontPickerActive)}
                >
                  <Pipette size={14} strokeWidth={2.5} />
                  {state.fontPickerActive
                    ? 'Clique em qualquer texto do site (Esc para cancelar)'
                    : state.capturedFontKey
                      ? 'Fonte capturada — clique para capturar outra'
                      : 'Captar fonte de um texto existente'}
                </button>
              </div>

              <Button block style={panelBtn} onClick={actions.addImage} disabled={!!state.busy}>
                <ImageIcon size={19} strokeWidth={2.75} color="var(--color-accent-2-700)" />
                Adicionar imagem
              </Button>

              <Button block style={panelBtn} onClick={actions.addShape}>
                <Square size={19} strokeWidth={2.75} />
                Adicionar forma
              </Button>

              <div className="panel-divider" />

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

const panelBtn = { justifyContent: 'flex-start' as const, gap: 12, padding: '15px 18px', fontSize: 16 };
