import { useEffect, useRef } from 'react';
import { ArrowUpRight, Contrast, EyeOff, FlipHorizontal2, FlipVertical2, Image as ImageIcon, PenLine, Pipette, RotateCw, Square, Trash2, Type } from 'lucide-react';
import { imageEditsOf } from '../pdf/model';
import { Button } from '../components/Button';
import { useApp } from '../state/AppContext';
import { isImagePage } from '../pdf/model';
import { OverlayPanel } from './panels/OverlayPanel';
import { TextRunPanel } from './panels/TextRunPanel';
import { CompressPanel, MergePanel, ReorderPanel, WatermarkPanel } from './panels/ToolPanels';
import { SplitPanel } from './panels/SplitPanel';
import { AdjustPanel, CropPanel, DrawPanel, ResizePanel } from './panels/ImagePanels';
import { t } from '../i18n/translations';
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
      {state.toolMode === 'crop' && <CropPanel />}
      {state.toolMode === 'adjust' && <AdjustPanel />}
      {state.toolMode === 'resize' && <ResizePanel />}
      {state.toolMode === 'draw' && <DrawPanel />}

      {!state.toolMode && (
        <>
          {selectedOverlay ? (
            isMovingSelected ? (
              <>
                <h6 className="panel-title">{t('panel.movingTextTitle')}</h6>
                <div className="panel-note">{t('panel.movingTextNote')}</div>
                <Button variant="primary" block onClick={() => actions.setMovingOverlay(null)}>
                  {t('panel.ok')}
                </Button>
              </>
            ) : (
              <OverlayPanel overlay={selectedOverlay} />
            )
          ) : state.textRunTarget ? (
            <TextRunPanel />
          ) : (
            <>
              <h6 className="panel-title">{t('panel.addToPage', { n: state.activePageIndex + 1 })}</h6>

              <div className="panel-group">
                <Button style={{ ...panelBtn, marginTop: 0 }} onClick={actions.addText}>
                  <Type size={19} strokeWidth={2.75} color="var(--color-accent)" />
                  {t('panel.addText')}
                </Button>
                <button
                  ref={pickerTriggerRef}
                  className="panel-group-subaction"
                  onClick={() => actions.setFontPickerActive(!state.fontPickerActive)}
                >
                  <Pipette size={14} strokeWidth={2.5} />
                  {state.fontPickerActive
                    ? t('panel.captureFontActive')
                    : state.capturedFontKey
                      ? t('panel.captureFontCaptured')
                      : t('panel.captureFontIdle')}
                </button>
              </div>

              <Button block style={panelBtn} onClick={actions.addImage} disabled={!!state.busy}>
                <ImageIcon size={19} strokeWidth={2.75} color="var(--color-accent-2-700)" />
                {t('panel.addImage')}
              </Button>

              <Button block style={panelBtn} onClick={actions.addShape}>
                <Square size={19} strokeWidth={2.75} />
                {t('panel.addShape')}
              </Button>

              <Button block style={panelBtn} onClick={actions.addLine}>
                <ArrowUpRight size={19} strokeWidth={2.75} />
                {t('panel.addArrow')}
              </Button>

              <Button block style={panelBtn} onClick={() => actions.setTool('draw')}>
                <PenLine size={19} strokeWidth={2.75} />
                {t('panel.draw')}
              </Button>

              {isImagePage(state.doc, page) && (
                <Button block style={panelBtn} onClick={actions.addRedaction}>
                  <EyeOff size={19} strokeWidth={2.75} />
                  {t('panel.redact')}
                </Button>
              )}

              {isImagePage(state.doc, page) && (
                <>
                  <div className="panel-label">{t('panel.invert')}</div>
                  <div className="tile-row">
                    <button type="button" className="tile-btn" title={t('panel.invertHTitle')} onClick={() => actions.flipPhoto('h')}>
                      <FlipHorizontal2 size={18} strokeWidth={2.5} />
                      <span>{t('panel.invertH')}</span>
                    </button>
                    <button type="button" className="tile-btn" title={t('panel.invertVTitle')} onClick={() => actions.flipPhoto('v')}>
                      <FlipVertical2 size={18} strokeWidth={2.5} />
                      <span>{t('panel.invertV')}</span>
                    </button>
                    <button
                      type="button"
                      className="tile-btn"
                      title={t('panel.invertColorsTitle')}
                      aria-pressed={imageEditsOf(page).invert}
                      onClick={actions.toggleInvertColors}
                    >
                      <Contrast size={18} strokeWidth={2.5} />
                      <span>{t('panel.invertColors')}</span>
                    </button>
                  </div>
                </>
              )}

              <div className="panel-divider" />

              <Button block style={panelBtn} onClick={actions.rotateActivePage}>
                <RotateCw size={19} strokeWidth={2.75} />
                {t('panel.rotatePage')}
              </Button>

              <Button
                block
                style={{ ...panelBtn, color: 'var(--color-accent-2-700)' }}
                disabled={state.doc.pages.length <= 1}
                onClick={() => actions.deletePage(state.activePageIndex)}
              >
                <Trash2 size={19} strokeWidth={2.75} />
                {t('panel.deletePage')}
              </Button>

              {state.doc.kind === 'pdf' && (
                <div className="panel-note panel-note-quiet">
                  {t('panel.clickToReplace')}
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
