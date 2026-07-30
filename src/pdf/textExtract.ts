import type { DocumentState, WorkPage } from './model';
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
