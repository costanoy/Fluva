import type { DocumentState, WatermarkConfig, WorkPage } from '../pdf/model';
import type { CompressLevel } from '../pdf/ops';
import type { ExportFormat } from '../pdf/exporters';
import type { TextItem } from '../pdf/textExtract';

export type Screen = 'empty' | 'editing' | 'beta';
export type ToolMode = 'merge' | 'split' | 'compress' | 'watermark' | 'reorder' | null;

export type SplitMode = 'range' | 'pages';
export type SplitRangeSubMode = 'auto' | 'custom';
export type SplitPagesSubMode = 'all' | 'select';

/** One user-defined page range in the "Escolher intervalo" split flow — each becomes its own PDF. */
export interface SplitRangeItem {
  id: string;
  start: number;
  end: number;
}

/** A file the user has picked but not opened yet. */
export interface QueuedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: 'pdf' | 'image';
}

export interface BusyState {
  label: string;
  done?: number;
  total?: number;
}

/** The in-progress edit for a selected PDF text run, kept separate from the
 * committed document so the canvas can preview it live without touching
 * undo history until the user confirms. */
export interface TextRunDraft {
  text: string;
  fontKey: string;
  size: number;
  bold: boolean;
  italic: boolean;
}

export interface CompressOutcome {
  level: CompressLevel;
  originalSize: number;
  compressedSize: number;
  reductionPct: number;
  strategy: 'raster' | 'rebuild';
  bytes: Uint8Array;
}

/** Undo/redo covers document content only, never transient UI state. */
export interface HistorySnapshot {
  pages: WorkPage[];
  watermark: WatermarkConfig;
  activePageIndex: number;
}

export interface AppState {
  screen: Screen;
  doc: DocumentState;
  /** Source ids that are loaded and available to merge but not currently in `doc.pages`. */
  spareSourceIds: string[];
  queue: QueuedFile[];
  activePageIndex: number;
  toolMode: ToolMode;
  /** Id of the selected overlay, or null. */
  selectedOverlayId: string | null;
  /** Id of the selected original-text run being rewritten, or null. */
  editingTextId: string | null;
  /** Full details of that run, used to seed the replacement editor. */
  textRunTarget: TextItem | null;
  /** Live-editable draft for the run above; drives the on-canvas preview. */
  textRunDraft: TextRunDraft | null;
  /** A shape overlay that was just created and is awaiting explicit placement confirmation. */
  pendingOverlayId: string | null;
  /** A text overlay the user is actively repositioning; while set, the side
   * panel shows only the "Ok" confirmation instead of the full text editor. */
  movingOverlayId: string | null;
  /** Font captured via the "captar fonte" eyedropper, used for the next added text. */
  capturedFontKey: string | null;
  /** True while the font eyedropper is armed, waiting for the user's next click. */
  fontPickerActive: boolean;
  /** User-chosen zoom override for the editor canvas; null means "fit to width". */
  zoom: number | null;
  /** The zoom the canvas actually rendered at, reported back for the toolbar slider. */
  effectiveZoom: number;
  /** True once the open document has been edited since it was opened or last exported. */
  dirty: boolean;
  exportOpen: boolean;
  exportFormat: ExportFormat;
  mergeSelected: string[];
  splitMode: SplitMode;
  splitRangeSubMode: SplitRangeSubMode;
  /** How many contiguous, roughly-equal files "Intervalo automático" divides into. */
  splitAutoParts: number;
  /** User-defined ranges for "Escolher intervalo" — each becomes its own PDF. */
  splitCustomRanges: SplitRangeItem[];
  splitPagesSubMode: SplitPagesSubMode;
  /** 1-based page numbers checked in "Selecionar páginas". */
  splitSelectedPages: number[];
  /** When true, the pages in `splitSelectedPages` become one merged PDF instead of one per page. */
  splitMergeSelected: boolean;
  compressLevel: CompressLevel;
  compressOutcome: CompressOutcome | null;
  reorderFrom: string;
  reorderTo: string;
  busy: BusyState | null;
  toast: string | null;
  error: string | null;
  history: HistorySnapshot[];
  future: HistorySnapshot[];
}

export function snapshot(state: AppState): HistorySnapshot {
  return {
    pages: state.doc.pages,
    watermark: state.doc.watermark,
    activePageIndex: state.activePageIndex,
  };
}

export function applySnapshot(state: AppState, snap: HistorySnapshot): Partial<AppState> {
  return {
    doc: { ...state.doc, pages: snap.pages, watermark: snap.watermark },
    activePageIndex: Math.min(snap.activePageIndex, Math.max(0, snap.pages.length - 1)),
    selectedOverlayId: null,
    editingTextId: null,
    textRunTarget: null,
    textRunDraft: null,
    pendingOverlayId: null,
    movingOverlayId: null,
  };
}

export type { DocumentState, WorkPage, WatermarkConfig, CompressLevel, ExportFormat, TextItem };
