import { useRef } from 'react';
import { Check, FilePlus2, Plus, X } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { PageView } from '../components/PageView';
import { displaySize } from '../pdf/model';
import { Button } from '../components/Button';
import { usePointerReorder } from '../hooks/usePointerReorder';
import { t } from '../i18n/translations';
import '../styles/thumbnail-rail.css';

const THUMB_MAX = 104;

export function ThumbnailRail() {
  const { state, actions } = useApp();
  const frameRefs = useRef<Array<HTMLDivElement | null>>([]);
  const { dragIndex, overIndex, itemProps } = usePointerReorder(actions.movePage);

  if (state.toolMode === 'merge') return <MergeSourceList />;

  return (
    <div className="thumb-rail">
      {state.doc.pages.map((page, index) => {
        const shown = displaySize(page);
        const scale = THUMB_MAX / Math.max(shown.width, shown.height);
        const isActive = index === state.activePageIndex;
        const isDropTarget = overIndex === index && dragIndex !== null && dragIndex !== index;
        const { style: reorderStyle, ...reorderProps } = itemProps(index);

        return (
          <div
            className={`thumb-item${isDropTarget ? ' thumb-item-drop' : ''}`}
            key={page.id}
            {...reorderProps}
            style={{ ...reorderStyle, opacity: dragIndex === index ? 0.4 : 1 }}
          >
            <div
              ref={(el) => {
                frameRefs.current[index] = el;
              }}
              className="thumb-frame"
              role="button"
              tabIndex={0}
              aria-label={t('rail.pageAria', { n: index + 1 })}
              aria-current={isActive}
              style={{ borderColor: isActive ? 'var(--color-accent)' : 'var(--color-neutral-300)' }}
              onClick={() => actions.setActivePage(index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  actions.setActivePage(index);
                  return;
                }
                // With a page focused, the arrow keys browse pages one at a time —
                // "up" to the previous page, "down" to the next — moving focus
                // along so repeated presses keep walking the list.
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  const next = e.key === 'ArrowUp' ? index - 1 : index + 1;
                  if (next < 0 || next >= state.doc.pages.length) return;
                  actions.setActivePage(next);
                  frameRefs.current[next]?.focus();
                }
              }}
            >
              <PageView page={page} source={page.sourceId ? state.doc.sources[page.sourceId] : undefined} scale={scale} />
              {state.doc.pages.length > 1 && (
                <button
                  className="thumb-delete"
                  aria-label={t('rail.deletePageAria', { n: index + 1 })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.deletePage(index);
                  }}
                >
                  <X size={10} strokeWidth={3} />
                </button>
              )}
            </div>
            <div className="thumb-page-label">{t('rail.pageLabel', { n: index + 1 })}</div>
          </div>
        );
      })}

      <button className="thumb-add" onClick={actions.addBlankPage} aria-label={t('rail.addBlankPage')} title={t('rail.addBlankPage')}>
        <Plus size={18} strokeWidth={2.75} />
      </button>
    </div>
  );
}

/** In merge mode the rail lists the PDFs available to append. */
function MergeSourceList() {
  const { state, actions } = useApp();
  const sources = state.spareSourceIds.map((id) => state.doc.sources[id]).filter(Boolean);

  return (
    <div className="thumb-rail thumb-rail-merge">
      <div className="thumb-rail-label">{t('rail.mergeFilesLabel')}</div>

      {sources.length === 0 && <div className="thumb-rail-empty">{t('rail.noOtherPdf')}</div>}

      {sources.map((source) => {
        const checked = state.mergeSelected.includes(source.id);
        return (
          <button
            key={source.id}
            className="merge-file-row"
            style={{ background: checked ? 'var(--color-accent-100)' : 'transparent' }}
            onClick={() => actions.toggleMergeSource(source.id)}
          >
            <span
              className="merge-checkbox"
              style={{ borderColor: checked ? 'var(--color-accent)' : 'var(--color-neutral-400)', background: checked ? 'var(--color-accent)' : 'transparent' }}
            >
              {checked && <Check size={10} strokeWidth={3.5} color="#fff" />}
            </span>
            <span className="merge-file-text">
              <span className="merge-file-name">{source.name}</span>
              <span className="merge-file-meta">{t('merge.pages', { count: source.pageCount })}</span>
            </span>
          </button>
        );
      })}

      <Button block style={{ marginTop: 10, justifyContent: 'center' }} onClick={actions.addFilesToMerge} disabled={!!state.busy}>
        <FilePlus2 size={15} strokeWidth={2.75} />
        {t('rail.addPdfs')}
      </Button>
    </div>
  );
}
