import { PDFArray, PDFDict, PDFName, PDFRawStream, PDFStream, decodePDFRawStream, type PDFContext, type PDFPage } from 'pdf-lib';
import { pdfjsLib, type PDFPageProxy } from './pdfjs';
import type { Rect } from './model';

/**
 * Removes the original text that a replacement covers.
 *
 * Replacing a text run paints an opaque box over it and draws the new text on
 * top — which looked right but left the old words in the file, where search,
 * copy/paste and any text extractor still found them (a changed amount, a
 * "hidden" CPF...). This deletes them from the page's content stream instead.
 *
 * pdf.js is the source of truth for *where* each glyph lands (it already
 * resolves every font's widths, encodings and the text state); its operator
 * list carries exactly one `showText` per text-showing operator of the page
 * content (Tj, TJ, ' and "), in order. A small content-stream lexer finds the
 * same operators in the raw bytes, and each one whose glyphs fall under a
 * cover is rewritten as a pure positioning TJ of the same advance — so the
 * rest of the line keeps its exact place. When the two sides don't line up one
 * to one, the page is left untouched rather than risk deleting the wrong text.
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

interface Glyph {
  width: number;
  isSpace?: boolean;
}

/** What to do with one text-showing operator. */
interface OpPlan {
  /** Per glyph (numbers excluded), in order: drop it from the output. */
  drop: boolean[];
  /** Per glyph, the TJ adjustment (thousandths of the font size) that moves the
   * pen exactly as far as that glyph did. */
  adjust: number[];
}

/** One entry per text-showing operator of the page content, or null when the
 * operator must not be touched (vertical writing, zero font size). */
type PagePlan = Array<OpPlan | null>;

interface TextState {
  ctm: Matrix;
  textMatrix: Matrix;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
  fontMatrix: number[];
  fontSize: number;
  fontDirection: number;
  vertical: boolean;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
}

/**
 * Replays the page's operator list the way pdf.js's own canvas renderer does
 * (same text state, same advance formula) and decides, for each text-showing
 * operator, which glyphs sit under one of `covers` (displayed space,
 * bottom-left origin — the space overlays live in).
 */
async function planPage(pdfPage: PDFPageProxy, covers: Rect[]): Promise<PagePlan> {
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
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    fontSize: 0,
    fontDirection: 1,
    vertical: false,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
  };
  const stack: TextState[] = [];
  let formDepth = 0;
  const plan: PagePlan = [];

  const underCover = (tx: number, ty: number): boolean => {
    const [ux, uy] = apply(st.ctm, ...apply(st.textMatrix, tx, ty));
    const [vx, vy] = viewport.convertToViewportPoint(ux, uy);
    const dx = vx;
    const dy = viewport.height - vy;
    return covers.some((c) => dx >= c.x - 1 && dx <= c.x + c.width + 1 && dy >= c.y - 1 && dy <= c.y + c.height + 1);
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
      case OPS.showText:
      case OPS.showSpacedText: {
        const glyphs = (args[0] ?? []) as Array<Glyph | number>;
        if (st.vertical || st.fontSize === 0) {
          plan.push(null);
          // Vertical runs still advance the pen, but nothing after them on the
          // same line is a candidate either — leave the state as is.
          break;
        }
        const hScale = st.hScale * st.fontDirection;
        const advanceScale = st.fontSize * (st.fontMatrix[0] ?? 0.001);
        const signedSize = st.fontSize * st.fontDirection;
        const drop: boolean[] = [];
        const adjust: number[] = [];
        let x = 0;
        for (const glyph of glyphs) {
          if (typeof glyph === 'number') {
            x += (-glyph * st.fontSize) / 1000;
            continue;
          }
          const spacing = (glyph.isSpace ? st.wordSpacing : 0) + st.charSpacing;
          const advance = glyph.width * advanceScale + spacing * st.fontDirection;
          // Probe the glyph's middle: half its advance along, a third of an em up.
          const cx = st.x + (x + advance / 2) * hScale;
          const cy = st.y + st.rise + st.fontSize * 0.3;
          drop.push(underCover(cx, cy));
          adjust.push(-(glyph.width * (st.fontMatrix[0] ?? 0.001) * 1000 + (spacing * 1000) / signedSize));
          x += advance;
        }
        st.x += x * hScale;
        plan.push({ drop, adjust });
        break;
      }
      default:
        break;
    }
  }
  return plan;
}

/* ------------------------------------------------------------- the lexer */

interface Token {
  kind: 'number' | 'name' | 'string' | 'hex' | 'array' | 'dict' | 'keyword';
  start: number;
  end: number;
  /** Numbers: the value. */
  value?: number;
  /** Names: without the slash. */
  name?: string;
  /** Arrays: their items. */
  items?: Token[];
}

interface Operation {
  op: string;
  operands: Token[];
  start: number;
  end: number;
}

const isWhite = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

class Lexer {
  pos = 0;
  constructor(private readonly s: Uint8Array) {}

  skipSpace(): void {
    const { s } = this;
    while (this.pos < s.length) {
      const c = s[this.pos];
      if (isWhite(c)) this.pos++;
      else if (c === 37) {
        while (this.pos < s.length && s[this.pos] !== 10 && s[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  /** Reads one value or keyword. Returns null at the end of the stream. */
  next(): Token | null {
    this.skipSpace();
    const { s } = this;
    if (this.pos >= s.length) return null;
    const start = this.pos;
    const c = s[start];

    if (c === 47) {
      // name
      this.pos++;
      while (this.pos < s.length && !isWhite(s[this.pos]) && !isDelim(s[this.pos])) this.pos++;
      return { kind: 'name', start, end: this.pos, name: latin1(s.subarray(start + 1, this.pos)) };
    }
    if (c === 40) {
      this.pos = skipLiteral(s, start);
      return { kind: 'string', start, end: this.pos };
    }
    if (c === 60 && s[start + 1] === 60) {
      this.pos = start + 2;
      for (;;) {
        this.skipSpace();
        if (this.pos >= s.length) break;
        if (s[this.pos] === 62 && s[this.pos + 1] === 62) {
          this.pos += 2;
          break;
        }
        if (!this.next()) break;
      }
      return { kind: 'dict', start, end: this.pos };
    }
    if (c === 60) {
      let p = start + 1;
      while (p < s.length && s[p] !== 62) p++;
      this.pos = Math.min(s.length, p + 1);
      return { kind: 'hex', start, end: this.pos };
    }
    if (c === 91) {
      this.pos++;
      const items: Token[] = [];
      for (;;) {
        this.skipSpace();
        if (this.pos >= s.length) break;
        if (s[this.pos] === 93) {
          this.pos++;
          break;
        }
        const item = this.next();
        if (!item) break;
        items.push(item);
      }
      return { kind: 'array', start, end: this.pos, items };
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) {
      // Stray closing delimiter — consume it as a meaningless keyword.
      this.pos++;
      return { kind: 'keyword', start, end: this.pos, name: String.fromCharCode(c) };
    }
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      let p = start + 1;
      while (p < s.length && ((s[p] >= 48 && s[p] <= 57) || s[p] === 46)) p++;
      this.pos = p;
      const value = Number(latin1(s.subarray(start, p)));
      return { kind: 'number', start, end: p, value: Number.isFinite(value) ? value : 0 };
    }
    let p = start;
    while (p < s.length && !isWhite(s[p]) && !isDelim(s[p])) p++;
    this.pos = p;
    return { kind: 'keyword', start, end: p, name: latin1(s.subarray(start, p)) };
  }

  /** After a BI keyword: skips the inline image's dictionary and binary data. */
  skipInlineImage(): void {
    const { s } = this;
    // Dictionary entries up to the ID keyword.
    for (;;) {
      const tok = this.next();
      if (!tok) return;
      if (tok.kind === 'keyword' && tok.name === 'ID') break;
    }
    this.pos++; // the single whitespace after ID
    // The data ends at an "EI" with whitespace before it and a boundary after.
    for (let p = this.pos; p < s.length - 1; p++) {
      if (s[p] === 69 && s[p + 1] === 73 && isWhite(s[p - 1]) && (p + 2 >= s.length || isWhite(s[p + 2]) || isDelim(s[p + 2]))) {
        this.pos = p + 2;
        return;
      }
    }
    this.pos = s.length;
  }
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function skipLiteral(s: Uint8Array, start: number): number {
  let depth = 0;
  let p = start;
  while (p < s.length) {
    const c = s[p];
    if (c === 92) {
      p += 2;
      continue;
    }
    if (c === 40) depth++;
    else if (c === 41) {
      depth--;
      if (depth === 0) return p + 1;
    }
    p++;
  }
  return s.length;
}

function parse(content: Uint8Array): Operation[] {
  const lexer = new Lexer(content);
  const ops: Operation[] = [];
  let operands: Token[] = [];
  let opStart = -1;
  for (;;) {
    const tok = lexer.next();
    if (!tok) break;
    if (opStart === -1) opStart = tok.start;
    if (tok.kind === 'keyword' && tok.name !== 'true' && tok.name !== 'false' && tok.name !== 'null') {
      if (tok.name === 'BI') lexer.skipInlineImage();
      ops.push({ op: tok.name!, operands, start: opStart, end: lexer.pos });
      operands = [];
      opStart = -1;
      continue;
    }
    operands.push(tok);
  }
  return ops;
}

/** The raw bytes of a literal or hex string token. */
function stringBytes(content: Uint8Array, tok: Token): number[] {
  const raw = content.subarray(tok.start, tok.end);
  if (tok.kind === 'hex') {
    const digits = latin1(raw.subarray(1, raw.length - 1)).replace(/[^0-9a-fA-F]/g, '');
    const even = digits.length % 2 ? `${digits}0` : digits;
    const out: number[] = [];
    for (let i = 0; i < even.length; i += 2) out.push(parseInt(even.slice(i, i + 2), 16));
    return out;
  }
  const out: number[] = [];
  for (let i = 1; i < raw.length - 1; i++) {
    let c = raw[i];
    if (c === 13) {
      // A bare end-of-line inside a literal string reads as a single \n.
      if (raw[i + 1] === 10) i++;
      out.push(10);
      continue;
    }
    if (c !== 92) {
      out.push(c);
      continue;
    }
    c = raw[++i];
    if (c === undefined) break;
    switch (c) {
      case 110: out.push(10); break; // \n
      case 114: out.push(13); break; // \r
      case 116: out.push(9); break; // \t
      case 98: out.push(8); break; // \b
      case 102: out.push(12); break; // \f
      case 13:
        if (raw[i + 1] === 10) i++;
        break; // line continuation
      case 10:
        break; // line continuation
      default:
        if (c >= 48 && c <= 55) {
          let value = c - 48;
          for (let k = 0; k < 2 && raw[i + 1] >= 48 && raw[i + 1] <= 55; k++) value = value * 8 + (raw[++i] - 48);
          out.push(value & 255);
        } else {
          out.push(c);
        }
    }
  }
  return out;
}

const hex = (bytes: number[]) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** The single positioning TJ that moves the pen as far as `plan`'s glyphs did. */
function advanceOnly(operands: Token[], plan: OpPlan): number {
  let total = plan.adjust.reduce((a, b) => a + b, 0);
  for (const tok of operands) {
    if (tok.kind === 'array') for (const item of tok.items ?? []) if (item.kind === 'number') total += item.value ?? 0;
  }
  return total;
}

/**
 * Rewrites one text-showing operation. Returns the replacement source text, or
 * null when it can't be done safely (the original is then kept).
 */
function rewrite(op: Operation, plan: OpPlan, content: Uint8Array, codeWidth: 1 | 2 | null): string | null {
  // ' and " also move to the next line (and " sets the spacing) — kept as-is.
  let prefix = '';
  if (op.op === "'") prefix = 'T* ';
  if (op.op === '"') {
    const [aw, ac] = op.operands;
    if (aw?.kind !== 'number' || ac?.kind !== 'number') return null;
    prefix = `${num(aw.value!)} Tw ${num(ac.value!)} Tc T* `;
  }

  if (plan.drop.every(Boolean)) return `${prefix}[${num(advanceOnly(op.operands, plan))}] TJ`;

  // Part of the run survives: rebuild it glyph by glyph, which needs to know
  // how many bytes each glyph's code takes.
  if (!codeWidth) return null;
  const strings: Token[] = op.op === 'TJ' ? op.operands[0]?.items ?? [] : [op.operands[op.operands.length - 1]].filter(Boolean);
  const elements: Array<{ bytes: number[] } | { adjust: number }> = [];
  let glyphIndex = 0;
  for (const tok of strings) {
    if (tok.kind === 'number') {
      elements.push({ adjust: tok.value ?? 0 });
      continue;
    }
    if (tok.kind !== 'string' && tok.kind !== 'hex') return null;
    const bytes = stringBytes(content, tok);
    if (bytes.length % codeWidth) return null;
    for (let i = 0; i < bytes.length; i += codeWidth) {
      if (glyphIndex >= plan.drop.length) return null;
      if (plan.drop[glyphIndex]) elements.push({ adjust: plan.adjust[glyphIndex] });
      else elements.push({ bytes: bytes.slice(i, i + codeWidth) });
      glyphIndex++;
    }
  }
  if (glyphIndex !== plan.drop.length) return null;

  // Merge neighbours: consecutive codes into one string, adjustments into one number.
  const parts: string[] = [];
  let run: number[] = [];
  let adjust = 0;
  let pendingAdjust = false;
  const flushRun = () => {
    if (run.length) parts.push(hex(run));
    run = [];
  };
  const flushAdjust = () => {
    if (pendingAdjust && adjust !== 0) parts.push(num(adjust));
    adjust = 0;
    pendingAdjust = false;
  };
  for (const el of elements) {
    if ('bytes' in el) {
      flushAdjust();
      run.push(...el.bytes);
    } else {
      flushRun();
      adjust += el.adjust;
      pendingAdjust = true;
    }
  }
  flushRun();
  flushAdjust();
  return `${prefix}[${parts.join(' ')}] TJ`;
}

const TEXT_OPS = new Set(['Tj', 'TJ', "'", '"']);

/** Bytes per character code for the font a Tf named, when that's knowable. */
function codeWidthOf(page: PDFPage, fontName: string | null): 1 | 2 | null {
  if (!fontName) return null;
  try {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    const font = fonts?.lookup(PDFName.of(fontName), PDFDict);
    if (!font) return null;
    const subtype = font.lookup(PDFName.of('Subtype'));
    if (subtype !== PDFName.of('Type0')) return 1;
    const encoding = font.lookup(PDFName.of('Encoding'));
    return encoding === PDFName.of('Identity-H') || encoding === PDFName.of('Identity-V') ? 2 : null;
  } catch {
    return null;
  }
}

function readContents(page: PDFPage): Uint8Array | null {
  const contents = page.node.Contents();
  if (!contents) return null;
  const streams: PDFStream[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = contents.lookup(i);
      if (s instanceof PDFStream) streams.push(s);
    }
  } else if (contents instanceof PDFStream) {
    streams.push(contents);
  }
  if (!streams.length) return null;
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (!(s instanceof PDFRawStream)) return null;
    parts.push(decodePDFRawStream(s).decode());
  }
  // Separate content streams join at token boundaries; a newline between them
  // keeps two adjacent tokens from fusing.
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
    out[at++] = 10;
  }
  return out;
}

/**
 * Deletes, from `outPage` (a freshly copied source page, before anything else
 * is drawn on it), the text that sits under `covers`. Returns whether every
 * covered glyph could be removed — false means some original text is still
 * in the file (the page was left as it was, or a run had to be kept whole).
 */
export async function removeCoveredText(pdfPage: PDFPageProxy, outPage: PDFPage, context: PDFContext, covers: Rect[]): Promise<boolean> {
  if (!covers.length) return true;
  const plan = await planPage(pdfPage, covers);
  if (!plan.some((p) => p && p.drop.some(Boolean))) return true;

  const content = readContents(outPage);
  if (!content) return false;
  const ops = parse(content);

  const textOps = ops.filter((o) => TEXT_OPS.has(o.op));
  if (textOps.length !== plan.length) return false;

  let complete = true;
  let fontName: string | null = null;
  const fontStack: Array<string | null> = [];
  let textIndex = 0;
  const pieces: string[] = [];
  let cursor = 0;

  for (const op of ops) {
    if (op.op === 'q') fontStack.push(fontName);
    else if (op.op === 'Q') fontName = fontStack.pop() ?? fontName;
    else if (op.op === 'Tf') fontName = op.operands[0]?.kind === 'name' ? op.operands[0].name ?? null : fontName;
    if (!TEXT_OPS.has(op.op)) continue;

    const opPlan = plan[textIndex++];
    if (!opPlan || !opPlan.drop.some(Boolean)) continue;
    const replacement = rewrite(op, opPlan, content, codeWidthOf(outPage, fontName));
    if (replacement === null) {
      complete = false;
      continue;
    }
    pieces.push(latin1(content.subarray(cursor, op.start)), replacement);
    cursor = op.end;
  }
  if (cursor === 0) return complete;
  pieces.push(latin1(content.subarray(cursor)));

  const source = pieces.join('');
  const bytes = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) bytes[i] = source.charCodeAt(i) & 255;

  // The replaced stream, original text and all, is left for `buildPdf`'s
  // final sweep of unreachable objects to drop — deleting it here would also
  // break another page that happens to share it.
  outPage.node.set(PDFName.of('Contents'), context.register(context.flateStream(bytes)));
  return complete;
}
