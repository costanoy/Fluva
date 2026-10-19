import { pdfjsLib, type PDFPageProxy } from './pdfjs';
import type { Rect } from './model';

/**
 * Where each glyph of a page lands, and with what — read off pdf.js's own
 * operator list rather than guessed from pixels.
 *
 * pdf.js already resolves every font's widths, encodings and the text state;
 * its operator list carries exactly one `showText` per text-showing operator
 * of the page content (Tj, TJ, ' and "), in order, and every glyph in it knows
 * its character code in the PDF, its Unicode text and its width. Replaying it
 * the way pdf.js's canvas renderer does gives, for each operator, which
 * glyphs fall under a given set of boxes, the text state they were shown
 * with, and their exact fill color. Kept free of pdf-lib so the editor can use
 * it without loading the export machinery.
 */

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** A glyph as pdf.js's operator list hands it over. */
interface PdfjsGlyph {
  originalCharCode: number;
  unicode: string;
  width: number;
  isSpace?: boolean;
  isInFont?: boolean;
}

/** A character a font can draw: its code in the PDF and its width. */
export interface GlyphInfo {
  code: number;
  /** In the font's own glyph units (see `OpPlan.fontMatrix0`). */
  width: number;
  isSpace: boolean;
}

/** What one text-showing operator does. */
export interface OpPlan {
  /** Per glyph (numbers excluded), in order: the box it falls under, or -1. */
  cover: number[];
  /** Per glyph: the TJ adjustment (thousandths of the font size) that moves
   * the pen exactly as far as that glyph did. */
  adjust: number[];
  /** pdf.js's key for the font in use. */
  fontKey: string;
  fontMatrix0: number;
  /** As set by Tf (always positive; see `fontDirection`). */
  fontSize: number;
  fontDirection: number;
  charSpacing: number;
  wordSpacing: number;
  /** Tz, as a factor (1 = 100%). */
  hScale: number;
  rise: number;
  /** "#rrggbb", or null when the text is filled with a pattern. */
  fillColor: string | null;
  /** For outlined text (render modes 1, 2, 5, 6). */
  strokeColor: string | null;
  lineWidth: number;
  renderMode: number;
  /** The text matrix times the CTM, without its translation: how text space
   * is turned and scaled on the page where the operator draws. */
  linear: [number, number, number, number];
}

export interface PagePlan {
  /** One entry per text-showing operator of the page content, or null when
   * the operator must not be touched (vertical writing, zero font size). */
  ops: Array<OpPlan | null>;
  /** Per pdf.js font key, every character seen drawn with that font on the
   * page — the characters a subset font is known to really have. */
  glyphs: Map<string, Map<string, GlyphInfo>>;
}

interface TextState {
  ctm: Matrix;
  textMatrix: Matrix;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
  fontKey: string;
  fontMatrix: number[];
  fontSize: number;
  fontDirection: number;
  vertical: boolean;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
  fillColor: string | null;
  strokeColor: string | null;
  lineWidth: number;
  renderMode: number;
}

/**
 * Replays the page's operator list and decides, for each text-showing
 * operator, which glyphs sit under one of `boxes` (displayed space,
 * bottom-left origin — the space overlays live in).
 */
export async function planPage(pdfPage: PDFPageProxy, boxes: Rect[]): Promise<PagePlan> {
  const OPS = pdfjsLib.OPS;
  const viewport = pdfPage.getViewport({ scale: 1 });
  const opList = await pdfPage.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE });

  let st: TextState = {
    ctm: IDENTITY,
    textMatrix: IDENTITY,
    x: 0,
    y: 0,
    lineX: 0,
    lineY: 0,
    fontKey: '',
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    fontSize: 0,
    fontDirection: 1,
    vertical: false,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
    fillColor: '#000000',
    strokeColor: '#000000',
    lineWidth: 1,
    renderMode: 0,
  };
  const stack: TextState[] = [];
  let formDepth = 0;
  const ops: Array<OpPlan | null> = [];
  const glyphs = new Map<string, Map<string, GlyphInfo>>();

  const boxAt = (tx: number, ty: number): number => {
    const [ux, uy] = apply(st.ctm, ...apply(st.textMatrix, tx, ty));
    const [vx, vy] = viewport.convertToViewportPoint(ux, uy);
    const dx = vx;
    const dy = viewport.height - vy;
    return boxes.findIndex((c) => dx >= c.x - 1 && dx <= c.x + c.width + 1 && dy >= c.y - 1 && dy <= c.y + c.height + 1);
  };

  const moveText = (x: number, y: number) => {
    st.lineX += x;
    st.lineY += y;
    st.x = st.lineX;
    st.y = st.lineY;
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];

    // Form XObjects are separate streams with their own operators; they are
    // drawn between these brackets and never show up in the page's own content.
    if (fn === OPS.paintFormXObjectBegin) {
      formDepth++;
      continue;
    }
    if (fn === OPS.paintFormXObjectEnd) {
      formDepth = Math.max(0, formDepth - 1);
      continue;
    }
    if (formDepth > 0) continue;

    switch (fn) {
      case OPS.save:
        stack.push({ ...st });
        break;
      case OPS.restore:
        st = stack.pop() ?? st;
        break;
      case OPS.transform:
        st.ctm = multiply(args as Matrix, st.ctm);
        break;
      case OPS.beginText:
        st.textMatrix = IDENTITY;
        st.x = st.y = st.lineX = st.lineY = 0;
        break;
      case OPS.setFont: {
        const [fontRef, size] = args as [string, number];
        let font: { fontMatrix?: number[]; vertical?: boolean } | null = null;
        try {
          font = pdfPage.commonObjs.get(fontRef) as { fontMatrix?: number[]; vertical?: boolean };
        } catch {
          font = null;
        }
        st.fontKey = fontRef;
        st.fontMatrix = font?.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0];
        st.vertical = !!font?.vertical;
        st.fontDirection = size < 0 ? -1 : 1;
        st.fontSize = Math.abs(size);
        break;
      }
      case OPS.setTextMatrix: {
        // pdf.js hands the matrix over as a typed array, not a plain one.
        const m = (Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) ? args[0] : args) as Matrix;
        st.textMatrix = [m[0], m[1], m[2], m[3], m[4], m[5]];
        st.x = st.y = st.lineX = st.lineY = 0;
        break;
      }
      case OPS.moveText:
        moveText(args[0] as number, args[1] as number);
        break;
      case OPS.setLeadingMoveText:
        st.leading = args[1] as number;
        moveText(args[0] as number, args[1] as number);
        break;
      case OPS.nextLine:
        moveText(0, st.leading);
        break;
      case OPS.setLeading:
        st.leading = -(args[0] as number);
        break;
      case OPS.setCharSpacing:
        st.charSpacing = args[0] as number;
        break;
      case OPS.setWordSpacing:
        st.wordSpacing = args[0] as number;
        break;
      case OPS.setHScale:
        st.hScale = (args[0] as number) / 100;
        break;
      case OPS.setTextRise:
        st.rise = args[0] as number;
        break;
      case OPS.setTextRenderingMode:
        st.renderMode = args[0] as number;
        break;
      // pdf.js turns every flat fill color (gray, RGB, CMYK, any color space)
      // into one "#rrggbb" setFillRGBColor; a pattern fill has no single color.
      case OPS.setFillRGBColor:
        st.fillColor = typeof args[0] === 'string' ? args[0] : st.fillColor;
        break;
      case OPS.setFillColorN:
      case OPS.setFillTransparent:
        st.fillColor = null;
        break;
      case OPS.setStrokeRGBColor:
        st.strokeColor = typeof args[0] === 'string' ? args[0] : st.strokeColor;
        break;
      case OPS.setStrokeColorN:
      case OPS.setStrokeTransparent:
        st.strokeColor = null;
        break;
      case OPS.setLineWidth:
        st.lineWidth = args[0] as number;
        break;
      case OPS.showText:
      case OPS.showSpacedText: {
        const shown = (args[0] ?? []) as Array<PdfjsGlyph | number>;
        if (st.vertical || st.fontSize === 0) {
          ops.push(null);
          // Vertical runs still advance the pen, but nothing after them on the
          // same line is a candidate either — leave the state as is.
          break;
        }
        const fm0 = st.fontMatrix[0] ?? 0.001;
        const hScale = st.hScale * st.fontDirection;
        const advanceScale = st.fontSize * fm0;
        const signedSize = st.fontSize * st.fontDirection;
        let known = glyphs.get(st.fontKey);
        if (!known) {
          known = new Map();
          glyphs.set(st.fontKey, known);
        }
        const cover: number[] = [];
        const adjust: number[] = [];
        let x = 0;
        for (const glyph of shown) {
          if (typeof glyph === 'number') {
            x += (-glyph * st.fontSize) / 1000;
            continue;
          }
          const spacing = (glyph.isSpace ? st.wordSpacing : 0) + st.charSpacing;
          const advance = glyph.width * advanceScale + spacing * st.fontDirection;
          // Probe the glyph's middle: half its advance along, a third of an em up.
          const cx = st.x + (x + advance / 2) * hScale;
          const cy = st.y + st.rise + st.fontSize * 0.3;
          cover.push(boxAt(cx, cy));
          adjust.push(-(glyph.width * fm0 * 1000 + (spacing * 1000) / signedSize));
          x += advance;
          // One character per glyph only — a ligature's "fi" can't stand for
          // either letter alone. A space has nothing to draw (pdf.js counts it
          // as not in the font); its code and advance are all that matter.
          const blank = /^\s$/.test(glyph.unicode ?? '');
          if ((glyph.isInFont !== false || blank) && [...(glyph.unicode ?? '')].length === 1 && !known.has(glyph.unicode)) {
            known.set(glyph.unicode, { code: glyph.originalCharCode, width: glyph.width, isSpace: !!glyph.isSpace });
          }
        }
        st.x += x * hScale;
        const [ta, tb, tc, td] = multiply(st.textMatrix, st.ctm);
        ops.push({
          cover,
          adjust,
          fontKey: st.fontKey,
          fontMatrix0: fm0,
          fontSize: st.fontSize,
          fontDirection: st.fontDirection,
          charSpacing: st.charSpacing,
          wordSpacing: st.wordSpacing,
          hScale: st.hScale,
          rise: st.rise,
          fillColor: st.fillColor,
          strokeColor: st.strokeColor,
          lineWidth: st.lineWidth,
          renderMode: st.renderMode,
          linear: [ta, tb, tc, td],
        });
        break;
      }
      default:
        break;
    }
  }
  return { ops, glyphs };
}

/**
 * The exact color each box's text is filled with (that of its first glyph),
 * or null where there's no visible text with a flat color under it. Read from
 * the page's own drawing instructions — sampling rendered pixels returned a
 * lighter, antialiased shade for small text.
 */
export async function textInkColors(pdfPage: PDFPageProxy, boxes: Rect[]): Promise<Array<string | null>> {
  const { ops } = await planPage(pdfPage, boxes);
  return boxes.map((_, index) => {
    for (const op of ops) {
      // Invisible text (render mode 3: an OCR layer over a scan) isn't ink.
      if (!op || op.renderMode === 3 || op.renderMode === 7) continue;
      if (op.cover.includes(index)) return op.fillColor?.toUpperCase() ?? null;
    }
    return null;
  });
}
