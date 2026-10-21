import { openWithPdfJs, type OpenedPdf, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs';
import type { DocumentState, Overlay, Rect, SourceDoc, WorkPage } from './model';
import { MAX_CANVAS_PIXELS } from './geometry';
import { applyRedactions, baseKey, changesPixels, paintPhoto, redactionsOf, type Frame } from './imageEdit';
import { t } from '../i18n/translations';

/** pdf.js documents are expensive to open, so keep one live proxy per source. */
const docCache = new Map<string, Promise<OpenedPdf>>();
const bitmapCache = new Map<string, Promise<ImageBitmap>>();

export async function getPdfDoc(source: SourceDoc): Promise<PDFDocumentProxy> {
  let entry = docCache.get(source.id);
  if (!entry) {
    entry = openWithPdfJs(source.bytes);
    docCache.set(source.id, entry);
  }
  return (await entry).doc;
}

function getImageBitmap(source: SourceDoc): Promise<ImageBitmap> {
  let entry = bitmapCache.get(source.id);
  if (!entry) {
    const blob = new Blob([source.bytes.slice().buffer as ArrayBuffer], { type: source.mime });
    entry = createImageBitmap(blob);
    bitmapCache.set(source.id, entry);
  }
  return entry;
}

export function releaseSource(sourceId: string) {
  const opened = docCache.get(sourceId);
  if (opened) {
    opened.then((o) => o.destroy()).catch(() => {});
    docCache.delete(sourceId);
  }
  const bmp = bitmapCache.get(sourceId);
  if (bmp) {
    bmp.then((b) => b.close()).catch(() => {});
    bitmapCache.delete(sourceId);
  }
}

export function releaseAll() {
  for (const id of Array.from(docCache.keys())) releaseSource(id);
  for (const id of Array.from(bitmapCache.keys())) releaseSource(id);
  editedPhotos.clear();
}

/** The most pixels an edited photo is worked on at in the live view, and
 * while a slider is still moving: drawn bigger, it's scaled up — the full
 * render follows once the slider stops (see PageView). */
const VIEW_EDIT_PIXELS = 6_000_000;
const FAST_EDIT_PIXELS = 1_200_000;

/** Photos already toned for the live view, by source, size and edits — a
 * blurred area dragged around redraws only itself, not the whole photo. */
const editedPhotos = new Map<string, HTMLCanvasElement>();
const EDITED_PHOTOS_KEPT = 4;

function editedPhoto(source: SourceDoc, page: WorkPage, bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const key = `${source.id}|${width}x${height}|${baseKey(page)}`;
  const hit = editedPhotos.get(key);
  if (hit) {
    editedPhotos.delete(key);
    editedPhotos.set(key, hit);
    return hit;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paintPhoto(canvas.getContext('2d', { willReadFrequently: true })!, bitmap, page, fullFrame(page, width));
  editedPhotos.set(key, canvas);
  while (editedPhotos.size > EDITED_PHOTOS_KEPT) {
    const oldest = editedPhotos.keys().next().value as string;
    const dropped = editedPhotos.get(oldest);
    if (dropped) dropped.width = dropped.height = 0;
    editedPhotos.delete(oldest);
  }
  return canvas;
}

const fullFrame = (page: WorkPage, width: number): Frame => ({ x: 0, y: 0, width: page.width, height: page.height, ppp: width / page.width });

/**
 * A photo page's own pixels for the exported file: the `frame` of the page,
 * with every edit to the photo applied — its blurred or pixelated areas
 * included, so what was under them is gone from the pixels.
 */
export async function renderPhoto(source: SourceDoc, page: WorkPage, frame: Frame): Promise<HTMLCanvasElement> {
  const bitmap = await getImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width * frame.ppp));
  canvas.height = Math.max(1, Math.round(frame.height * frame.ppp));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  paintPhoto(ctx, bitmap, page, frame);
  applyRedactions(ctx, page, frame);
  return canvas;
}

/** The photo of a page, flipped and turned but not toned, `maxSide` pixels
 * at most — what the filter picker's tiles start from. */
export async function photoTile(source: SourceDoc, page: WorkPage, maxSide: number): Promise<HTMLCanvasElement> {
  const bitmap = await getImageBitmap(source);
  const k = Math.min(1, maxSide / Math.max(page.width, page.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(page.width * k));
  canvas.height = Math.max(1, Math.round(page.height * k));
  paintPhoto(canvas.getContext('2d', { willReadFrequently: true })!, bitmap, page, fullFrame(page, canvas.width), false);
  return canvas;
}

/** Resolution used when turning pages into images. 150 DPI reads cleanly on screen and in print. */
const IMAGE_EXPORT_DPI = 150;

/**
 * Canvas pixels per point for turning a page into an image: a photo's page
 * (one point per pixel, see the loader) comes out at its own resolution, not
 * blown up twice over; a document page at 150 DPI, which reads cleanly on
 * screen and in print.
 */
export function imageExportScale(doc: DocumentState, page: WorkPage | undefined): number {
  const source = page?.sourceId ? doc.sources[page.sourceId] : undefined;
  if (source?.kind === 'image' || (!source && doc.kind === 'image')) return 1;
  return IMAGE_EXPORT_DPI / 72;
}

let webpEncoding: boolean | null = null;

/** Whether this browser can write WebP images (Safari, for one, can only read them). */
export function canEncodeWebp(): boolean {
  if (webpEncoding === null) {
    try {
      const probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      webpEncoding = probe.toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      webpEncoding = false;
    }
  }
  return webpEncoding;
}

/**
 * Renders the page's original content at full size, with no crop and no user
 * rotation applied.
 *
 * Those two transforms are deliberately left to CSS on the view layer: overlay
 * coordinates live in this same uncropped, unrotated space, so keeping the canvas
 * here means the page and its overlays never drift apart.
 *
 * @param scale canvas pixels per PDF point.
 * @param fast an edited photo is worked on small, for a slider still moving.
 */
export async function renderPageRaw(
  source: SourceDoc | undefined,
  page: WorkPage,
  scale: number,
  { fast = false }: { fast?: boolean } = {},
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(page.width * scale));
  canvas.height = Math.max(1, Math.round(page.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // A blank page (or a source that failed to load) renders as plain white.
  if (!source) return canvas;

  if (source.kind === 'pdf') {
    const pdf = await getPdfDoc(source);
    const pdfPage = await pdf.getPage(page.sourceIndex + 1);
    const viewport = pdfPage.getViewport({ scale });
    // Pass only `canvas`: pdf.js v6 treats a supplied context as the legacy path
    // and the two together do not settle.
    await pdfPage.render({ canvas, viewport }).promise;
    pdfPage.cleanup();
  } else {
    const bmp = await getImageBitmap(source);
    if (!changesPixels(page)) {
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return canvas;
    }
    // Edited: toned at a size the main thread keeps up with, then the
    // blurred or pixelated areas on a copy, then drawn to fill the canvas.
    const budget = fast ? FAST_EDIT_PIXELS : VIEW_EDIT_PIXELS;
    const k = Math.min(1, Math.sqrt(budget / (canvas.width * canvas.height)));
    const width = Math.max(1, Math.round(canvas.width * k));
    const height = Math.max(1, Math.round(canvas.height * k));
    let shown = editedPhoto(source, page, bmp, width, height);
    if (redactionsOf(page).length) {
      const work = document.createElement('canvas');
      work.width = width;
      work.height = height;
      const workCtx = work.getContext('2d', { willReadFrequently: true })!;
      workCtx.drawImage(shown, 0, 0);
      applyRedactions(workCtx, page, fullFrame(page, width));
      shown = work;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(shown, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/**
 * A page drawn with `edits` (its text replacements, see replacement.ts)
 * already applied the way the export applies them — original text removed,
 * new text written into the runs it replaces — and rendered by pdf.js like
 * the rest of the page. Edited text then looks on screen exactly like its
 * neighbours: the same font program, rasterized the same way, at the same
 * resolution. Same framing as `renderPageRaw` (no crop, no user rotation).
 */
export async function renderEditedPage(doc: DocumentState, page: WorkPage, edits: Overlay[], scale: number): Promise<HTMLCanvasElement> {
  const { buildPdf } = await import('./build');
  const bytes = await buildPdf({
    ...doc,
    pages: [{ ...page, rotation: 0, crop: null, overlays: edits }],
    watermark: { ...doc.watermark, enabled: false },
  });
  const opened = await openWithPdfJs(bytes);
  try {
    const pdfPage = await opened.doc.getPage(1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(page.width * scale));
    canvas.height = Math.max(1, Math.round(page.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvas, viewport: pdfPage.getViewport({ scale }) }).promise;
    pdfPage.cleanup();
    return canvas;
  } finally {
    await opened.destroy();
  }
}

/**
 * Renders the pages of a finished PDF (one already carrying baked-in overlays)
 * one at a time, handing each canvas to `onPage` and freeing it before the
 * next. Used by compression and by image export, both of which must see
 * exactly what the exported document contains. Keeping every page as a canvas
 * at once took ~9 MB per A4 page at 150 DPI — hundreds of megabytes for a long
 * document, enough to crash a phone's browser tab.
 *
 * Uses the print intent deliberately. It is the right appearance for a flattened
 * artifact, and it also makes pdf.js drive its render loop with microtasks instead
 * of requestAnimationFrame — so an export keeps running when the tab is in the
 * background, where rAF is throttled to a standstill.
 *
 * @param scaleFor canvas pixels per PDF point for the page at that index.
 * @param onPage also given the page's displayed size in points.
 * @param transparentFor pages drawn on nothing rather than on white paper — a
 *   photo with see-through parts keeps them in a PNG or WebP.
 * @param emptyFor pages known to have nothing to draw: `onPage` gets a canvas
 *   of the right size that was never drawn into (nor given any memory).
 */
export async function rasterizePages(
  bytes: Uint8Array,
  scaleFor: (index: number) => number,
  onPage: (canvas: HTMLCanvasElement, index: number, total: number, size: { width: number; height: number }) => Promise<void> | void,
  transparentFor: (index: number) => boolean = () => false,
  emptyFor: (index: number) => boolean = () => false,
): Promise<void> {
  const opened = await openWithPdfJs(bytes);
  const pdf = opened.doc;
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const canvas = await renderToCanvas(page, scaleFor(i - 1), transparentFor(i - 1), !emptyFor(i - 1));
      // The page's displayed size in points — the scale may have been capped.
      const { width, height } = page.getViewport({ scale: 1 });
      page.cleanup();
      try {
        await onPage(canvas, i - 1, pdf.numPages, { width, height });
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
  } finally {
    await opened.destroy();
  }
}

/** Renders one pdf.js page on white (or on nothing), its scale capped to
 * what a canvas can hold. */
async function renderToCanvas(page: PDFPageProxy, wantedScale: number, transparent = false, draw = true): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(wantedScale, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  if (!draw) return canvas;
  // Asked for first, with its default see-through backdrop: pdf.js would
  // otherwise make the context opaque itself.
  const ctx = canvas.getContext('2d')!;
  if (!transparent) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvas, viewport, intent: 'print', background: transparent ? 'rgba(0,0,0,0)' : undefined }).promise;
  return canvas;
}

/**
 * A source page as a JPEG picture of itself, with `covers` (displayed space,
 * bottom-left origin) painted into the pixels. For a PDF pdf-lib can't copy
 * from (see `buildPdf`): replaced text must not survive under its cover.
 */
export async function renderPageImage(source: SourceDoc, index: number, dpi: number, covers: Array<Rect & { color: string }>): Promise<Uint8Array> {
  const page = await (await getPdfDoc(source)).getPage(index + 1);
  try {
    const canvas = await renderToCanvas(page, dpi / 72);
    const height = page.getViewport({ scale: 1 }).height;
    const k = canvas.height / height;
    const ctx = canvas.getContext('2d')!;
    for (const c of covers) {
      ctx.fillStyle = c.color;
      ctx.fillRect(c.x * k, (height - c.y - c.height) * k, c.width * k, c.height * k);
    }
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    canvas.width = canvas.height = 0;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    page.cleanup();
  }
}

export async function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('render.encodeError')))),
      mime,
      quality,
    );
  });
}
