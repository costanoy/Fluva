import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../state/AppContext';
import { PageView } from './PageView';
import { displaySize } from '../pdf/model';
import type { AppState, SplitRangeItem } from '../state/appTypes';
import { t } from '../i18n/translations';
import '../styles/split-preview.css';

const THUMB_MAX = 150;

const GROUP_COLORS = ['#1D9E75', '#D85A30', '#534AB7', '#C9A227', '#2A7DB0', '#B0467E', '#5E8C3A', '#8C5E3A'];

interface PageGroup {
  color: string;
  label: string;
}

/** Works out, purely from the current split configuration, which output group
 * each page (by 0-based index) belongs to — this is what the grid below
 * paints, live, as the user changes options in the side panel. */
function computeGroups(state: AppState, total: number): (PageGroup | null)[] {
  const groups: (PageGroup | null)[] = new Array(total).fill(null);

  if (state.splitMode === 'range') {
    if (state.splitRangeSubMode === 'auto') {
      const n = Math.max(1, Math.min(total, state.splitAutoParts));
      const base = Math.floor(total / n);
      const extra = total % n;
      let cursor = 0;
      for (let i = 0; i < n; i++) {
        const count = base + (i < extra ? 1 : 0);
        const color = GROUP_COLORS[i % GROUP_COLORS.length];
        for (let p = cursor; p < cursor + count; p++) groups[p] = { color, label: t('split.file', { n: i + 1 }) };
        cursor += count;
      }
    } else {
      state.splitCustomRanges.forEach((range: SplitRangeItem, i: number) => {
        const from = Math.max(1, Math.min(total, Math.min(range.start, range.end)));
        const to = Math.max(1, Math.min(total, Math.max(range.start, range.end)));
        const color = GROUP_COLORS[i % GROUP_COLORS.length];
        for (let p = from - 1; p < to; p++) {
          if (!groups[p]) groups[p] = { color, label: t('split.interval', { n: i + 1 }) };
        }
      });
    }
  } else {
    if (state.splitPagesSubMode === 'all') {
      for (let p = 0; p < total; p++) groups[p] = { color: 'var(--color-neutral-500)', label: t('split.ownFileLabel') };
    } else {
      const color = GROUP_COLORS[0];
      const label = state.splitMergeSelected ? t('split.mergedLabel') : t('split.ownFileLabel');
      for (const pageNumber of state.splitSelectedPages) {
        groups[pageNumber - 1] = { color, label };
      }
    }
  }

  return groups;
}

function describeOutcome(state: AppState, total: number): string {
  if (state.splitMode === 'range') {
    if (state.splitRangeSubMode === 'auto') {
      const n = Math.max(1, Math.min(total, state.splitAutoParts));
      const base = Math.floor(total / n);
      const extra = total % n;
      const sizes = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0)).filter((c) => c > 0);
      return t('split.outcomeAuto', { total, parts: sizes.length, sizes: sizes.join('+') });
    }
    if (!state.splitCustomRanges.length) return t('split.outcomeCustomEmpty');
    return t('split.outcomeCustom', { count: state.splitCustomRanges.length });
  }
  if (state.splitPagesSubMode === 'all') {
    return t('split.outcomeAll', { total });
  }
  const count = state.splitSelectedPages.length;
  if (!count) return t('split.outcomeSelectEmpty');
  return state.splitMergeSelected
    ? t('split.outcomeSelectMerge', { count })
    : t('split.outcomeSelectSeparate', { count });
}

export function SplitPreview() {
  const { state, actions } = useApp();
  const pages = state.doc.pages;
  const total = pages.length;
  const groups = useMemo(() => computeGroups(state, total), [state, total]);
  const selectable = state.splitMode === 'pages' && state.splitPagesSubMode === 'select';

  return (
    <div className="split-preview">
      <div className="split-preview-header">
        <h4>{t('split.previewTitle')}</h4>
        <p>{describeOutcome(state, total)}</p>
      </div>
      <div className="split-preview-grid">
        {pages.map((page, index) => {
          const shown = displaySize(page);
          const scale = THUMB_MAX / Math.max(shown.width, shown.height);
          const group = groups[index];
          const pageNumber = index + 1;
          const selected = state.splitSelectedPages.includes(pageNumber);

          return (
            <button
              key={page.id}
              type="button"
              className={`split-preview-item${selectable ? ' split-preview-item-selectable' : ''}`}
              disabled={!selectable}
              onClick={() => selectable && actions.toggleSplitSelectedPage(pageNumber)}
              style={{
                // Fixed, independent of the label's own text length — a
                // longer group name (e.g. picking up " · mesclada" on
                // selection) would otherwise widen this shrink-to-fit flex
                // item, visibly growing the thumbnail's box the moment a
                // page is selected.
                width: THUMB_MAX + 24,
                borderColor: group ? group.color : 'var(--color-neutral-300)',
                background: group ? `color-mix(in srgb, ${group.color} 12%, #FFFFFF)` : '#FFFFFF',
              }}
            >
              <div className="split-preview-thumb-wrap">
                <PageView page={page} source={page.sourceId ? state.doc.sources[page.sourceId] : undefined} scale={scale} />
                {selectable && selected && (
                  <span className="split-preview-check">
                    <Check size={13} strokeWidth={3.5} color="#fff" />
                  </span>
                )}
              </div>
              <div className="split-preview-label" style={{ color: group ? group.color : 'var(--color-neutral-500)' }}>
                {t('rail.pageLabel', { n: pageNumber })}
                {group ? ` · ${group.label}` : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
