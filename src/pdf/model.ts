import { t } from '../i18n/translations';

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
  /** A photo with nothing see-through in it (known from its format, not by
   * reading pixels back — which Safari's anti-fingerprinting blurs). */
  opaque?: boolean;
  /** The password a PDF needed to open, as typed — held in memory while the
   * document is open, for the PDF reader to open it again; never stored. */
  password?: string;
  /** The file as opened, when `bytes` is a PNG or JPEG written from it (a
   * WebP, GIF, BMP or AVIF): what "before" and "as it came" mean. */
  original?: { bytes: Uint8Array; mime: string };
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
  /** pdf.js's internal key for the original PDF text run's own embedded font
   * (see `TextItem.originalFontKey`), set only when this overlay should draw
   * with that original font instead of `fontKey`'s substitute — resolved
   * against the overlay's own page at build time (see `build.ts`), with a
   * silent fallback to `fontKey` if extraction or embedding fails for any
   * reason (missing glyphs, an unparseable font program, etc). */
  originalFontKey?: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  rotation: number;
  /** Set on the text that replaces one of the PDF's own runs: that run's
   * cover, and how this overlay looked when only the text had changed.
   * While it still looks exactly like that, the export writes the new text
   * back into the original run itself — same font program, size, color and
   * spacing as the rest of the line (see textRemoval.ts). Moved, restyled or
   * turned, it's drawn as an overlay instead. */
  replaces?: ReplacedRun;
}

export interface ReplacedRun {
  coverId: string;
  x: number;
  y: number;
  fontKey: string;
  originalFontKey?: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
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
  /** 0..1; fully opaque when unset. */
  opacity?: number;
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
  /** Just its outline, `strokeWidth` points thick and inside the box, instead of a solid fill. */
  outline?: boolean;
  strokeWidth?: number;
  /** 0..1; fully opaque when unset. */
  opacity?: number;
}

/** A straight line from (x, y) to (x + dx, y + dy), with an arrowhead at
 * either end or both. */
export interface LineOverlay {
  id: string;
  kind: 'line';
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
  strokeWidth: number;
  arrowStart: boolean;
  arrowEnd: boolean;
  dashed: boolean;
}

/** A freehand stroke. `points` are x, y pairs from 0 to 1 across the stroke's
 * box (y up), so resizing the box reshapes the stroke without thickening it. */
export interface DrawOverlay {
  id: string;
  kind: 'draw';
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[];
  color: string;
  strokeWidth: number;
  /** Translucent and multiplied into what's under it, like a real highlighter. */
  highlighter: boolean;
}

/** An area of a photo page blurred or pixelated in the photo's own pixels:
 * what was there doesn't survive in the exported file (see imageEdit.ts). */
export interface RedactOverlay {
  id: string;
  kind: 'redact';
  x: number;
  y: number;
  width: number;
  height: number;
  effect: 'blur' | 'pixelate';
  shape: 'rect' | 'ellipse';
  /** 1..100 */
  strength: number;
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

export type Overlay = TextOverlay | ImageOverlay | ShapeOverlay | CoverOverlay | LineOverlay | DrawOverlay | RedactOverlay;

/** Light and colour adjustments for a photo page, each 0 when untouched:
 * -100..100, except sharpness, blur and vignette (0..100). */
export interface ImageAdjust {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  vibrance: number;
  warmth: number;
  tint: number;
  sharpness: number;
  blur: number;
  vignette: number;
}

export type ImageFilterId = 'none' | 'bw' | 'noir' | 'sepia' | 'vintage' | 'vivid' | 'warm' | 'cool' | 'dramatic' | 'fade';

/** What the user did to a photo page's own pixels (see imageEdit.ts) —
 * not anything drawn on top of it. */
export interface ImageEdits {
  flipH: boolean;
  flipV: boolean;
  /** A fine turn, -45..45 degrees clockwise, zoomed in just enough that no
   * blank corner shows. */
  straighten: number;
  filter: ImageFilterId;
  /** 0..100 */
  filterStrength: number;
  adjust: ImageAdjust;
  /** In negative: every colour of the finished photo turned into its
   * opposite — over a filter, not instead of one. */
  invert: boolean;
  /** Output pixels per point — per pixel of the original photo: 1 keeps its
   * own size. Applies to the image exports and to the PDF page alike. */
  scale: number;
}

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
  /** Edits to the page's own photo, for a page made from an image. */
  image?: ImageEdits;
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
  /** Which page gets the watermark when `allPages` is false. */
  singlePageIndex: number;
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

/** Whether the document's watermark is drawn on `page`. */
export function watermarkOn(doc: DocumentState, page: WorkPage): boolean {
  const wm = doc.watermark;
  return wm.enabled && (wm.allPages || (doc.pages[wm.singlePageIndex] ?? doc.pages[0])?.id === page.id);
}

/** Whether a page is a photo the user opened (its pixels can be edited), not a PDF page. */
export function isImagePage(doc: DocumentState, page: WorkPage | undefined): boolean {
  return !!page?.sourceId && doc.sources[page.sourceId]?.kind === 'image';
}

export const NO_ADJUST: ImageAdjust = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  vibrance: 0,
  warmth: 0,
  tint: 0,
  sharpness: 0,
  blur: 0,
  vignette: 0,
};

export function defaultImageEdits(): ImageEdits {
  return { flipH: false, flipV: false, straighten: 0, filter: 'none', filterStrength: 100, adjust: { ...NO_ADJUST }, invert: false, scale: 1 };
}

export function imageEditsOf(page: WorkPage): ImageEdits {
  return page.image ?? defaultImageEdits();
}

export function defaultWatermark(): WatermarkConfig {
  return {
    enabled: false,
    source: { kind: 'text', text: t('wm.defaultText') },
    x: 50,
    y: 50,
    scale: 100,
    rotation: -28,
    opacity: 0.35,
    allPages: true,
    singlePageIndex: 0,
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
