import { openWithPdfJs, type OpenedPdf, type PDFDocumentProxy } from './pdfjs';
import type { SourceDoc, WorkPage } from './model';

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
 */
export async function renderPageRaw(
  source: SourceDoc | undefined,
  page: WorkPage,
  scale: number,
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
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/**
 * Renders the pages of a finished PDF (one already carrying baked-in overlays)
 * to canvases. Used by compression and by image export, both of which must see
 * exactly what the exported document contains.
 *
 * Uses the print intent deliberately. It is the right appearance for a flattened
 * artifact, and it also makes pdf.js drive its render loop with microtasks instead
 * of requestAnimationFrame — so an export keeps running when the tab is in the
 * background, where rAF is throttled to a standstill.
 */
export async function rasterizePdf(
  bytes: Uint8Array,
  scale: number,
  onPage?: (index: number, total: number) => void,
): Promise<HTMLCanvasElement[]> {
  const opened = await openWithPdfJs(bytes);
  const pdf = opened.doc;
  const canvases: HTMLCanvasElement[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      page.cleanup();
      canvases.push(canvas);
      onPage?.(i, pdf.numPages);
    }
  } finally {
    await opened.destroy();
  }
  return canvases;
}

export async function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem.'))),
      mime,
      quality,
    );
  });
}
