import type { DocumentState, WatermarkConfig, WorkPage } from '../pdf/model';
import type { CompressLevel } from '../pdf/ops';
import type { ExportFormat } from '../pdf/exporters';
import type { TextItem } from '../pdf/textExtract';

export type Screen = 'empty' | 'editing';
export type ToolMode = 'merge' | 'split' | 'compress' | 'watermark' | 'reorder' | null;

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
  cropDraft: { x: number; y: number; width: number; height: number } | null;
  exportOpen: boolean;
  exportFormat: ExportFormat;
  mergeSelected: string[];
  splitStart: number;
  splitEnd: number;
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
  };
}

export type { DocumentState, WorkPage, WatermarkConfig, CompressLevel, ExportFormat, TextItem };
