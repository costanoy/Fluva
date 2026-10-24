import { unzlibSync, zlibSync } from 'fflate';
import {
  decodePDFRawStream,
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { canvasToBlob } from './render';

/**
 * Compression that keeps the document a document: the photos and pictures
 * inside a PDF are re-encoded (as JPEG) and, when they hold more pixels than
 * the page shows them at, scaled down — everything else (text, vector
 * drawings, fonts, links, forms) stays as it is, the text selectable.
 *
 * How big each picture is shown is read from the pages' own content streams
 * (the transformation in force at each `Do` that paints it), so a photo
 * shown as a thumbnail is scaled to the thumbnail, not to the page.
 */

export interface ImageSettings {
  /** Pixels per inch a picture keeps, at the size it's shown. */
  dpi: number;
  /** JPEG quality, 0..1. */
  quality: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `ctm`, the way PDF composes `cm` with the current matrix. */
function multiply(m: Matrix, ctm: Matrix): Matrix {
  return [
    m[0] * ctm[0] + m[1] * ctm[2],
    m[0] * ctm[1] + m[1] * ctm[3],
    m[2] * ctm[0] + m[3] * ctm[2],
    m[2] * ctm[1] + m[3] * ctm[3],
    m[4] * ctm[0] + m[5] * ctm[2] + ctm[4],
    m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
  ];
}

const isWhite = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelimiter = (c: number) => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;

/**
 * The operators of a content stream with their numeric and name operands —
 * just enough of the syntax to follow `q`, `Q`, `cm` and `Do`: strings,
 * arrays and dictionaries are stepped over, inline images skipped whole.
 */
function* operators(bytes: Uint8Array): Generator<{ op: string; operands: Array<number | string> }> {
  const n = bytes.length;
  let operands: Array<number | string> = [];
  let i = 0;
  const word = (from: number) => {
    let j = from;
    while (j < n && !isWhite(bytes[j]) && !isDelimiter(bytes[j])) j++;
    return j;
  };
  const text = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  while (i < n) {
    const c = bytes[i];
    if (isWhite(c)) {
      i++;
    } else if (c === 0x25) {
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
    } else if (c === 0x2f) {
      const j = word(i + 1);
      operands.push(text(i + 1, j));
      i = j;
    } else if (c === 0x28) {
      let depth = 1;
      i++;
      while (i < n && depth) {
        if (bytes[i] === 0x5c) i++;
        else if (bytes[i] === 0x28) depth++;
        else if (bytes[i] === 0x29) depth--;
        i++;
      }
      operands.push('');
    } else if (c === 0x3c && bytes[i + 1] !== 0x3c) {
      while (i < n && bytes[i] !== 0x3e) i++;
      i++;
      operands.push('');
    } else if (c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      i += c === 0x3c || c === 0x3e ? 2 : 1;
    } else if ((c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2b || c === 0x2e) {
      const j = word(i);
      operands.push(Number(text(i, j)));
      i = j;
    } else {
      const j = word(i);
      const op = text(i, Math.max(j, i + 1));
      i = Math.max(j, i + 1);
      if (op === 'BI') {
        // An inline image: its data runs from after "ID" to the "EI" that
        // stands on its own.
        let k = i;
        while (k < n && !(bytes[k] === 0x49 && bytes[k + 1] === 0x44 && isWhite(bytes[k - 1]) && isWhite(bytes[k + 2]))) k++;
        k += 3;
        while (k < n && !(bytes[k] === 0x45 && bytes[k + 1] === 0x49 && isWhite(bytes[k - 1]) && (k + 2 >= n || isWhite(bytes[k + 2])))) k++;
        i = k + 2;
        operands = [];
        continue;
      }
      yield { op, operands };
      operands = [];
    }
  }
}

/** A content stream's operators, decoded — or nothing when it can't be. */
function contentBytes(stream: PDFObject | undefined): Uint8Array | null {
  try {
    if (stream instanceof PDFContentStream) return stream.getUnencodedContents();
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  } catch {
    /* an encoding pdf-lib can't read: its pictures keep the page-size limit */
  }
  return null;
}

/**
 * How big each picture is shown, in points (its widest use): every page's
 * content followed through `q`/`Q`/`cm` into each `Do`, forms included.
 */
function shownSizes(pdf: PDFDocument): Map<string, { width: number; height: number }> {
  const { context } = pdf;
  const sizes = new Map<string, { width: number; height: number }>();
  const visit = (streams: Uint8Array[], resources: PDFDict | undefined, start: Matrix, depth: number, path: Set<string>) => {
    const xobjects = resources?.lookup(PDFName.of('XObject'));
    const named = xobjects instanceof PDFDict ? xobjects : undefined;
    let ctm = start;
    const stack: Matrix[] = [];
    for (const bytes of streams) {
      for (const { op, operands } of operators(bytes)) {
        if (op === 'q') stack.push(ctm);
        else if (op === 'Q') ctm = stack.pop() ?? start;
        else if (op === 'cm' && operands.length >= 6) {
          const m = operands.slice(-6);
          if (m.every((v) => typeof v === 'number')) ctm = multiply(m as Matrix, ctm);
        } else if (op === 'Do' && named && typeof operands[operands.length - 1] === 'string') {
          const ref = named.get(PDFName.of(operands[operands.length - 1] as string));
          if (!(ref instanceof PDFRef)) continue;
          const xobject = context.lookup(ref);
          if (!(xobject instanceof PDFRawStream)) continue;
          const subtype = xobject.dict.lookup(PDFName.of('Subtype'));
          if (subtype === PDFName.of('Image')) {
            // The unit square, where the image is drawn, mapped to the page.
            const width = Math.hypot(ctm[0], ctm[1]);
            const height = Math.hypot(ctm[2], ctm[3]);
            const seen = sizes.get(ref.tag);
            sizes.set(ref.tag, { width: Math.max(width, seen?.width ?? 0), height: Math.max(height, seen?.height ?? 0) });
          } else if (subtype === PDFName.of('Form') && depth < 12 && !path.has(ref.tag)) {
            const matrix = xobject.dict.lookup(PDFName.of('Matrix'));
            const m = matrix instanceof PDFArray && matrix.size() === 6 ? (matrix.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) as Matrix) : IDENTITY;
            const own = xobject.dict.lookup(PDFName.of('Resources'));
            const bytesOf = contentBytes(xobject);
            if (bytesOf) visit([bytesOf], own instanceof PDFDict ? own : resources, multiply(m, ctm), depth + 1, new Set([...path, ref.tag]));
          }
        }
      }
    }
  };
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const list = contents instanceof PDFArray ? contents.asArray().map((item) => context.lookup(item)) : [contents];
    const streams = list.map((s) => contentBytes(s as PDFObject)).filter((b): b is Uint8Array => !!b);
    visit(streams, page.node.Resources(), IDENTITY, 0, new Set());
  }
  return sizes;
}

/** The components a color space has, when it's one a JPEG can carry: gray or RGB. */
function components(pdf: PDFDocument, space: PDFObject | undefined): 1 | 3 | null {
  const value = space instanceof PDFRef ? pdf.context.lookup(space) : space;
  if (value === PDFName.of('DeviceRGB') || value === PDFName.of('CalRGB')) return 3;
  if (value === PDFName.of('DeviceGray') || value === PDFName.of('CalGray')) return 1;
  if (value instanceof PDFArray) {
    const family = value.lookup(0);
    if (family === PDFName.of('CalRGB')) return 3;
    if (family === PDFName.of('CalGray')) return 1;
    if (family === PDFName.of('ICCBased')) {
      const profile = value.lookup(1);
      const n = profile instanceof PDFRawStream ? profile.dict.lookup(PDFName.of('N')) : undefined;
      if (n instanceof PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3)) return n.asNumber() as 1 | 3;
    }
  }
  return null;
}

/** A stream's filters, as names. */
function filtersOf(stream: PDFRawStream): string[] {
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray) return filter.asArray().map((f) => (f instanceof PDFName ? f.decodeText() : '?'));
  return [];
}

/** Undoes the PNG predictors a Flate image may carry (one filter byte per row). */
function unpredict(data: Uint8Array, columns: number, bpp: number): Uint8Array | null {
  const rowBytes = columns * bpp;
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowBytes + 1)];
    const src = r * (rowBytes + 1) + 1;
    const dst = r * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = data[src + x];
      const left = x >= bpp ? out[dst + x - bpp] : 0;
      const up = r ? out[dst - rowBytes + x] : 0;
      const upLeft = r && x >= bpp ? out[dst - rowBytes + x - bpp] : 0;
      let v: number;
      if (type === 0) v = raw;
      else if (type === 1) v = raw + left;
      else if (type === 2) v = raw + up;
      else if (type === 3) v = raw + ((left + up) >> 1);
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else return null;
      out[dst + x] = v & 0xff;
    }
  }
  return out;
}

/** The 8-bit samples of a Flate (or unfiltered) image, predictors undone. */
function samples(stream: PDFRawStream, width: number, height: number, comps: number): Uint8Array | null {
  const filters = filtersOf(stream);
  let data: Uint8Array;
  try {
    if (!filters.length) data = stream.contents;
    else if (filters.length === 1 && filters[0] === 'FlateDecode') data = unzlibSync(stream.contents);
    else return null;
  } catch {
    return null;
  }
  const params = stream.dict.lookup(PDFName.of('DecodeParms'));
  const predictor = params instanceof PDFDict ? params.lookup(PDFName.of('Predictor')) : undefined;
  const p = predictor instanceof PDFNumber ? predictor.asNumber() : 1;
  if (p >= 10) {
    const out = unpredict(data, width, comps);
    if (!out) return null;
    data = out;
  } else if (p !== 1) return null;
  return data.length >= width * height * comps ? data : null;
}

/** A canvas with the picture at `width` × `height`: drawn from its samples
 * (gray or RGB) or decoded (JPEG). */
async function draw(source: ImageBitmap | ImageData, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const bitmap = source instanceof ImageData ? await createImageBitmap(source) : source;
  try {
    ctx.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }
  return canvas;
}

function toImageData(data: Uint8Array, width: number, height: number, comps: 1 | 3): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += comps) {
    const o = i * 4;
    if (comps === 1) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = data[j];
    } else {
      rgba[o] = data[j];
      rgba[o + 1] = data[j + 1];
      rgba[o + 2] = data[j + 2];
    }
    rgba[o + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

const num = (dict: PDFDict, key: string) => {
  const v = dict.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : 0;
};

/** Pictures bigger than this many pixels are left as they are (memory). */
const MAX_PIXELS = 40_000_000;

/**
 * Re-encodes the pictures in `pdf` (in place) at `settings`. A picture is
 * only replaced when that makes it at least a tenth smaller; masks, CMYK,
 * palette and other pictures a JPEG can't stand in for are left alone.
 * Returns how many were replaced.
 */
export async function recompressImages(pdf: PDFDocument, settings: ImageSettings, onProgress?: (done: number, total: number) => void): Promise<number> {
  const { context } = pdf;
  const shown = shownSizes(pdf);
  // A picture whose use can't be read (in a pattern, say) is held to the biggest page.
  const pageSide = Math.max(...pdf.getPages().map((p) => Math.max(p.getWidth(), p.getHeight())), 1);
  const candidates: Array<[PDFRef, PDFRawStream]> = [];
  const masks = new Set<string>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    candidates.push([ref, object]);
    for (const key of ['SMask', 'Mask']) {
      const mask = object.dict.get(PDFName.of(key));
      if (mask instanceof PDFRef) masks.add(mask.tag);
    }
  }
  const images = candidates.filter(([ref]) => !masks.has(ref.tag));
  let replaced = 0;
  for (let index = 0; index < images.length; index++) {
    const [ref, image] = images[index];
    onProgress?.(index, images.length);
    try {
      if (await recompressOne(pdf, ref, image, shown.get(ref.tag), pageSide, settings)) replaced++;
    } catch (err) {
      console.warn('[Fluva] left a picture as it was', err);
    }
  }
  onProgress?.(images.length, images.length);
  return replaced;
}

async function recompressOne(
  pdf: PDFDocument,
  ref: PDFRef,
  image: PDFRawStream,
  use: { width: number; height: number } | undefined,
  pageSide: number,
  settings: ImageSettings,
): Promise<boolean> {
  const { context } = pdf;
  const dict = image.dict;
  const width = num(dict, 'Width');
  const height = num(dict, 'Height');
  if (!width || !height || width * height > MAX_PIXELS) return false;
  if (dict.lookup(PDFName.of('ImageMask')) || dict.lookup(PDFName.of('Decode')) || num(dict, 'BitsPerComponent') !== 8) return false;
  // A color-key mask names exact colors, which JPEG wouldn't keep.
  if (dict.lookup(PDFName.of('Mask')) instanceof PDFArray) return false;
  const comps = components(pdf, dict.get(PDFName.of('ColorSpace')));
  if (!comps) return false;
  const filters = filtersOf(image);
  const isJpeg = filters.length === 1 && filters[0] === 'DCTDecode';

  // The pixels it needs: what it's shown at, at the chosen resolution.
  const targetW = use ? (use.width / 72) * settings.dpi : (pageSide / 72) * settings.dpi;
  const targetH = use ? (use.height / 72) * settings.dpi : (pageSide / 72) * settings.dpi;
  let scale = use ? Math.min(1, Math.max(targetW / width, targetH / height)) : Math.min(1, Math.max(targetW, targetH) / Math.max(width, height));
  if (scale > 0.9) scale = 1;
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  // Its soft mask (see-through edges) goes down with it, kept lossless.
  const smaskRef = dict.get(PDFName.of('SMask'));
  let smask: { ref: PDFRef; stream: PDFRawStream } | null = null;
  if (scale < 1 && smaskRef instanceof PDFRef) {
    const stream = context.lookup(smaskRef);
    if (stream instanceof PDFRawStream) smask = { ref: smaskRef, stream };
  }
  if (smaskRef && scale < 1 && !smask) return false;

  let source: ImageBitmap | ImageData;
  if (isJpeg) {
    source = await createImageBitmap(new Blob([image.contents as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
  } else {
    const data = samples(image, width, height, comps);
    if (!data) return false;
    source = toImageData(data, width, height, comps);
  }
  const canvas = await draw(source, outW, outH);
  let jpeg: Uint8Array;
  try {
    jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', settings.quality)).arrayBuffer());
  } finally {
    canvas.width = canvas.height = 0;
  }
  if (jpeg.length > image.contents.length * 0.9) return false;

  let newMask: Uint8Array | null = null;
  if (smask) {
    const mw = num(smask.stream.dict, 'Width');
    const mh = num(smask.stream.dict, 'Height');
    if (num(smask.stream.dict, 'BitsPerComponent') !== 8 || !mw || !mh) return false;
    const data = samples(smask.stream, mw, mh, 1);
    if (!data) return false;
    const maskCanvas = await draw(toImageData(data, mw, mh, 1), outW, outH);
    try {
      const pixels = maskCanvas.getContext('2d')!.getImageData(0, 0, outW, outH).data;
      const gray = new Uint8Array(outW * outH);
      for (let i = 0; i < gray.length; i++) gray[i] = pixels[i * 4];
      newMask = zlibSync(gray, { level: 9 });
    } finally {
      maskCanvas.width = maskCanvas.height = 0;
    }
  }

  // The same picture, as a JPEG: RGB (a gray one comes out of the canvas in
  // color), keeping its ICC profile when it's an RGB one.
  const next = dict.clone(context);
  for (const key of ['Filter', 'DecodeParms', 'Length']) next.delete(PDFName.of(key));
  next.set(PDFName.of('Width'), PDFNumber.of(outW));
  next.set(PDFName.of('Height'), PDFNumber.of(outH));
  next.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  next.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  if (comps === 1) next.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  context.assign(ref, PDFRawStream.of(next, jpeg));
  if (smask && newMask) {
    const maskDict = smask.stream.dict.clone(context);
    for (const key of ['Filter', 'DecodeParms', 'Length']) maskDict.delete(PDFName.of(key));
    maskDict.set(PDFName.of('Width'), PDFNumber.of(outW));
    maskDict.set(PDFName.of('Height'), PDFNumber.of(outH));
    maskDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    context.assign(smask.ref, PDFRawStream.of(maskDict, newMask));
  }
  return true;
}

/** Streams nothing compresses yet (content written plainly, say), deflated.
 * Pictures and the document's XML metadata are left as they are. */
export function deflatePlainStreams(pdf: PDFDocument): void {
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || filtersOf(object).length || object.contents.length < 512) continue;
    const type = object.dict.lookup(PDFName.of('Type'));
    if (object.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image') || type === PDFName.of('Metadata')) continue;
    const packed = zlibSync(object.contents, { level: 9 });
    if (packed.length >= object.contents.length) continue;
    const dict = object.dict.clone(pdf.context);
    dict.delete(PDFName.of('Length'));
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    pdf.context.assign(ref, PDFRawStream.of(dict, packed));
  }
}

