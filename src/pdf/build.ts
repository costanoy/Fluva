import { degrees, PDFDocument, rgb, type PDFPage, type PDFImage } from 'pdf-lib';
import type { DocumentState, ImageAsset, Overlay, WatermarkConfig, WorkPage } from './model';
import { createFontSet, sanitizeForStandardFont } from './fonts';
import { displayRectToRaw, displayToRaw, hexToRgb, normalizeRotation, type Quarter } from './geometry';

/**
 * A text overlay's `y` is the top of its first line. Dropping this fraction of the
 * font size lands on the baseline pdf-lib draws from, and matches where a browser
 * puts the baseline inside a 1.2 line-height box, so preview and output line up.
 */
export const TEXT_BASELINE_RATIO = 0.85;

/** Line spacing used for multi-line text overlays, in both preview and output. */
export const TEXT_LINE_HEIGHT = 1.2;

/**
 * Assembles the real output PDF from the source files plus the recorded edits.
 * This is the single place where edits become bytes; the editor never mutates
 * the originals.
 */
export async function buildPdf(doc: DocumentState): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const fonts = createFontSet(out);

  // Cache per source so each file is parsed once, and per asset so a repeated
  // image is embedded once.
  const sourceDocs = new Map<string, PDFDocument>();
  const embeddedImages = new Map<string, PDFImage>();

  const loadSource = async (sourceId: string): Promise<PDFDocument | null> => {
    const cached = sourceDocs.get(sourceId);
    if (cached) return cached;
    const source = doc.sources[sourceId];
    if (!source || source.kind !== 'pdf') return null;
    const loaded = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
    sourceDocs.set(sourceId, loaded);
    return loaded;
  };

  const embedAsset = async (assetId: string): Promise<PDFImage | null> => {
    const cached = embeddedImages.get(assetId);
    if (cached) return cached;
    const asset = doc.assets[assetId];
    if (!asset) return null;
    const img = asset.mime === 'image/png'
      ? await out.embedPng(asset.bytes)
      : await out.embedJpg(asset.bytes);
    embeddedImages.set(assetId, img);
    return img;
  };

  for (const page of doc.pages) {
    const source = page.sourceId ? doc.sources[page.sourceId] : undefined;
    let outPage: PDFPage;
    /** The source page's own /Rotate, which overlay coordinates are relative to. */
    let sourceRotation: Quarter = 0;
    let rawW: number;
    let rawH: number;

    if (source && source.kind === 'pdf') {
      const srcDoc = await loadSource(source.id);
      if (!srcDoc) continue;
      const [copied] = await out.copyPages(srcDoc, [page.sourceIndex]);
      outPage = out.addPage(copied);
      sourceRotation = normalizeRotation(source.pageRotations[page.sourceIndex] ?? 0);
      const size = outPage.getSize();
      rawW = size.width;
      rawH = size.height;
    } else if (source && source.kind === 'image') {
      // An image page is a page sized to the image, with the image drawn to fill it.
      rawW = page.width;
      rawH = page.height;
      outPage = out.addPage([rawW, rawH]);
      const asset = Object.values(doc.assets).find((a) => a.bytes === source.bytes);
      const img = asset
        ? await embedAsset(asset.id)
        : source.mime === 'image/png'
          ? await out.embedPng(source.bytes)
          : await out.embedJpg(source.bytes);
      if (img) outPage.drawImage(img, { x: 0, y: 0, width: rawW, height: rawH });
    } else {
      rawW = page.width;
      rawH = page.height;
      outPage = out.addPage([rawW, rawH]);
    }

    const overlays = withWatermark(doc, page);
    for (const overlay of overlays) {
      await drawOverlay(outPage, overlay, sourceRotation, rawW, rawH, fonts, embedAsset);
    }

    // Crop after drawing: the content stream uses absolute user-space coordinates,
    // so narrowing the box afterwards clips the view without shifting anything.
    if (page.crop) {
      const raw = displayRectToRaw(sourceRotation, rawW, rawH, page.crop);
      const x0 = Math.max(0, raw.x);
      const y0 = Math.max(0, raw.y);
      const x1 = Math.min(rawW, raw.x + raw.width);
      const y1 = Math.min(rawH, raw.y + raw.height);
      if (x1 > x0 && y1 > y0) {
        outPage.setCropBox(x0, y0, x1 - x0, y1 - y0);
        outPage.setMediaBox(x0, y0, x1 - x0, y1 - y0);
      }
    }

    outPage.setRotation(degrees(normalizeRotation(sourceRotation + page.rotation)));
  }

  if (out.getPageCount() === 0) out.addPage();
  return out.save();
}

/** Watermarks are stored once on the document and expanded per page at build time. */
function withWatermark(doc: DocumentState, page: WorkPage): Overlay[] {
  const wm = doc.watermark;
  if (!wm.enabled) return page.overlays;
  const isFirst = doc.pages[0]?.id === page.id;
  if (!wm.allPages && !isFirst) return page.overlays;
  const built = buildWatermarkOverlay(wm, page, doc.assets);
  return built ? [...page.overlays, built] : page.overlays;
}

export function buildWatermarkOverlay(
  wm: WatermarkConfig,
  page: WorkPage,
  assets: Record<string, ImageAsset>,
): Overlay | null {
  const cx = (wm.x / 100) * page.width;
  const cy = (1 - wm.y / 100) * page.height;
  const factor = wm.scale / 100;

  if (wm.source.kind === 'text') {
    if (!wm.source.text.trim()) return null;
    // Scale the watermark relative to the page so it reads the same on any size.
    const size = Math.max(6, (page.width / 8) * factor);
    return {
      id: 'watermark',
      kind: 'text',
      x: cx,
      y: cy,
      text: wm.source.text,
      fontKey: 'sans',
      size,
      bold: true,
      italic: false,
      color: wm.color,
      rotation: wm.rotation,
    };
  }

  const asset = assets[wm.source.assetId];
  if (!asset) return null;
  const targetW = page.width * 0.5 * factor;
  const targetH = targetW * (asset.height / asset.width);
  return {
    id: 'watermark',
    kind: 'image',
    x: cx - targetW / 2,
    y: cy - targetH / 2,
    width: targetW,
    height: targetH,
    assetId: wm.source.assetId,
    rotation: wm.rotation,
  };
}

async function drawOverlay(
  page: PDFPage,
  overlay: Overlay,
  sourceRotation: Quarter,
  rawW: number,
  rawH: number,
  fonts: ReturnType<typeof createFontSet>,
  embedAsset: (id: string) => Promise<PDFImage | null>,
) {
  const isWatermark = overlay.id === 'watermark';
  const opacity = isWatermark ? 0.35 : 1;

  if (overlay.kind === 'text') {
    const font = await fonts.get(overlay.fontKey, overlay.bold, overlay.italic);
    const text = sanitizeForStandardFont(overlay.text);
    if (!text) return;
    const lines = text.split('\n');
    const lineHeight = overlay.size * TEXT_LINE_HEIGHT;
    const { r, g, b } = hexToRgb(overlay.color);

    // Offsets from the anchor must follow the text's own axes, not the page axes:
    // once the text is rotated, "half a line width to the left" no longer means
    // "left on the page". These are those axes in display space.
    const phi = (overlay.rotation * Math.PI) / 180;
    const right = { x: Math.cos(phi), y: Math.sin(phi) };
    const down = { x: Math.sin(phi), y: -Math.cos(phi) };

    lines.forEach((line, i) => {
      const width = font.widthOfTextAtSize(line, overlay.size);
      let dx: number;
      let dy: number;

      if (isWatermark) {
        // The anchor is the block's centre: step back half a line and drop to the
        // baseline, both along the text's axes.
        const half = width / 2;
        const toBaseline = overlay.size * 0.35 + i * lineHeight;
        dx = overlay.x - half * right.x + toBaseline * down.x;
        dy = overlay.y - half * right.y + toBaseline * down.y;
      } else {
        // The anchor is the top-left of the block; drop to each line's baseline.
        const toBaseline = overlay.size * TEXT_BASELINE_RATIO + i * lineHeight;
        dx = overlay.x + toBaseline * down.x;
        dy = overlay.y + toBaseline * down.y;
      }

      const pos = displayToRaw(sourceRotation, rawW, rawH, dx, dy);
      page.drawText(line, {
        x: pos.x,
        y: pos.y,
        size: overlay.size,
        font,
        color: rgb(r, g, b),
        opacity,
        // /Rotate spins the page clockwise at display time, so the drawn angle has
        // to compensate for it to land at the angle the user chose.
        rotate: degrees(overlay.rotation + sourceRotation),
      });
    });
    return;
  }

  // Boxes are anchored at their bottom-left corner, and pdf-lib rotates a box
  // about that same corner. Mapping the corner through `displayToRaw` therefore
  // gives the anchor directly for every /Rotate value — no further adjustment.
  const anchor = displayToRaw(sourceRotation, rawW, rawH, overlay.x, overlay.y);
  // Covers are axis-aligned backdrops and carry no rotation of their own.
  const ownRotation = overlay.kind === 'cover' ? 0 : overlay.rotation;
  const angle = degrees(ownRotation + sourceRotation);

  if (overlay.kind === 'image') {
    const img = await embedAsset(overlay.assetId);
    if (!img) return;
    page.drawImage(img, {
      x: anchor.x,
      y: anchor.y,
      width: overlay.width,
      height: overlay.height,
      opacity,
      rotate: angle,
    });
    return;
  }

  const { r, g, b } = hexToRgb(overlay.color);

  if (overlay.kind === 'shape' && overlay.shape === 'circle') {
    // An ellipse is placed by its centre, so map the centre rather than the corner.
    const centre = displayToRaw(
      sourceRotation,
      rawW,
      rawH,
      overlay.x + overlay.width / 2,
      overlay.y + overlay.height / 2,
    );
    const quarterTurned = (overlay.rotation + sourceRotation) % 180 !== 0;
    return void page.drawEllipse({
      x: centre.x,
      y: centre.y,
      xScale: (quarterTurned ? overlay.height : overlay.width) / 2,
      yScale: (quarterTurned ? overlay.width : overlay.height) / 2,
      color: rgb(r, g, b),
      opacity,
    });
  }

  page.drawRectangle({
    x: anchor.x,
    y: anchor.y,
    width: overlay.width,
    height: overlay.height,
    color: rgb(r, g, b),
    opacity,
    rotate: angle,
  });
}
