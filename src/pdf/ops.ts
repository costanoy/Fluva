import { PDFDocument } from 'pdf-lib';
import type { DocumentState } from './model';
import { buildPdf } from './build';
import { canvasToBlob, rasterizePdf } from './render';

export interface SplitResult {
  name: string;
  bytes: Uint8Array;
}

export interface PageRange {
  /** 1-based, inclusive. */
  start: number;
  end: number;
}

/** Divides every page into `parts` contiguous, roughly-equal-sized files. */
export async function splitIntoParts(doc: DocumentState, baseName: string, parts: number): Promise<SplitResult[]> {
  const total = doc.pages.length;
  const n = Math.max(1, Math.min(total, Math.round(parts) || 1));
  const base = Math.floor(total / n);
  const extra = total % n; // the first `extra` files get one extra page, so sizes never differ by more than one.

  const results: SplitResult[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const count = base + (i < extra ? 1 : 0);
    if (count === 0) continue;
    const from = cursor + 1;
    const to = cursor + count;
    results.push({
      name: `${baseName}_parte${i + 1}_paginas_${from}-${to}.pdf`,
      bytes: await buildPdf({ ...doc, pages: doc.pages.slice(cursor, cursor + count) }),
    });
    cursor += count;
  }
  return results;
}

/** Each given 1-based inclusive range becomes its own PDF. */
export async function splitByRanges(doc: DocumentState, baseName: string, ranges: PageRange[]): Promise<SplitResult[]> {
  const total = doc.pages.length;
  const results: SplitResult[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const from = Math.max(1, Math.min(total, Math.min(ranges[i].start, ranges[i].end)));
    const to = Math.max(1, Math.min(total, Math.max(ranges[i].start, ranges[i].end)));
    results.push({
      name: `${baseName}_intervalo${i + 1}_paginas_${from}-${to}.pdf`,
      bytes: await buildPdf({ ...doc, pages: doc.pages.slice(from - 1, to) }),
    });
  }
  return results;
}

/**
 * Extracts the given 1-based page numbers — either as one merged PDF (in the
 * order given) when `merge` is true, or as one PDF per page otherwise.
 */
export async function extractSelectedPages(
  doc: DocumentState,
  baseName: string,
  pageNumbers: number[],
  merge: boolean,
): Promise<SplitResult[]> {
  const total = doc.pages.length;
  const valid = pageNumbers.filter((n) => n >= 1 && n <= total);

  if (merge) {
    return [{ name: `${baseName}_selecionadas.pdf`, bytes: await buildPdf({ ...doc, pages: valid.map((n) => doc.pages[n - 1]) }) }];
  }
  const results: SplitResult[] = [];
  for (const n of valid) {
    results.push({ name: `${baseName}_pagina_${n}.pdf`, bytes: await buildPdf({ ...doc, pages: [doc.pages[n - 1]] }) });
  }
  return results;
}

/** One PDF per page. */
export async function splitEveryPage(doc: DocumentState, baseName: string): Promise<SplitResult[]> {
  const results: SplitResult[] = [];
  for (let i = 0; i < doc.pages.length; i++) {
    results.push({
      name: `${baseName}_pagina_${i + 1}.pdf`,
      bytes: await buildPdf({ ...doc, pages: [doc.pages[i]] }),
    });
  }
  return results;
}

export type CompressLevel = 'low' | 'medium' | 'high';

const COMPRESS_SETTINGS: Record<CompressLevel, { dpi: number; quality: number }> = {
  low: { dpi: 150, quality: 0.82 },
  medium: { dpi: 110, quality: 0.65 },
  high: { dpi: 80, quality: 0.5 },
};

export type CompressStrategy = 'raster' | 'rebuild';

export interface CompressResult {
  bytes: Uint8Array;
  originalSize: number;
  compressedSize: number;
  /** 0 when nothing could be gained. */
  reductionPct: number;
  /**
   * Which output won. 'raster' means pages were re-encoded as images;
   * 'rebuild' means rasterising was worse, so the clean rebuild was kept and the
   * text in the file stays selectable.
   */
  strategy: CompressStrategy;
}

/**
 * Real compression.
 *
 * Two strategies are produced and the smaller one wins:
 *
 * - **rebuild** — the document re-saved cleanly. Text stays selectable.
 * - **raster** — every page re-encoded as a JPEG at reduced resolution.
 *
 * Rasterising is a huge win on scanned and image-heavy files, but on a vector or
 * text-only PDF it can multiply the size many times over, so it is only kept when
 * it genuinely produces a smaller file. Nothing is ever returned that is larger
 * than what the user already had.
 */
export async function compressDocument(
  doc: DocumentState,
  level: CompressLevel,
  onProgress?: (done: number, total: number) => void,
): Promise<CompressResult> {
  const settings = COMPRESS_SETTINGS[level];
  const baked = await buildPdf(doc);
  const scale = settings.dpi / 72;
  const canvases = await rasterizePdf(baked, scale, (i, total) => onProgress?.(i, total));

  const out = await PDFDocument.create();
  for (const canvas of canvases) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', settings.quality);
    const jpegBytes = new Uint8Array(await blob.arrayBuffer());
    const img = await out.embedJpg(jpegBytes);
    const pageWidth = canvas.width / scale;
    const pageHeight = canvas.height / scale;
    const outPage = out.addPage([pageWidth, pageHeight]);
    outPage.drawImage(img, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }
  if (out.getPageCount() === 0) out.addPage();
  const rasterBytes = await out.save();

  const rasterWins = rasterBytes.byteLength < baked.byteLength;
  const bytes = rasterWins ? rasterBytes : baked;

  return {
    bytes,
    originalSize: baked.byteLength,
    compressedSize: bytes.byteLength,
    reductionPct: Math.max(0, Math.round((1 - bytes.byteLength / baked.byteLength) * 100)),
    strategy: rasterWins ? 'raster' : 'rebuild',
  };
}
