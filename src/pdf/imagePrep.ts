import { t } from '../i18n/translations';

/**
 * Prepares an image the user brings in — a page of its own, an image placed on
 * a page, a watermark — before anything else touches it.
 *
 * Phone photos carry EXIF metadata: where they were taken (GPS), the phone that
 * took them, the date and time. pdf-lib embeds a JPEG byte for byte, so all of
 * it rode along into every PDF made from one, ready for anyone the file was
 * sent to. Some also carry whole extra files after the picture itself (the
 * video of a "motion photo", depth maps, previews). Here only the segments
 * that hold such data are dropped — the picture itself is not re-encoded.
 *
 * Phones also usually store a portrait photo's pixels sideways, plus an EXIF
 * flag saying how to turn them. Browsers honour the flag, a PDF has no such
 * thing: the page came out sized upright with the sideways pixels stretched
 * across it. A turned photo is therefore redrawn upright once, here, so every
 * later consumer simply gets plain, upright pixels.
 */

export interface PreparedImage {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

/** The format the bytes really are, whatever the file name or browser said. */
export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function prepareImage(input: Uint8Array, declaredMime: string): Promise<PreparedImage> {
  const sniffed = sniffImageMime(input);
  // WebP, GIF, BMP, AVIF: neither a PDF nor most of this app reads them.
  if (!sniffed && declaredMime !== 'image/png' && declaredMime !== 'image/jpeg') return transcode(input, declaredMime);
  const mime = sniffed ?? (declaredMime === 'image/png' ? 'image/png' : 'image/jpeg');

  if (mime === 'image/png') {
    const bytes = stripPngMetadata(input) ?? input;
    return { bytes, mime, ...(await readImageSize(bytes, mime)) };
  }

  const stripped = stripJpegMetadata(input);
  if (!stripped) return { bytes: input, mime, ...(await readImageSize(input, mime)) };
  if (stripped.orientation > 1 && stripped.orientation <= 8) {
    const upright = await redrawUpright(stripped.bytes, stripped.orientation).catch(() => null);
    if (upright) return upright;
  }
  return { bytes: stripped.bytes, mime, ...(await readImageSize(stripped.bytes, mime)) };
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

/* ------------------------------------------------------------------ JPEG */

/** APPn segments worth keeping: JFIF (APP0), ICC colour profile (APP2 —
 * only that kind), Adobe (APP14, which says how to read CMYK colours). */
function keepJpegSegment(marker: number, data: Uint8Array): boolean {
  if (marker === 0xe0 || marker === 0xee) return true;
  if (marker === 0xe2) return startsWith(data, 'ICC_PROFILE\0');
  // Every other APPn (EXIF, XMP, IPTC, MPF, maker data) and comments go.
  return !((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe);
}

/**
 * Rewrites a JPEG without its metadata segments and without anything after
 * the end of the picture. Returns the EXIF orientation it found (1 if none),
 * or null when the bytes don't parse as a JPEG — they are then left alone.
 */
export function stripJpegMetadata(s: Uint8Array): { bytes: Uint8Array; orientation: number } | null {
  if (s[0] !== 0xff || s[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [s.subarray(0, 2)];
  let orientation = 1;
  let p = 2;

  for (;;) {
    // Markers may be padded with any number of 0xFF fill bytes.
    while (p < s.length && s[p] === 0xff && s[p + 1] === 0xff) p++;
    if (p + 1 >= s.length || s[p] !== 0xff) return null;
    const marker = s[p + 1];
    if (marker === 0xd9) {
      parts.push(s.subarray(p, p + 2));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(s.subarray(p, p + 2));
      p += 2;
      continue;
    }
    if (p + 3 >= s.length) return null;
    const length = (s[p + 2] << 8) | s[p + 3];
    if (length < 2 || p + 2 + length > s.length) return null;
    const end = p + 2 + length;
    const data = s.subarray(p + 4, end);

    if (marker === 0xe1 && startsWith(data, 'Exif\0')) orientation = readExifOrientation(data.subarray(6)) ?? orientation;
    if (keepJpegSegment(marker, data)) parts.push(s.subarray(p, end));
    p = end;

    if (marker === 0xda) {
      // Entropy-coded data follows the scan header; inside it 0xFF is only
      // ever followed by a stuffed 0x00 or a restart marker. Anything else is
      // the next real marker (another scan of a progressive JPEG, or the end).
      const scanStart = p;
      while (p + 1 < s.length && !(s[p] === 0xff && s[p + 1] !== 0x00 && !(s[p + 1] >= 0xd0 && s[p + 1] <= 0xd7))) p++;
      if (p + 1 >= s.length) return null;
      parts.push(s.subarray(scanStart, p));
    }
  }

  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { bytes: out, orientation };
}

/** The Orientation tag (0x0112) of IFD0, from a TIFF structure. */
function readExifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const u16 = (o: number) => (little ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1]);
  const u32 = (o: number) => (little ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

/** Draws sideways-stored pixels the way the EXIF orientation says to show them. */
async function redrawUpright(bytes: Uint8Array, orientation: number): Promise<PreparedImage> {
  // `bytes` carries no EXIF any more, so every browser decodes the raw,
  // unturned pixels — the turn below is the only one applied.
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }));
  try {
    const turned = orientation >= 5;
    // Some browsers (iOS Safari) silently draw nothing on a canvas past
    // ~16.7 megapixels; a bigger photo is scaled to fit rather than lost.
    const shrink = Math.min(1, Math.sqrt(16_000_000 / (bitmap.width * bitmap.height)));
    const w = Math.max(1, Math.round(bitmap.width * shrink));
    const h = Math.max(1, Math.round(bitmap.height * shrink));
    const canvas = document.createElement('canvas');
    canvas.width = turned ? h : w;
    canvas.height = turned ? w : h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // The standard EXIF orientation transforms (see the TIFF/EXIF spec).
    const transforms: Record<number, [number, number, number, number, number, number]> = {
      2: [-1, 0, 0, 1, w, 0],
      3: [-1, 0, 0, -1, w, h],
      4: [1, 0, 0, -1, 0, h],
      5: [0, 1, 1, 0, 0, 0],
      6: [0, 1, -1, 0, h, 0],
      7: [0, -1, -1, 0, h, w],
      8: [0, -1, 1, 0, 0, w],
    };
    ctx.setTransform(...transforms[orientation]);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('encode failed');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: turned ? h : w, height: turned ? w : h };
  } finally {
    bitmap.close();
  }
}

/* ------------------------------------------------------- other formats */

/** Whether a WebP is the lossless kind (a screenshot, a logo): its pixels
 * are exact, and turning them into a JPEG would smudge them. */
function losslessWebp(s: Uint8Array): boolean {
  if (!(startsWith(s, 'RIFF') && s[8] === 0x57 && s[9] === 0x45 && s[10] === 0x42 && s[11] === 0x50)) return false;
  for (let p = 12; p + 8 <= s.length; ) {
    const tag = String.fromCharCode(s[p], s[p + 1], s[p + 2], s[p + 3]);
    if (tag === 'VP8L') return true;
    if (tag === 'VP8 ') return false;
    const size = s[p + 4] | (s[p + 5] << 8) | (s[p + 6] << 16) | (s[p + 7] << 24);
    p += 8 + size + (size & 1);
  }
  return false;
}

/**
 * An image in a format the browser reads but a PDF can't hold (WebP, GIF,
 * BMP, AVIF), read by the browser — upright, its metadata left behind — and
 * written as a PNG when its pixels must stay exact (see-through parts, a GIF
 * or BMP, a lossless WebP) or else as a JPEG.
 */
async function transcode(input: Uint8Array, mime: string): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([input.slice().buffer as ArrayBuffer], { type: mime }));
  } catch {
    throw new Error(t('loader.imageReadError'));
  }
  try {
    // Same ceiling as a turned photo (see redrawUpright).
    const shrink = Math.min(1, Math.sqrt(16_000_000 / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * shrink));
    const height = Math.max(1, Math.round(bitmap.height * shrink));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error(t('loader.imageReadError'));
    ctx.drawImage(bitmap, 0, 0, width, height);
    let exact = mime === 'image/gif' || mime === 'image/bmp' || losslessWebp(input);
    if (!exact) {
      const data = ctx.getImageData(0, 0, width, height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) {
          exact = true;
          break;
        }
      }
    }
    const out: 'image/png' | 'image/jpeg' = exact ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, out, out === 'image/jpeg' ? 0.92 : undefined));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error(t('loader.imageReadError'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: out, width, height };
  } finally {
    bitmap.close();
  }
}

/* ------------------------------------------------------------------- PNG */

/** Chunks that hold metadata rather than picture: EXIF, text (author,
 * software, comments, sometimes GPS), timestamps. */
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** Rewrites a PNG without its metadata chunks, or returns null when there is
 * nothing to drop (or the bytes don't parse — they are then left alone). */
export function stripPngMetadata(s: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [s.subarray(0, 8)];
  let dropped = false;
  let p = 8;
  while (p + 12 <= s.length) {
    const length = ((s[p] << 24) | (s[p + 1] << 16) | (s[p + 2] << 8) | s[p + 3]) >>> 0;
    const end = p + 12 + length;
    if (end > s.length) return null;
    const type = String.fromCharCode(s[p + 4], s[p + 5], s[p + 6], s[p + 7]);
    if (PNG_METADATA_CHUNKS.has(type)) dropped = true;
    else parts.push(s.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  if (!dropped) return null;
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function startsWith(data: Uint8Array, text: string): boolean {
  if (data.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (data[i] !== text.charCodeAt(i)) return false;
  return true;
}
