import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFObjectCopier,
  PDFPage,
  PDFPageLeaf,
  PDFRef,
  PDFStream,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFObject,
} from 'pdf-lib';
import type { CoverOverlay, DocumentState, ImageAsset, Overlay, WatermarkConfig, WorkPage } from './model';
import { createFontSet, fontSupportsText } from './fonts';
import { resolveOriginalFontBytes } from './textExtract';
import { getPdfDoc, renderPageImage } from './render';
import { removeCoveredText, type RemovalResult } from './textRemoval';
import { inPlaceCover, runFontCover } from './replacement';
import { displayRectToRaw, displayToRaw, hexToRgb, normalizeRotation, TEXT_BASELINE_RATIO, TEXT_LINE_HEIGHT, type Quarter } from './geometry';

/** What `buildPdf` could not fully honor, for the caller to tell the user. */
export interface BuildReport {
  /** Some replaced text could not be deleted from the content stream (an
   * unusual font encoding, text inside a form XObject...) and is still
   * findable in the file under its cover. */
  replacedTextKept?: boolean;
  /** Pages of a PDF protected by its author (encrypted) went in as images:
   * they look the same, but their text can't be selected or searched. */
  protectedAsImages?: boolean;
}

/** Parsed sources, kept while their bytes are: the editor's page previews
 * build one page at a time, and re-parsing a long PDF for each was most of
 * what one took. A source is only ever read here, never changed. */
const parsedSources = new WeakMap<Uint8Array, Promise<PDFDocument>>();

/** Resolution a protected PDF's pages are redrawn at (see `buildPdf`). */
const PROTECTED_PAGE_DPI = 200;

/**
 * Assembles the real output PDF from the source files plus the recorded edits.
 * This is the single place where edits become bytes; the editor never mutates
 * the originals.
 */
export async function buildPdf(doc: DocumentState, report?: BuildReport): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const fonts = createFontSet(out);

  // Cache per source so each file is parsed once, and per asset so a repeated
  // image is embedded once.
  const sourceDocs = new Map<string, PDFDocument>();
  // One copier per source: what a document shares between its pages — an
  // embedded font, a logo, a form field shown on several pages, a link from
  // one page to another — is copied once and stays shared. Copying page by
  // page made a full copy of all that for every page (a 480 KB file came out
  // at 5.7 MB) and dragged in hidden copies of every page linked to.
  const copiers = new Map<string, { srcDoc: PDFDocument; copier: PDFObjectCopier }>();
  const placedOnce = new Set<string>();
  const copyPage = (sourceId: string, srcDoc: PDFDocument, index: number): PDFPage => {
    let entry = copiers.get(sourceId);
    if (!entry) {
      entry = { srcDoc, copier: PDFObjectCopier.for(srcDoc.context, out.context) };
      copiers.set(sourceId, entry);
    }
    // The same page used twice gets a copy of its own — the shared copier
    // would hand back the very page already placed.
    const key = `${sourceId}:${index}`;
    const copier = placedOnce.has(key) ? PDFObjectCopier.for(srcDoc.context, out.context) : entry.copier;
    placedOnce.add(key);
    // Copied by reference: whatever points at this page (a link, a form
    // widget) then lands on this very copy instead of making another.
    const ref = copier.copy(srcDoc.getPage(index).ref) as PDFRef;
    return out.addPage(PDFPage.of(out.context.lookup(ref) as PDFPageLeaf, ref, out));
  };
  const embeddedImages = new Map<string, PDFImage>();
  // Cache per (page, pdf.js font key) so several runs sharing one original
  // font resource don't each re-parse that page's operator list.
  const originalFontBytes = new Map<string, Promise<Uint8Array | null>>();
  const resolveFontBytes = (workPage: WorkPage, pdfFontKey: string): Promise<Uint8Array | null> => {
    const key = `${workPage.sourceId}:${workPage.sourceIndex}:${pdfFontKey}`;
    let entry = originalFontBytes.get(key);
    if (!entry) {
      entry = resolveOriginalFontBytes(doc, workPage, pdfFontKey);
      originalFontBytes.set(key, entry);
    }
    return entry;
  };

  const loadSource = async (sourceId: string): Promise<PDFDocument | null> => {
    const cached = sourceDocs.get(sourceId);
    if (cached) return cached;
    const source = doc.sources[sourceId];
    if (!source || source.kind !== 'pdf') return null;
    let parsed = parsedSources.get(source.bytes);
    if (!parsed) {
      parsed = PDFDocument.load(source.bytes, { ignoreEncryption: true });
      parsedSources.set(source.bytes, parsed);
    }
    const loaded = await parsed;
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
    /** Where the visible box starts in raw space — overlay coordinates count
     * from there, and a box that doesn't start at 0,0 is common in print
     * files (bleed) and cropped scans. */
    let origin = { x: 0, y: 0 };
    /** Overlays already taken care of in the page's own content (see below). */
    const handled = new Set<string>();

    if (source && source.kind === 'pdf' && (await loadSource(source.id))?.isEncrypted) {
      // pdf-lib can't decrypt a PDF its author protected, so a copied page
      // came out blank. pdf.js can read it, so the page goes in as a picture
      // of itself — with the replaced text painted out of the pixels, not
      // just hidden under a cover. Overlays then sit on it in displayed space.
      rawW = page.width;
      rawH = page.height;
      outPage = out.addPage([rawW, rawH]);
      const covers = page.overlays.filter((o): o is CoverOverlay => o.kind === 'cover');
      const img = await out.embedJpg(await renderPageImage(source, page.sourceIndex, PROTECTED_PAGE_DPI, covers));
      outPage.drawImage(img, { x: 0, y: 0, width: rawW, height: rawH });
      if (report) report.protectedAsImages = true;
    } else if (source && source.kind === 'pdf') {
      const srcDoc = await loadSource(source.id);
      if (!srcDoc) continue;
      outPage = copyPage(source.id, srcDoc, page.sourceIndex);
      sourceRotation = normalizeRotation(source.pageRotations[page.sourceIndex] ?? 0);
      // The same box pdf.js displays (CropBox, defaulting to MediaBox), so
      // editor coordinates and output coordinates share one frame.
      const box = visibleBox(outPage);
      rawW = box.width;
      rawH = box.height;
      origin = { x: box.x, y: box.y };

      // Replaced text has to leave the file, not just disappear under its
      // cover — this must run before anything else is drawn on the page. A
      // replacement whose only change is its text is written straight back
      // into the run (same font, size, color, spacing as the rest of the
      // line); a cover whose original text is gone isn't drawn at all, so
      // whatever was behind the text — a highlight, a table rule — stays.
      const covers = page.overlays.filter((o): o is CoverOverlay => o.kind === 'cover');
      if (covers.length) {
        const toUser = (dx: number, dy: number) => {
          const p = displayToRaw(sourceRotation, rawW, rawH, dx, dy);
          return { x: p.x + origin.x, y: p.y + origin.y };
        };
        const inPlace = page.overlays.flatMap((o) => {
          const cover = o.kind === 'text' ? runFontCover(o, covers) : -1;
          if (o.kind !== 'text' || cover < 0) return [];
          const fallback = (text: string) => fonts.segments(o.fontKey, o.bold, o.italic, text);
          if (inPlaceCover(o, covers) >= 0) return [{ cover, text: o.text, overlayId: o.id, fallback }];
          // Moved, resized or broken into lines: drawn in the run's own font
          // where it now sits, line by line.
          const lines = o.text.split('\n').map((line, i) => ({
            text: line.replace(/\r/g, ''),
            ...toUser(o.x, o.y - o.size * (TEXT_BASELINE_RATIO + i * TEXT_LINE_HEIGHT)),
          }));
          return [{ cover, text: o.text, overlayId: o.id, fallback, place: { lines, scale: o.size / (o.replaces?.size || o.size) } }];
        });
        let result: RemovalResult = { clean: new Set(), inserted: new Set() };
        try {
          const pdfPage = await (await getPdfDoc(source)).getPage(page.sourceIndex + 1);
          try {
            result = await removeCoveredText(pdfPage, outPage, out.context, covers, inPlace);
          } finally {
            pdfPage.cleanup();
          }
        } catch (err) {
          console.warn('[Fluva] could not strip replaced text', err);
        }
        covers.forEach((cover, index) => {
          if (result.clean.has(index) || result.inserted.has(index)) handled.add(cover.id);
        });
        for (const entry of inPlace) if (result.inserted.has(entry.cover)) handled.add(entry.overlayId);
        if (result.clean.size < covers.length && report) report.replacedTextKept = true;
      }
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

    const toRaw = (dx: number, dy: number) => {
      const p = displayToRaw(sourceRotation, rawW, rawH, dx, dy);
      return { x: p.x + origin.x, y: p.y + origin.y };
    };

    const overlays = withWatermark(doc, page).filter((overlay) => !handled.has(overlay.id));
    for (const overlay of overlays) {
      await drawOverlay(outPage, overlay, sourceRotation, toRaw, fonts, embedAsset, page, resolveFontBytes);
    }

    // Crop after drawing: the content stream uses absolute user-space coordinates,
    // so narrowing the box afterwards clips the view without shifting anything.
    if (page.crop) {
      const local = displayRectToRaw(sourceRotation, rawW, rawH, page.crop);
      const raw = { ...local, x: local.x + origin.x, y: local.y + origin.y };
      const x0 = Math.max(origin.x, raw.x);
      const y0 = Math.max(origin.y, raw.y);
      const x1 = Math.min(origin.x + rawW, raw.x + raw.width);
      const y1 = Math.min(origin.y + rawH, raw.y + raw.height);
      if (x1 > x0 && y1 > y0) {
        outPage.setCropBox(x0, y0, x1 - x0, y1 - y0);
        outPage.setMediaBox(x0, y0, x1 - x0, y1 - y0);
      }
    }

    outPage.setRotation(degrees(normalizeRotation(sourceRotation + page.rotation)));
  }

  if (out.getPageCount() === 0) out.addPage();

  const placed = new Set(out.getPages().map((p) => p.ref.tag));
  for (const page of out.getPages()) dropLinksOutside(page, placed);
  restoreForms(out, [...copiers.values()]);
  // Pages copied only because something pointed at them, streams a text
  // removal replaced, a field's widgets on pages left out: none of it is
  // reachable from the document any more, all of it would still be written.
  await out.flush();
  dropUnreachable(out);
  return out.save();
}

/** Where a link annotation jumps to inside the document, if anywhere. */
function linkTarget(annot: PDFDict): PDFObject | undefined {
  const dest = annot.lookup(PDFName.of('Dest'));
  if (dest) return dest;
  const action = annot.lookup(PDFName.of('A'));
  if (action instanceof PDFDict && action.get(PDFName.of('S')) === PDFName.of('GoTo')) return action.lookup(PDFName.of('D'));
  return undefined;
}

/** Links to a page that isn't in this file are removed: they lead nowhere,
 * and they would keep a hidden copy of that page inside it. */
function dropLinksOutside(page: PDFPage, placed: Set<string>) {
  const annots = page.node.Annots();
  if (!annots) return;
  const kept: PDFObject[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const entry = annots.get(i);
    const annot = page.doc.context.lookup(entry);
    const target = annot instanceof PDFDict ? linkTarget(annot) : undefined;
    const targetPage = target instanceof PDFArray ? target.get(0) : undefined;
    if (targetPage instanceof PDFRef && !placed.has(targetPage.tag)) continue;
    kept.push(entry);
  }
  if (kept.length !== annots.size()) page.node.set(PDFName.of('Annots'), page.doc.context.obj(kept));
}

/**
 * Fillable fields live in the document's /AcroForm, not on the pages — only
 * their widgets come along with a copied page, so every form came out as
 * flat, dead boxes. This rebuilds it from the widgets actually present:
 * each top-level field once, without the widgets left on pages that aren't
 * in this file. Signature fields are not restored as fields: whatever they
 * signed is not this document any more, and a viewer would only flag them
 * as broken.
 */
function restoreForms(out: PDFDocument, sources: Array<{ srcDoc: PDFDocument; copier: PDFObjectCopier }>) {
  const { context } = out;
  const onPages = new Set<string>();
  const roots: PDFRef[] = [];
  const seen = new Set<string>();
  for (const page of out.getPages()) {
    const annots = page.node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const entry = annots!.get(i);
      if (!(entry instanceof PDFRef)) continue;
      onPages.add(entry.tag);
      const annot = context.lookup(entry);
      if (!(annot instanceof PDFDict) || annot.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue;
      let root = entry;
      let node: PDFDict = annot;
      let type = node.get(PDFName.of('FT'));
      for (let parent = node.get(PDFName.of('Parent')); parent instanceof PDFRef; parent = node.get(PDFName.of('Parent'))) {
        const parentNode = context.lookup(parent);
        if (!(parentNode instanceof PDFDict)) break;
        root = parent;
        node = parentNode;
        type = type ?? node.get(PDFName.of('FT'));
      }
      if (type === PDFName.of('Sig') || !node.get(PDFName.of('T')) || seen.has(root.tag)) continue;
      seen.add(root.tag);
      roots.push(root);
    }
  }
  if (!roots.length) return;

  // A field shown on several pages keeps only the widgets that made it in.
  const prune = (ref: PDFRef): boolean => {
    const field = context.lookup(ref);
    if (!(field instanceof PDFDict)) return false;
    const kids = field.lookup(PDFName.of('Kids'));
    if (!(kids instanceof PDFArray)) return onPages.has(ref.tag) || !field.get(PDFName.of('Subtype'));
    const kept = kids.asArray().filter((kid): kid is PDFRef => kid instanceof PDFRef && prune(kid));
    field.set(PDFName.of('Kids'), context.obj(kept));
    return kept.length > 0;
  };
  const fields = roots.filter(prune);
  if (!fields.length) return;

  const acroForm = context.obj({ Fields: fields });
  for (const { srcDoc, copier } of sources) {
    const source = srcDoc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (!source) continue;
    // Default fonts and appearance settings, from the first form that has them.
    for (const key of ['DR', 'DA', 'Q', 'NeedAppearances']) {
      const value = source.get(PDFName.of(key));
      if (value && !acroForm.has(PDFName.of(key))) acroForm.set(PDFName.of(key), copier.copy(value));
    }
  }
  out.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));
}

/** Removes every object nothing in the document points to any more. */
function dropUnreachable(doc: PDFDocument) {
  const { context } = doc;
  const reachable = new Set<string>();
  const stack: Array<PDFObject | undefined> = [context.trailerInfo.Root, context.trailerInfo.Info];
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (reachable.has(obj.tag)) continue;
      reachable.add(obj.tag);
      stack.push(context.lookup(obj));
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      stack.push(...obj.asArray());
    } else if (obj instanceof PDFStream) {
      for (const [, value] of obj.dict.entries()) stack.push(value);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.tag)) context.delete(ref);
  }
}

/** The box pdf.js displays: the CropBox clipped to the MediaBox, normalized
 * (a PDF may write either corner first). */
function visibleBox(page: PDFPage): { x: number; y: number; width: number; height: number } {
  const norm = (r: { x: number; y: number; width: number; height: number }) => ({
    x0: Math.min(r.x, r.x + r.width),
    y0: Math.min(r.y, r.y + r.height),
    x1: Math.max(r.x, r.x + r.width),
    y1: Math.max(r.y, r.y + r.height),
  });
  const media = norm(page.getMediaBox());
  const crop = norm(page.getCropBox());
  const x0 = Math.max(media.x0, crop.x0);
  const y0 = Math.max(media.y0, crop.y0);
  const x1 = Math.min(media.x1, crop.x1);
  const y1 = Math.min(media.y1, crop.y1);
  if (x1 <= x0 || y1 <= y0) return { x: media.x0, y: media.y0, width: media.x1 - media.x0, height: media.y1 - media.y0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Watermarks are stored once on the document and expanded per page at build time. */
function withWatermark(doc: DocumentState, page: WorkPage): Overlay[] {
  const wm = doc.watermark;
  if (!wm.enabled) return page.overlays;
  // Falls back to the first page if the stored index ever falls outside the
  // current page count (e.g. pages were deleted since it was set).
  const targetPage = doc.pages[wm.singlePageIndex] ?? doc.pages[0];
  const isTarget = targetPage?.id === page.id;
  if (!wm.allPages && !isTarget) return page.overlays;
  const built = buildWatermarkOverlay(wm, page, doc.assets);
  if (!built) return page.overlays;
  // Covers only blank out original PDF text that couldn't be removed, never
  // the watermark — inserting it right after them (matching the preview)
  // lets it show straight through instead of leaving a plain white rectangle
  // over it, while still sitting below the replacement content drawn on top.
  const covers = page.overlays.filter((o) => o.kind === 'cover');
  const rest = page.overlays.filter((o) => o.kind !== 'cover');
  return [...covers, built, ...rest];
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
  // pdf-lib turns an image about its bottom-left corner, the preview about its
  // centre. Placing the corner where the turned centre lands back on (cx, cy)
  // keeps the two in agreement at any angle.
  const theta = (wm.rotation * Math.PI) / 180;
  const halfW = targetW / 2;
  const halfH = targetH / 2;
  return {
    id: 'watermark',
    kind: 'image',
    x: cx - (halfW * Math.cos(theta) - halfH * Math.sin(theta)),
    y: cy - (halfW * Math.sin(theta) + halfH * Math.cos(theta)),
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
  toRaw: (dx: number, dy: number) => { x: number; y: number },
  fonts: ReturnType<typeof createFontSet>,
  embedAsset: (id: string) => Promise<PDFImage | null>,
  workPage: WorkPage,
  resolveFontBytes: (workPage: WorkPage, pdfFontKey: string) => Promise<Uint8Array | null>,
) {
  const isWatermark = overlay.id === 'watermark';
  const opacity = isWatermark ? 0.35 : 1;

  if (overlay.kind === 'text') {
    // The original font, byte-for-byte reused from the source PDF, is tried
    // first when the run asked for it — it's wrapped in its own try/catch
    // (via `fonts.getOriginal`) and re-checked against every character the
    // run actually needs, so any failure (an unparseable program, a glyph
    // outside the subset the original PDF embedded) falls back to the usual
    // substitute silently rather than breaking the export.
    let font: PDFFont | null = null;
    let usingOriginal = false;
    if (overlay.originalFontKey) {
      const bytes = await resolveFontBytes(workPage, overlay.originalFontKey);
      if (bytes && (await fontSupportsText(bytes, overlay.text))) {
        const cacheKey = `${workPage.sourceId}:${workPage.sourceIndex}:${overlay.originalFontKey}`;
        const original = await fonts.getOriginal(cacheKey, bytes);
        if (original) {
          font = original;
          usingOriginal = true;
        }
      }
    }
    const lines = overlay.text.split('\n');
    const lineHeight = overlay.size * TEXT_LINE_HEIGHT;
    const { r, g, b } = hexToRgb(overlay.color);

    // Offsets from the anchor must follow the text's own axes, not the page axes:
    // once the text is rotated, "half a line width to the left" no longer means
    // "left on the page". These are those axes in display space.
    const phi = (overlay.rotation * Math.PI) / 180;
    const right = { x: Math.cos(phi), y: Math.sin(phi) };
    const down = { x: Math.sin(phi), y: -Math.cos(phi) };

    for (const [i, line] of lines.entries()) {
      // The original font, reused as-is from the source PDF, was checked to
      // have every glyph; otherwise the line is split across the family's own
      // font and fallbacks for whatever characters it lacks (see `segments`).
      const pieces = usingOriginal && font
        ? [{ text: line.replace(/\r/g, '').replace(/\t/g, '    '), font }]
        : await fonts.segments(overlay.fontKey, overlay.bold, overlay.italic, line);
      const width = pieces.reduce((sum, piece) => sum + piece.font.widthOfTextAtSize(piece.text, overlay.size), 0);
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

      let advance = 0;
      for (const piece of pieces) {
        const pos = toRaw(dx + advance * right.x, dy + advance * right.y);
        page.drawText(piece.text, {
          x: pos.x,
          y: pos.y,
          size: overlay.size,
          font: piece.font,
          color: rgb(r, g, b),
          opacity,
          // /Rotate spins the page clockwise at display time, so the drawn angle has
          // to compensate for it to land at the angle the user chose.
          rotate: degrees(overlay.rotation + sourceRotation),
        });
        advance += piece.font.widthOfTextAtSize(piece.text, overlay.size);
      }
    }
    return;
  }

  // Boxes are anchored at their bottom-left corner, and pdf-lib rotates a box
  // about that same corner. Mapping the corner through `displayToRaw` therefore
  // gives the anchor directly for every /Rotate value — no further adjustment.
  const anchor = toRaw(overlay.x, overlay.y);
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
    const centre = toRaw(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2);
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
