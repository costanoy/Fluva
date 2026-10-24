import { isImagePage, untouchedPdfBytes, watermarkOn, type DocumentState, type WorkPage } from './model';
import { buildPdf } from './build';
import { canEncodeWebp, canvasToBlob, imageExportScale } from './render';
import { deflatePlainStreams, recompressImages, type ImageSettings } from './compressImages';
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

/** How sharp the pictures inside a PDF stay, at the size each is shown. */
const COMPRESS_SETTINGS: Record<CompressLevel, ImageSettings> = {
  low: { dpi: 200, quality: 0.82 },
  medium: { dpi: 150, quality: 0.7 },
  high: { dpi: 100, quality: 0.55 },
};

/**
 * 'images': pictures were re-encoded; 'rebuild': none could gain, the
 * document was just written again, leaner; 'original': nothing came out
 * smaller than the file as opened, which is handed back as it was.
 * Text stays selectable in all three.
 */
export type CompressStrategy = 'images' | 'rebuild' | 'original';

export interface CompressResult {
  bytes: Uint8Array;
  originalSize: number;
  compressedSize: number;
  /** 0 when nothing could be gained. */
  reductionPct: number;
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
 * Real compression that keeps a document a document: the pictures inside are
 * re-encoded, and scaled down to what the page shows them at (see
 * compressImages.ts); text, drawings, fonts, links and forms stay as they
 * are — the text selectable and searchable. Streams written uncompressed are
 * deflated, and the file is saved with its objects packed together.
 *
 * Measured against the files as opened, and never bigger than them: a PDF
 * opened and left as it was that can't be made smaller comes back as it was.
 */
export async function compressDocument(
  doc: DocumentState,
  level: CompressLevel,
  onProgress?: (done: number, total: number) => void,
): Promise<CompressResult> {
  let pictures = 0;
  const bytes = await buildPdf(doc, undefined, {
    beforeSave: async (out) => {
      pictures = await recompressImages(out, COMPRESS_SETTINGS[level], onProgress);
      deflatePlainStreams(out);
    },
  });
  const sources = new Set(doc.pages.map((p) => p.sourceId).filter((id): id is string => !!id));
  const before = [...sources].reduce((n, id) => n + ((doc.sources[id]?.original ?? doc.sources[id])?.bytes.byteLength ?? 0), 0) || bytes.byteLength;
  const original = untouchedPdfBytes(doc);
  if (original && bytes.byteLength >= original.byteLength) {
    return { bytes: original, originalSize: original.byteLength, compressedSize: original.byteLength, reductionPct: 0, strategy: 'original' };
  }
  return {
    bytes,
    originalSize: before,
    compressedSize: bytes.byteLength,
    reductionPct: Math.max(0, Math.round((1 - bytes.byteLength / before) * 100)),
    strategy: pictures ? 'images' : 'rebuild',
  };
}
