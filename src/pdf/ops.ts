import { PDFDocument } from 'pdf-lib';
import type { DocumentState } from './model';
import { buildPdf } from './build';
import { canvasToBlob, rasterizePdf } from './render';

export interface SplitResult {
  name: string;
  bytes: Uint8Array;
}

/**
 * Splits out a 1-based, inclusive page range. Returns the extracted range and,
 * when pages are left over, the remainder as a second file.
 */
export async function splitByRange(
  doc: DocumentState,
  baseName: string,
  start: number,
  end: number,
): Promise<SplitResult[]> {
  const total = doc.pages.length;
  const from = Math.max(1, Math.min(total, Math.min(start, end)));
  const to = Math.max(1, Math.min(total, Math.max(start, end)));

  const inRange = doc.pages.slice(from - 1, to);
  const rest = [...doc.pages.slice(0, from - 1), ...doc.pages.slice(to)];

  const results: SplitResult[] = [
    { name: `${baseName}_paginas_${from}-${to}.pdf`, bytes: await buildPdf({ ...doc, pages: inRange }) },
  ];
  if (rest.length) {
    results.push({ name: `${baseName}_restante.pdf`, bytes: await buildPdf({ ...doc, pages: rest }) });
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

const COMPRESS_SETTINGS: Record<CompressLevel, { dpi: number; quality: number; label: string }> = {
  low: { dpi: 150, quality: 0.82, label: 'Leve' },
  medium: { dpi: 110, quality: 0.65, label: 'Equilibrada' },
  high: { dpi: 80, quality: 0.5, label: 'Máxima' },
};

export function compressLabel(level: CompressLevel): string {
  return COMPRESS_SETTINGS[level].label;
}

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
