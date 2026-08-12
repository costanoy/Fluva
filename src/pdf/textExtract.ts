import type { DocumentState, Rect, WorkPage } from './model';
import { getPdfDoc } from './render';
import { cleanFontName, isBoldName, isItalicName, matchSubstitute } from './fonts';

export interface TextItem {
  id: string;
  /** Text as it appears in the PDF. */
  text: string;
  /** Bounding box in the page's displayed space (points, bottom-left origin). */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  originalFont: string;
  bold: boolean;
  italic: boolean;
  /** Substitute family key we can actually embed when rewriting this text. */
  substituteKey: string;
  /** True when the substitute is metrically identical to the original. */
  exactSubstitute: boolean;
}

/**
 * Reads the real text runs off a page, with their true position, size and font
 * name. This drives both text editing and the DOCX export.
 */
export async function extractPageText(doc: DocumentState, page: WorkPage): Promise<TextItem[]> {
  const source = page.sourceId ? doc.sources[page.sourceId] : undefined;
  if (!source || source.kind !== 'pdf') return [];

  const pdf = await getPdfDoc(source);
  const pdfPage = await pdf.getPage(page.sourceIndex + 1);
  const content = await pdfPage.getTextContent();

  // Text items only carry pdf.js's internal font key ("g_d0_f1"); the real font
  // name lands in commonObjs once the operator list has been built, so build it.
  try {
    await pdfPage.getOperatorList();
  } catch {
    // Without it we fall back to the generic family reported in `styles`.
  }

  const styles = (content as { styles?: Record<string, { fontFamily?: string }> }).styles ?? {};
  const fontNameCache = new Map<string, string>();
  const resolveFontName = (key: string): string => {
    const cached = fontNameCache.get(key);
    if (cached !== undefined) return cached;
    let name = '';
    try {
      if (pdfPage.commonObjs.has(key)) {
        const obj = pdfPage.commonObjs.get(key) as { name?: string };
        if (obj?.name) name = obj.name;
      }
    } catch {
      // Font object not resolvable; fall through to the generic family.
    }
    if (!name) name = styles[key]?.fontFamily ?? key;
    fontNameCache.set(key, name);
    return name;
  };

  const items: TextItem[] = [];
  let index = 0;

  for (const raw of content.items) {
    if (!('str' in raw)) continue;
    const item = raw as { str: string; transform: number[]; width: number; height: number; fontName: string };
    if (!item.str.trim()) continue;

    const [a, b, , , e, f] = item.transform;
    // The transform's scale carries the rendered font size.
    const fontSize = Math.hypot(a, b) || item.height || 10;
    const rawFontName = resolveFontName(item.fontName);
    const originalFont = cleanFontName(rawFontName) || 'Desconhecida';
    const match = matchSubstitute(rawFontName);

    items.push({
      id: `t_${page.id}_${index++}`,
      text: item.str,
      x: e,
      // pdf.js reports the text baseline; shift down so the box wraps the glyphs.
      y: f - fontSize * 0.2,
      width: item.width || fontSize * item.str.length * 0.5,
      height: fontSize * 1.2,
      fontSize,
      originalFont,
      bold: isBoldName(rawFontName),
      italic: isItalicName(rawFontName),
      substituteKey: match.family.key,
      exactSubstitute: match.exact,
    });
  }

  pdfPage.cleanup();
  return items;
}

export interface SampledColors {
  /** The run's own ink color. */
  color: string;
  /** Whatever is rendered behind the run — a highlight, a shaded cell, a plain white page. */
  backgroundColor: string;
}

const SAMPLE_SCALE = 1.5;
/** Quantizing before counting merges the antialiasing smear along glyph edges
 * into the same bucket as the solid color it's blending between. */
const QUANTIZE_STEP = 24;
/** How far apart (in RGB distance) two colors need to be to count as genuinely
 * different, rather than the same color with a little noise. */
const MIN_FOREGROUND_CONTRAST = 60;

function quantizeChannel(v: number): number {
  return Math.round(v / QUANTIZE_STEP) * QUANTIZE_STEP;
}

function toHex(r: number, g: number, b: number): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`.toUpperCase();
}

/**
 * Reads a run's actual background and ink color straight off the rendered
 * page, rather than assuming plain white behind dark text — a run can just as
 * easily sit on a highlight or a shaded table cell. The background is simply
 * the bounding box's most common color (it dominates by area even with fairly
 * heavy ink); the foreground is the most common color that's clearly
 * different from it. Falls back to the app's previous defaults if the box is
 * empty or off-canvas.
 */
function sampleBounds(canvas: HTMLCanvasElement, scale: number, pageHeight: number, bounds: Rect): SampledColors {
  const fallback: SampledColors = { color: '#2C2C2A', backgroundColor: '#FFFFFF' };
  const px = Math.max(0, Math.round(bounds.x * scale));
  const py = Math.max(0, Math.round((pageHeight - bounds.y - bounds.height) * scale));
  const pw = Math.min(canvas.width - px, Math.max(1, Math.round(bounds.width * scale)));
  const ph = Math.min(canvas.height - py, Math.max(1, Math.round(bounds.height * scale)));
  if (pw <= 0 || ph <= 0) return fallback;

  let data: Uint8ClampedArray;
  try {
    data = canvas.getContext('2d')!.getImageData(px, py, pw, ph).data;
  } catch {
    return fallback;
  }

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip transparent pixels
    const r = quantizeChannel(data[i]);
    const g = quantizeChannel(data[i + 1]);
    const b = quantizeChannel(data[i + 2]);
    const key = `${r},${g},${b}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.count++;
    else buckets.set(key, { count: 1, r, g, b });
  }
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (!sorted.length) return fallback;

  const bg = sorted[0];
  const fg = sorted.find((c) => Math.hypot(c.r - bg.r, c.g - bg.g, c.b - bg.b) > MIN_FOREGROUND_CONTRAST);

  return {
    backgroundColor: toHex(bg.r, bg.g, bg.b),
    color: fg ? toHex(fg.r, fg.g, fg.b) : fallback.color,
  };
}

/**
 * Samples background/ink color for a batch of runs on the same page — the
 * page is rendered once and reused for every box, rather than once per box.
 *
 * Renders with the 'print' intent specifically (like the export path in
 * render.ts's `rasterizePdf`, not the live preview's `renderPageRaw`) — the
 * default intent schedules its progressive updates through
 * requestAnimationFrame, which a backgrounded or otherwise non-compositing
 * tab can leave never firing, hanging this indefinitely. Print rendering
 * finishes in one pass with no such dependency.
 */
export async function sampleRunColors(doc: DocumentState, page: WorkPage, boundsList: Rect[]): Promise<SampledColors[]> {
  const source = page.sourceId ? doc.sources[page.sourceId] : undefined;
  const fallback = boundsList.map(() => ({ color: '#2C2C2A', backgroundColor: '#FFFFFF' }));
  if (!source || source.kind !== 'pdf') return fallback;

  const pdf = await getPdfDoc(source);
  const pdfPage = await pdf.getPage(page.sourceIndex + 1);
  const viewport = pdfPage.getViewport({ scale: SAMPLE_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvas, viewport, intent: 'print' }).promise;
  pdfPage.cleanup();

  return boundsList.map((bounds) => sampleBounds(canvas, SAMPLE_SCALE, page.height, bounds));
}

/** Groups text runs into reading-order lines, used by the DOCX export. */
export function groupIntoLines(items: TextItem[]): string[] {
  if (!items.length) return [];
  const sorted = [...items].sort((p, q) => (Math.abs(q.y - p.y) > 3 ? q.y - p.y : p.x - q.x));
  const lines: string[] = [];
  let current: TextItem[] = [];
  let currentY = sorted[0].y;

  for (const item of sorted) {
    if (Math.abs(item.y - currentY) > Math.max(3, item.fontSize * 0.6)) {
      if (current.length) lines.push(joinLine(current));
      current = [];
      currentY = item.y;
    }
    current.push(item);
  }
  if (current.length) lines.push(joinLine(current));
  return lines.filter((l) => l.trim().length > 0);
}

function joinLine(items: TextItem[]): string {
  const sorted = [...items].sort((p, q) => p.x - q.x);
  let out = '';
  let prevEnd: number | null = null;
  for (const item of sorted) {
    // Reinstate the space that PDF text positioning implies but does not store.
    if (prevEnd !== null && item.x - prevEnd > item.fontSize * 0.25 && !/\s$/.test(out)) out += ' ';
    out += item.text;
    prevEnd = item.x + item.width;
  }
  return out.replace(/\s+/g, ' ').trim();
}
