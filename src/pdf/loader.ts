import { openWithPdfJs } from './pdfjs';
import { newId, type ImageAsset, type SourceDoc, type WorkPage } from './model';
import { t } from '../i18n/translations';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const ACCEPTED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];

export function isAcceptedFile(file: File): boolean {
  if (ACCEPTED_MIME.includes(file.type)) return true;
  return /\.(pdf|png|jpe?g)$/i.test(file.name);
}

export function fileKind(file: File): 'pdf' | 'image' {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  return 'image';
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

export async function readImageSize(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number }> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const bmp = await createImageBitmap(blob);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    // Fallback for browsers that fail createImageBitmap on some JPEGs.
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error(t('loader.imageReadError')));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface LoadedFile {
  source: SourceDoc;
  pages: WorkPage[];
  /** Present only for image sources: the image is also registered as a drawable asset. */
  asset?: ImageAsset;
}

export async function loadFile(file: File): Promise<LoadedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(t('loader.fileTooLarge', { name: file.name, size: formatBytes(file.size) }));
  }
  const bytes = await readFileBytes(file);
  const kind = fileKind(file);
  return kind === 'pdf' ? loadPdfFile(file, bytes) : loadImageFile(file, bytes);
}

async function loadPdfFile(file: File, bytes: Uint8Array): Promise<LoadedFile> {
  let opened;
  try {
    opened = await openWithPdfJs(bytes);
  } catch (e) {
    // Logged so the real cause is visible in DevTools — the message shown to the
    // user is a guess, and a wrong guess is worse than no guess at all.
    console.error(`[Fluva] pdf.js failed to open "${file.name}":`, e);
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(t('loader.pdfOpenError', { name: file.name, detail }));
  }
  const pdf = opened.doc;

  const sourceId = newId('src');
  const pageSizes: Array<{ width: number; height: number }> = [];
  const pageRotations: number[] = [];
  const pages: WorkPage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    // scale 1 viewport already accounts for the page's own /Rotate, which is the
    // geometry the user actually sees and the space overlay coordinates live in.
    const viewport = page.getViewport({ scale: 1 });
    const size = { width: viewport.width, height: viewport.height };
    pageSizes.push(size);
    pageRotations.push(page.rotate ?? 0);
    pages.push({
      id: newId('pg'),
      sourceId,
      sourceIndex: i - 1,
      width: size.width,
      height: size.height,
      rotation: 0,
      crop: null,
      overlays: [],
    });
    page.cleanup();
  }
  await opened.destroy();

  const source: SourceDoc = {
    id: sourceId,
    name: file.name,
    kind: 'pdf',
    bytes,
    mime: 'application/pdf',
    pageCount: pages.length,
    pageSizes,
    pageRotations,
  };

  return { source, pages };
}

async function loadImageFile(file: File, bytes: Uint8Array): Promise<LoadedFile> {
  const mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
  const { width, height } = await readImageSize(bytes, mime);

  const sourceId = newId('src');
  const assetId = newId('asset');

  // Treat image pixels as points so the page matches the image exactly at 1:1.
  const source: SourceDoc = {
    id: sourceId,
    name: file.name,
    kind: 'image',
    bytes,
    mime,
    pageCount: 1,
    pageSizes: [{ width, height }],
    pageRotations: [0],
  };

  const page: WorkPage = {
    id: newId('pg'),
    sourceId,
    sourceIndex: 0,
    width,
    height,
    rotation: 0,
    crop: null,
    overlays: [],
  };

  return {
    source,
    pages: [page],
    asset: { id: assetId, bytes, mime, width, height },
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
