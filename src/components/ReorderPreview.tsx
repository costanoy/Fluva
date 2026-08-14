import { useApp } from '../state/AppContext';
import { PageView } from './PageView';
import { displaySize } from '../pdf/model';
import { usePointerReorder } from '../hooks/usePointerReorder';
import { t } from '../i18n/translations';
import '../styles/split-preview.css';

const THUMB_MAX = 150;

/** The center-canvas view for the "Organizar" tool — drag any thumbnail onto
 * another to move it there, the same gesture as the left-hand rail, just
 * roomier for documents with a lot of pages. */
export function ReorderPreview() {
  const { state, actions } = useApp();
  const { dragIndex, overIndex, itemProps } = usePointerReorder(actions.movePage);
  const pages = state.doc.pages;

  return (
    <div className="split-preview">
      <div className="split-preview-header">
        <h4>{t('reorder.title')}</h4>
        <p>{t('reorder.previewNote')}</p>
      </div>
      <div className="split-preview-grid">
        {pages.map((page, index) => {
          const shown = displaySize(page);
          const scale = THUMB_MAX / Math.max(shown.width, shown.height);
          const isDropTarget = overIndex === index && dragIndex !== null && dragIndex !== index;
          const { style: reorderStyle, ...reorderProps } = itemProps(index);

          return (
            <div
              key={page.id}
              className={`split-preview-item split-preview-item-draggable${isDropTarget ? ' split-preview-item-drop' : ''}`}
              {...reorderProps}
              style={{ ...reorderStyle, opacity: dragIndex === index ? 0.4 : 1 }}
            >
              <div className="split-preview-thumb-wrap">
                <PageView page={page} source={page.sourceId ? state.doc.sources[page.sourceId] : undefined} scale={scale} />
              </div>
              <div className="split-preview-label" style={{ color: 'var(--color-neutral-600)' }}>
                {t('reorder.pageLabel', { n: index + 1 })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
