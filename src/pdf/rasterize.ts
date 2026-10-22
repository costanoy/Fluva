import { isImagePage, watermarkOn, type DocumentState, type WorkPage } from './model';
import { buildPdf } from './build';
import { rasterizePages, renderPhoto } from './render';
import { shownRect } from './imageEdit';
import { MAX_CANVAS_PIXELS } from './geometry';

/** The most pixels a photo is redrawn at for an image export. */
const PHOTO_RASTER_PIXELS = Math.min(MAX_CANVAS_PIXELS, 24_000_000);

/**
 * Every page of `doc` as a picture, one at a time, exactly as the exported
 * PDF shows it — for the image exports (PNG, JPG, WebP), compression of a
 * photo and the start screen's conversions.
 *
 * A photo page isn't sent through the PDF for its own pixels: a 12-megapixel
 * photo, written uncompressed into a PDF only for pdf.js to read it back,
 * was most of a ten-second export. Its photo is redrawn straight from the
 * file with its edits (see imageEdit.ts), and only what's on top of it — text,
 * shapes, arrows, strokes, the watermark — comes from the PDF, drawn on
 * nothing and laid over it. Every other page is the PDF's page as it is.
 *
 * @param transparentFor pages drawn on nothing rather than on white paper.
 */
export async function rasterizeDocument(
  doc: DocumentState,
  scaleFor: (index: number) => number,
  onPage: (canvas: HTMLCanvasElement, index: number, total: number) => Promise<void> | void,
  transparentFor: (index: number) => boolean = () => false,
): Promise<void> {
  // A highlighter is multiplied into the photo under it: pdf.js can only do
  // that with the photo there, so such a page keeps its photo in the PDF.
  const highlighted = (page: WorkPage) => page.overlays.some((o) => o.kind === 'draw' && o.highlighter);
  const underlaid = (page: WorkPage) => isImagePage(doc, page) && !highlighted(page);
  const photo = (i: number) => underlaid(doc.pages[i]);
  // A photo with nothing on top (its blurred areas are in its pixels) has
  // nothing for pdf.js to draw.
  const bare = (i: number) => photo(i) && !watermarkOn(doc, doc.pages[i]) && doc.pages[i].overlays.every((o) => o.kind === 'redact');
  const baked = await buildPdf(doc, undefined, { omitPhotos: underlaid, losslessPhotos: true });
  await rasterizePages(
    baked,
    scaleFor,
    async (canvas, i, total) => {
      if (!photo(i)) return onPage(canvas, i, total);
      const composed = await underlayPhoto(doc, doc.pages[i], canvas, transparentFor(i), bare(i));
      try {
        await onPage(composed, i, total);
      } finally {
        composed.width = composed.height = 0;
      }
    },
    (i) => photo(i) || transparentFor(i),
    bare,
  );
}

/**
 * A photo page's picture: its photo, turned the way the page is and filling
 * it, with `drawn` (what the PDF has on top of it, rendered on nothing,
 * already cropped, turned and sized) laid over it.
 */
async function underlayPhoto(doc: DocumentState, page: WorkPage, drawn: HTMLCanvasElement, transparent: boolean, bare: boolean): Promise<HTMLCanvasElement> {
  const source = doc.sources[page.sourceId!];
  const shown = shownRect(page);
  const width = drawn.width;
  const height = drawn.height;
  const turn = ((page.rotation % 360) + 360) % 360;
  const quarter = turn % 180 !== 0;
  // The photo's size before the page's turn.
  const photoW = quarter ? height : width;
  const photoH = quarter ? width : height;
  const ppp = Math.min(photoW / shown.width, Math.sqrt(PHOTO_RASTER_PIXELS / (shown.width * shown.height)));
  const photo = await renderPhoto(source, page, { ...shown, ppp });

  // Slid in under what's already drawn, on the same canvas — not on a third
  // full-size one: a phone has the memory for only so many.
  const ctx = drawn.getContext('2d')!;
  if (bare) ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(width / 2, height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(photo, -photoW / 2, -photoH / 2, photoW, photoH);
  ctx.restore();
  photo.width = photo.height = 0;
  if (!transparent) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  return drawn;
}
