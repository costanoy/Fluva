import { PDFDocument } from 'pdf-lib';
import { isImagePage, watermarkOn, type DocumentState, type WorkPage } from './model';
import { buildPdf } from './build';
import { canEncodeWebp, canvasToBlob, imageExportScale, rasterizePages } from './render';
import { rasterizeDocument } from './rasterize';
import { carriesMetadata } from './imagePrep';
import { t } from '../i18n/translations';

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
      name: `${baseName}${t('file.part', { n: i + 1, from, to })}.pdf`,
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
      name: `${baseName}${t('file.range', { n: i + 1, from, to })}.pdf`,
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
    return [{ name: `${baseName}${t('file.selected')}.pdf`, bytes: await buildPdf({ ...doc, pages: valid.map((n) => doc.pages[n - 1]) }) }];
  }
  const results: SplitResult[] = [];
  for (const n of valid) {
    results.push({ name: `${baseName}${t('file.page', { n })}.pdf`, bytes: await buildPdf({ ...doc, pages: [doc.pages[n - 1]] }) });
  }
  return results;
}

/** One PDF per page. */
export async function splitEveryPage(doc: DocumentState, baseName: string): Promise<SplitResult[]> {
  const results: SplitResult[] = [];
  for (let i = 0; i < doc.pages.length; i++) {
    results.push({
      name: `${baseName}${t('file.page', { n: i + 1 })}.pdf`,
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

/** Encoder quality per level, for a photo compressed back into a photo. */
const IMAGE_COMPRESS_QUALITY: Record<CompressLevel, number> = { low: 0.82, medium: 0.68, high: 0.5 };

export interface ImageCompressResult {
  images: Array<{ name: string; bytes: Uint8Array; mime: string }>;
  originalSize: number;
  compressedSize: number;
  reductionPct: number;
}

/**
 * Compresses a photo document into photos again, at their own size and with
 * every edit: a JPEG of each page — or, when it has see-through parts (a
 * logo), a WebP, which keeps them (a PNG where the browser can't write WebP).
 * Compared against the files the user opened.
 */
export async function compressImages(
  doc: DocumentState,
  baseName: string,
  level: CompressLevel,
  onProgress?: (done: number, total: number) => void,
): Promise<ImageCompressResult> {
  const quality = IMAGE_COMPRESS_QUALITY[level];
  const webp = canEncodeWebp();
  const pad = String(doc.pages.length).length;
  const images: ImageCompressResult['images'] = [];
  await rasterizeDocument(
    doc,
    (i) => imageExportScale(doc, doc.pages[i]),
    async (canvas, i, total) => {
      // A format that can't be see-through (a JPEG) is trusted over its
      // pixels read back, which Safari's anti-fingerprinting noise would make
      // look see-through; one that can be (a PNG with an alpha channel, often
      // fully opaque all the same) is looked at.
      const page = doc.pages[i];
      const source = page?.sourceId ? doc.sources[page.sourceId] : undefined;
      const translucent = source?.kind === 'image' ? (source.opaque ? false : hasTransparency(canvas)) : false;
      // WebP holds at most 16383 pixels a side (see exporters.ts).
      const webpFits = webp && Math.max(canvas.width, canvas.height) <= 16383;
      let [mime, ext] = !translucent ? ['image/jpeg', 'jpg'] : webpFits ? ['image/webp', 'webp'] : ['image/png', 'png'];
      let bytes: Uint8Array = new Uint8Array(await (await canvasToBlob(canvas, mime, mime === 'image/png' ? undefined : quality)).arrayBuffer());
      // Never bigger than what was opened: a photo left as it was, which
      // doesn't get any smaller, is handed back as it came.
      const original = untouchedPhoto(doc, page);
      if (original && original.bytes.byteLength <= bytes.byteLength) {
        bytes = original.bytes;
        mime = original.mime;
        ext = original.mime === 'image/jpeg' ? 'jpg' : original.mime.split('/')[1];
      }
      const suffix = total > 1 ? t('file.page', { n: String(i + 1).padStart(pad, '0') }) : '';
      images.push({ name: `${baseName}${suffix}${t('file.compressed')}.${ext}`, bytes, mime });
      onProgress?.(i + 1, total);
    },
    (i) => isImagePage(doc, doc.pages[i]),
  );
  const sources = new Set(doc.pages.map((p) => p.sourceId).filter((id): id is string => !!id));
  // Measured against the files as opened (a WebP, not the JPEG made from it).
  const originalSize = [...sources].reduce((n, id) => n + ((doc.sources[id]?.original ?? doc.sources[id])?.bytes.byteLength ?? 0), 0);
  const compressedSize = images.reduce((n, image) => n + image.bytes.byteLength, 0);
  return {
    images,
    originalSize,
    compressedSize,
    reductionPct: originalSize ? Math.max(0, Math.round((1 - compressedSize / originalSize) * 100)) : 0,
  };
}

/** The photo a page is, when nothing at all was done to it. */
function untouchedPhoto(doc: DocumentState, page: WorkPage | undefined) {
  if (!page || !isImagePage(doc, page)) return null;
  if (page.overlays.length || page.image || page.crop || page.rotation % 360 || watermarkOn(doc, page)) return null;
  const source = doc.sources[page.sourceId!];
  if (!source) return null;
  // The file as opened only when nothing in it can say where or when it was
  // taken: every other file this app writes leaves that out.
  return source.original && !carriesMetadata(source.original.bytes, source.original.mime) ? source.original : { bytes: source.bytes, mime: source.mime };
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
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
  const out = await PDFDocument.create();
  // Each page is encoded and embedded as soon as it's drawn, so only one canvas is ever alive.
  await rasterizePages(
    baked,
    () => settings.dpi / 72,
    async (canvas, i, total, { width, height }) => {
      const blob = await canvasToBlob(canvas, 'image/jpeg', settings.quality);
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const outPage = out.addPage([width, height]);
      outPage.drawImage(img, { x: 0, y: 0, width, height });
      onProgress?.(i + 1, total);
    },
  );
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
