import { useState } from 'react';
import { Check, FilePlus2, Plus, X } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { PageView } from '../components/PageView';
import { displaySize } from '../pdf/model';
import { Button } from '../components/Button';
import '../styles/thumbnail-rail.css';

const THUMB_MAX = 104;

export function ThumbnailRail() {
  const { state, actions } = useApp();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (state.toolMode === 'merge') return <MergeSourceList />;

  return (
    <div className="thumb-rail">
      {state.doc.pages.map((page, index) => {
        const shown = displaySize(page);
        const scale = THUMB_MAX / Math.max(shown.width, shown.height);
        const isActive = index === state.activePageIndex;
        const isDropTarget = overIndex === index && dragIndex !== null && dragIndex !== index;

        return (
          <div
            className={`thumb-item${isDropTarget ? ' thumb-item-drop' : ''}`}
            key={page.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== index) actions.movePage(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            style={{ opacity: dragIndex === index ? 0.4 : 1 }}
          >
            <div
              className="thumb-frame"
              role="button"
              tabIndex={0}
              aria-label={`Página ${index + 1}`}
              aria-current={isActive}
              style={{ borderColor: isActive ? 'var(--color-accent)' : 'var(--color-neutral-300)' }}
              onClick={() => actions.setActivePage(index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  actions.setActivePage(index);
                }
              }}
            >
              <PageView page={page} source={page.sourceId ? state.doc.sources[page.sourceId] : undefined} scale={scale} />
              {state.doc.pages.length > 1 && (
                <button
                  className="thumb-delete"
                  aria-label={`Excluir página ${index + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.deletePage(index);
                  }}
                >
                  <X size={10} strokeWidth={3} />
                </button>
              )}
            </div>
            <div className="thumb-page-label">pág. {index + 1}</div>
          </div>
        );
      })}

      <button className="thumb-add" onClick={actions.addBlankPage} aria-label="Adicionar página em branco" title="Adicionar página em branco">
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
      <div className="thumb-rail-label">Arquivos para juntar</div>

      {sources.length === 0 && <div className="thumb-rail-empty">Nenhum outro PDF carregado ainda.</div>}

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
              <span className="merge-file-meta">{source.pageCount} pág.</span>
            </span>
          </button>
        );
      })}

      <Button block style={{ marginTop: 10, justifyContent: 'center' }} onClick={actions.addFilesToMerge} disabled={!!state.busy}>
        <FilePlus2 size={15} strokeWidth={2.75} />
        Adicionar PDFs
      </Button>
    </div>
  );
}
