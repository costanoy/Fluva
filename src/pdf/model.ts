/**
 * The working-document model.
 *
 * Edits are never written back into the source bytes while the user works. The
 * source files stay pristine and every change is recorded as page references plus
 * overlays; the real PDF is assembled only on export (see `build.ts`). That keeps
 * editing non-destructive and undo/redo cheap.
 *
 * All geometry is stored in PDF user space: points (1/72 inch), origin at the
 * bottom-left of the page. Screen coordinates are derived at render time.
 */

export type SourceKind = 'pdf' | 'image';

export interface SourceDoc {
  id: string;
  name: string;
  kind: SourceKind;
  /** Pristine original bytes. Never mutated. */
  bytes: Uint8Array;
  mime: string;
  pageCount: number;
  /** Intrinsic size of each page, in points, before any user rotation. */
  pageSizes: Array<{ width: number; height: number }>;
  /** Rotation baked into the source page itself (/Rotate), in degrees. */
  pageRotations: number[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextOverlay {
  id: string;
  kind: 'text';
  x: number;
  y: number;
  text: string;
  fontKey: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  rotation: number;
}

export interface ImageOverlay {
  id: string;
  kind: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  assetId: string;
  rotation: number;
}

export interface ShapeOverlay {
  id: string;
  kind: 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  shape: 'rect' | 'circle';
  color: string;
  rotation: number;
}

/** An opaque box painted over original page content, used to replace existing text. */
export interface CoverOverlay {
  id: string;
  kind: 'cover';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export type Overlay = TextOverlay | ImageOverlay | ShapeOverlay | CoverOverlay;

export interface WorkPage {
  id: string;
  /** Source document this page comes from; null for a blank page added by the user. */
  sourceId: string | null;
  /** 0-based page index within the source document. */
  sourceIndex: number;
  /** Intrinsic page size in points (already accounting for the source's own /Rotate). */
  width: number;
  height: number;
  /** Extra rotation applied by the user, in degrees (0/90/180/270). */
  rotation: number;
  /** Crop box in points relative to the page, or null for the full page. */
  crop: Rect | null;
  overlays: Overlay[];
}

export interface ImageAsset {
  id: string;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export type WatermarkSource = { kind: 'text'; text: string } | { kind: 'image'; assetId: string };

export interface WatermarkConfig {
  enabled: boolean;
  source: WatermarkSource;
  /** Position as a percentage of page width/height (0-100). */
  x: number;
  y: number;
  /** Size as a percentage (100 = natural size). */
  scale: number;
  rotation: number;
  opacity: number;
  allPages: boolean;
  color: string;
}

export interface DocumentState {
  sources: Record<string, SourceDoc>;
  assets: Record<string, ImageAsset>;
  pages: WorkPage[];
  watermark: WatermarkConfig;
  /** Display name used for exported files. */
  name: string;
  /** Kind of the file the user originally opened, which drives available tools. */
  kind: SourceKind;
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/** Page size after the user's own rotation is applied. */
export function displaySize(page: WorkPage): { width: number; height: number } {
  const base = page.crop
    ? { width: page.crop.width, height: page.crop.height }
    : { width: page.width, height: page.height };
  const quarterTurned = ((page.rotation % 360) + 360) % 360 % 180 !== 0;
  return quarterTurned ? { width: base.height, height: base.width } : base;
}

export function defaultWatermark(): WatermarkConfig {
  return {
    enabled: false,
    source: { kind: 'text', text: 'AMOSTRA' },
    x: 50,
    y: 50,
    scale: 100,
    rotation: -28,
    opacity: 0.35,
    allPages: true,
    color: '#94948C',
  };
}

export function emptyDocument(): DocumentState {
  return {
    sources: {},
    assets: {},
    pages: [],
    watermark: defaultWatermark(),
    name: '',
    kind: 'pdf',
  };
}
