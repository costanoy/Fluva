import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream, type PDFContext, type PDFFont, type PDFPage } from 'pdf-lib';
import { Encodings, Font as StandardFontMetrics, FontNames } from '@pdf-lib/standard-fonts';
import type { PDFPageProxy } from './pdfjs';
import type { Rect } from './model';
import { planPage, type GlyphInfo, type OpPlan } from './textPlan';

/**
 * Removes the original text a replacement covers — and, when it can, writes
 * the new text in its place.
 *
 * Replacing a text run used to paint an opaque box over it and draw the new
 * text on top: the old words stayed in the file (search, copy/paste and any
 * text extractor still found them), the box blanked out whatever was behind
 * them (a highlight, a table rule), and the new text came out in a look-alike
 * font, a sampled color and none of the original spacing. Now the run's own
 * operators in the page's content stream are rewritten instead: its glyphs
 * are dropped, and the new text goes into that same operator, in the same
 * font program, at the same size, color, spacing and position — the way the
 * rest of the line is drawn. Only characters that font doesn't have (a subset
 * font carries just the ones the document used) come from a fallback font,
 * one by one.
 *
 * pdf.js says where each glyph lands and with what (see textPlan.ts); a small
 * content-stream lexer finds the same operators in the raw bytes. When the
 * two sides don't line up one to one, the page is left untouched rather than
 * risk rewriting the wrong text.
 */

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
const codeBytes = (code: number, width: 1 | 2) => (width === 2 ? [(code >> 8) & 255, code & 255] : [code & 255]);

/** The single positioning TJ that moves the pen as far as `plan`'s glyphs did. */
function advanceOnly(operands: Token[], plan: OpPlan): number {
  let total = plan.adjust.reduce((a, b) => a + b, 0);
  for (const tok of operands) {
    if (tok.kind === 'array') for (const item of tok.items ?? []) if (item.kind === 'number') total += item.value ?? 0;
  }
  return total;
}

/** What goes into a rewritten text operator, in order: character codes, pen
 * moves (TJ numbers), or whole operators that switch to another font and back
 * (which have to sit between two TJ arrays). */
type Piece = { bytes: number[] } | { adjust: number } | { raw: string };

/** New text laid out for one spot: its pieces and how far they move the pen,
 * in TJ units (thousandths of the font size). */
interface Insertion {
  /** The glyph of the rewritten operator it goes right before. */
  at: number;
  cover: number;
  pieces: Piece[];
  advance: number;
}

/**
 * Rewrites one text-showing operation: drops the glyphs under any cover (each
 * replaced by a move of the same advance, so the rest of the line keeps its
 * exact place) and puts `insertions` in. New text is followed by a move back
 * over its own advance, so the dropped glyphs' moves still carry the pen
 * exactly where the original run took it. Returns the replacement source
 * text, or null when it can't be done safely (the original is then kept).
 */
function rewrite(op: Operation, plan: OpPlan, content: Uint8Array, codeWidth: 1 | 2 | null, insertions: Insertion[]): string | null {
  // ' and " also move to the next line (and " sets the spacing) — kept as-is.
  let prefix = '';
  if (op.op === "'") prefix = 'T* ';
  if (op.op === '"') {
    const [aw, ac] = op.operands;
    if (aw?.kind !== 'number' || ac?.kind !== 'number') return null;
    prefix = `${num(aw.value!)} Tw ${num(ac.value!)} Tc T* `;
  }

  if (!insertions.length && plan.cover.every((c) => c >= 0)) return `${prefix}[${num(advanceOnly(op.operands, plan))}] TJ`;

  // Rebuilt glyph by glyph, which needs to know how many bytes each glyph's
  // code takes.
  if (!codeWidth) return null;
  const strings: Token[] = op.op === 'TJ' ? op.operands[0]?.items ?? [] : [op.operands[op.operands.length - 1]].filter(Boolean);
  const pieces: Piece[] = [];
  const pending = [...insertions].sort((a, b) => a.at - b.at);
  const putInsertions = (glyphIndex: number) => {
    while (pending.length && pending[0].at === glyphIndex) {
      const insertion = pending.shift()!;
      pieces.push(...insertion.pieces, { adjust: insertion.advance });
    }
  };
  let glyphIndex = 0;
  for (const tok of strings) {
    if (tok.kind === 'number') {
      pieces.push({ adjust: tok.value ?? 0 });
      continue;
    }
    if (tok.kind !== 'string' && tok.kind !== 'hex') return null;
    const bytes = stringBytes(content, tok);
    if (bytes.length % codeWidth) return null;
    for (let i = 0; i < bytes.length; i += codeWidth) {
      if (glyphIndex >= plan.cover.length) return null;
      putInsertions(glyphIndex);
      if (plan.cover[glyphIndex] >= 0) pieces.push({ adjust: plan.adjust[glyphIndex] });
      else pieces.push({ bytes: bytes.slice(i, i + codeWidth) });
      glyphIndex++;
    }
  }
  if (glyphIndex !== plan.cover.length || pending.length) return null;
  return `${prefix}${assemble(pieces)}`;
}

/** Pieces as operators: consecutive codes merged into one string, moves into
 * one number, and a font switch closing the TJ array in progress. */
function assemble(pieces: Piece[]): string {
  const out: string[] = [];
  let parts: string[] = [];
  let run: number[] = [];
  let adjust = 0;
  const flushRun = () => {
    if (run.length) parts.push(hex(run));
    run = [];
  };
  const flushAdjust = () => {
    if (Math.abs(adjust) > 1e-6) parts.push(num(adjust));
    adjust = 0;
  };
  const flushArray = () => {
    flushRun();
    flushAdjust();
    if (parts.length) out.push(`[${parts.join(' ')}] TJ`);
    parts = [];
  };
  for (const piece of pieces) {
    if ('bytes' in piece) {
      flushAdjust();
      run.push(...piece.bytes);
    } else if ('adjust' in piece) {
      flushRun();
      adjust += piece.adjust;
    } else {
      flushArray();
      out.push(piece.raw);
    }
  }
  flushArray();
  return out.join(' ');
}

const TEXT_OPS = new Set(['Tj', 'TJ', "'", '"']);

/** The standard-14 fonts with WinAnsi glyph names (Symbol and ZapfDingbats have their own sets). */
const STANDARD_14 = new Map<string, FontNames>(
  Object.values(FontNames)
    .filter((name) => name !== FontNames.Symbol && name !== FontNames.ZapfDingbats)
    .map((name) => [name, name]),
);

/** What writing new characters in a font takes. */
interface FontInfo {
  /** Bytes per character code, when knowable. */
  codeWidth: 1 | 2 | null;
  /** For a simple font with no program in the file and the standard WinAnsi
   * encoding — the viewer supplies the whole font, so any WinAnsi character
   * can be written: its width in glyph units, or null when unknown. */
  winAnsiWidth?: (code: number, glyphName: string) => number | null;
}

function fontInfo(page: PDFPage, fontName: string | null): FontInfo {
  if (!fontName) return { codeWidth: null };
  try {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    const font = fonts?.lookup(PDFName.of(fontName), PDFDict);
    if (!font) return { codeWidth: null };
    const subtype = font.lookup(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Type0')) {
      const encoding = font.lookup(PDFName.of('Encoding'));
      return { codeWidth: encoding === PDFName.of('Identity-H') || encoding === PDFName.of('Identity-V') ? 2 : null };
    }
    const descriptor = font.lookup(PDFName.of('FontDescriptor'));
    const embedded = descriptor instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.has(PDFName.of(key)));
    if (subtype === PDFName.of('Type3') || embedded || font.lookup(PDFName.of('Encoding')) !== PDFName.of('WinAnsiEncoding')) return { codeWidth: 1 };
    const first = font.lookup(PDFName.of('FirstChar'));
    const widths = font.lookup(PDFName.of('Widths'));
    const base = font.lookup(PDFName.of('BaseFont'));
    const standard = base instanceof PDFName ? STANDARD_14.get(base.decodeText()) : undefined;
    return {
      codeWidth: 1,
      winAnsiWidth: (code, glyphName) => {
        if (widths instanceof PDFArray && first instanceof PDFNumber) {
          const width = widths.lookup(code - first.asNumber());
          if (width instanceof PDFNumber) return width.asNumber();
        }
        const width = standard ? StandardFontMetrics.load(standard).getWidthOfGlyph(glyphName) : undefined;
        return typeof width === 'number' ? width : null;
      },
    };
  } catch {
    return { codeWidth: null };
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

/** New text to write in place of the glyphs under one cover. */
export interface InPlaceText {
  /** Index of the cover whose run it replaces. */
  cover: number;
  text: string;
  /** Fonts, in the look of the run's substitute family, for characters the
   * run's own font doesn't have (see fonts.ts's `segments`). */
  fallback: (text: string) => Promise<Array<{ text: string; font: PDFFont }>>;
  /** Set when the text no longer sits exactly where its run did — moved,
   * resized, or broken into lines: it's then drawn there, line by line, with
   * the run's own font and text state, scaled by `scale`. Each line's
   * baseline origin is in the page's user space. */
  place?: { lines: Array<{ text: string; x: number; y: number }>; scale: number };
}

export interface RemovalResult {
  /** Covers whose original glyphs are all gone from the page content. */
  clean: Set<number>;
  /** Covers whose new text was written in place. */
  inserted: Set<number>;
}

/** A font as a Tf operator selected it: its resource name token and size, as written. */
interface TfFont {
  token: string;
  name: string;
  size: string;
}

/**
 * Lays out new text for the spot where a run started, inside the operator
 * that showed it: codes in that run's own font for every character it has, a
 * switch to a fallback font and back for the rest. A missing space becomes a
 * plain move — many PDFs space words that way and carry no space glyph.
 */
async function layoutInsertion(
  text: string,
  op: OpPlan,
  known: Map<string, GlyphInfo> | undefined,
  info: FontInfo,
  font: TfFont,
  page: PDFPage,
  fallback: InPlaceText['fallback'],
): Promise<{ pieces: Piece[]; advance: number } | null> {
  const { codeWidth } = info;
  if (!codeWidth || op.fontDirection < 0) return null;
  // Tc (and Tw, for a one-byte space) in TJ units.
  const spacing = (isSpace: boolean) => (((isSpace ? op.wordSpacing : 0) + op.charSpacing) * 1000) / op.fontSize;
  const pieces: Piece[] = [];
  let advance = 0;
  let missing = '';
  const resources = new Map<PDFFont, string>();

  const flushMissing = async () => {
    if (!missing) return;
    for (const segment of await fallback(missing)) {
      let resource = resources.get(segment.font);
      if (!resource) {
        resource = page.node.newFontDictionary(segment.font.name, segment.font.ref).asString();
        resources.set(segment.font, resource);
      }
      const encoded = segment.font.encodeText(segment.text).toString();
      pieces.push({ raw: `${resource} ${font.size} Tf ${encoded} Tj ${font.token} ${font.size} Tf` });
      advance += segment.font.widthOfTextAtSize(segment.text, 1000) + [...segment.text].length * spacing(false);
    }
    missing = '';
  };

  for (const ch of text) {
    const glyph = known?.get(ch);
    if (glyph) {
      await flushMissing();
      pieces.push({ bytes: codeBytes(glyph.code, codeWidth) });
      advance += glyph.width * op.fontMatrix0 * 1000 + spacing(glyph.isSpace);
      continue;
    }
    const codePoint = ch.codePointAt(0)!;
    if (info.winAnsiWidth && Encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint)) {
      const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(codePoint);
      const width = info.winAnsiWidth(code, name);
      if (width !== null) {
        await flushMissing();
        pieces.push({ bytes: [code] });
        advance += width + spacing(code === 32);
        continue;
      }
    }
    if (ch === ' ') {
      await flushMissing();
      const [space] = await fallback(' ');
      const gap = (space ? space.font.widthOfTextAtSize(' ', 1000) : 250) + spacing(true);
      pieces.push({ adjust: -gap });
      advance += gap;
      continue;
    }
    missing += ch;
  }
  await flushMissing();
  return { pieces, advance };
}

const rgb = (color: string) => {
  const n = parseInt(color.slice(1), 16);
  return `${num(((n >> 16) & 255) / 255)} ${num(((n >> 8) & 255) / 255)} ${num((n & 255) / 255)}`;
};

/**
 * Operators that draw `place`'s lines with a run's own font and text state —
 * its spacing, scaling, rise, render mode and colors, and its text matrix's
 * turn and scale (times `place.scale`), each line from its baseline origin.
 * Null when the run's look can't be carried over (outlined text, whose line
 * width belongs to a transform this doesn't reproduce).
 */
async function drawAt(
  place: NonNullable<InPlaceText['place']>,
  op: OpPlan,
  known: Map<string, GlyphInfo> | undefined,
  info: FontInfo,
  font: TfFont,
  page: PDFPage,
  fallback: InPlaceText['fallback'],
): Promise<string | null> {
  if (![0, 4].includes(op.renderMode) || !op.fillColor) return null;
  const [a, b, c, d] = op.linear.map((v) => v * place.scale);
  const state = `${font.token} ${font.size} Tf ${num(op.charSpacing)} Tc ${num(op.wordSpacing)} Tw ${num(op.hScale * 100)} Tz ${num(op.rise)} Ts ${op.renderMode} Tr ${rgb(op.fillColor)} rg`;
  const lines: string[] = [];
  for (const line of place.lines) {
    if (!line.text.trim()) continue;
    const laid = await layoutInsertion(line.text, op, known, info, font, page, fallback);
    if (!laid) return null;
    lines.push(`q ${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(line.x)} ${num(line.y)} cm BT ${state} ${assemble(laid.pieces)} ET Q`);
  }
  return lines.join('\n');
}

/**
 * Rewrites `outPage` (a freshly copied source page, before anything else is
 * drawn on it): deletes the text under `covers` and writes each of `inPlace`
 * where its run was. Says which covers are clean (nothing of the original
 * left) and which got their text in place; the caller blanks and draws the
 * rest the usual way.
 */
export async function removeCoveredText(
  pdfPage: PDFPageProxy,
  outPage: PDFPage,
  context: PDFContext,
  covers: Rect[],
  inPlace: InPlaceText[] = [],
): Promise<RemovalResult> {
  const result: RemovalResult = { clean: new Set(), inserted: new Set() };
  if (!covers.length) return result;
  const plan = await planPage(pdfPage, covers);
  // A cover with no glyph under it covers either nothing or text this can't
  // reach (inside a form XObject) — it isn't counted as clean either way.
  const reached = covers.map((_, k) => plan.ops.some((op) => op?.cover.includes(k)));
  if (!reached.some(Boolean)) return result;

  const content = readContents(outPage);
  if (!content) return result;
  const ops = parse(content);
  if (ops.filter((o) => TEXT_OPS.has(o.op)).length !== plan.ops.length) return result;

  // The font each text operator draws with, as its Tf selected it.
  const fonts: Array<TfFont | null> = [];
  let current: TfFont | null = null;
  const saved: Array<TfFont | null> = [];
  for (const op of ops) {
    if (op.op === 'q') saved.push(current);
    else if (op.op === 'Q') {
      if (saved.length) current = saved.pop()!;
    } else if (op.op === 'Tf' && op.operands[0]?.kind === 'name' && op.operands[1]) {
      const [name, size] = op.operands;
      current = { token: latin1(content.subarray(name.start, name.end)), name: name.name ?? '', size: latin1(content.subarray(size.start, size.end)) };
    } else if (TEXT_OPS.has(op.op)) {
      fonts.push(current);
    }
  }

  // Each new text goes right before the first glyph of the run it replaces —
  // or, once moved or resized, is drawn at its new spot in that run's font.
  const laidOut: Array<Insertion & { opIndex: number }> = [];
  const drawn: string[] = [];
  const placed = new Set<number>();
  for (const entry of inPlace) {
    const opIndex = plan.ops.findIndex((op) => op?.cover.includes(entry.cover));
    const op = opIndex >= 0 ? plan.ops[opIndex] : null;
    const font = opIndex >= 0 ? fonts[opIndex] : null;
    // Invisible text (an OCR layer over a scan) isn't what people see.
    if (!op || !font || op.renderMode === 3 || op.renderMode === 7) continue;
    const known = plan.glyphs.get(op.fontKey);
    const info = fontInfo(outPage, font.name);
    if (entry.place) {
      const operators = await drawAt(entry.place, op, known, info, font, outPage, entry.fallback);
      if (operators) {
        drawn.push(operators);
        placed.add(entry.cover);
      }
      continue;
    }
    const laid = await layoutInsertion(entry.text, op, known, info, font, outPage, entry.fallback);
    if (laid) laidOut.push({ opIndex, at: op.cover.indexOf(entry.cover), cover: entry.cover, ...laid });
  }

  // An operator that can't be rewritten keeps its text: the covers with
  // glyphs in it aren't clean, and any of those getting new text in place
  // get it the usual way instead (so it isn't drawn over the old one).
  const attempt = (allowed: Set<number>) => {
    const failed = new Set<number>();
    const pieces: string[] = [];
    let cursor = 0;
    let textIndex = 0;
    for (const op of ops) {
      if (!TEXT_OPS.has(op.op)) continue;
      const index = textIndex++;
      const opPlan = plan.ops[index];
      if (!opPlan || !opPlan.cover.some((c) => c >= 0)) continue;
      const here = laidOut.filter((insertion) => insertion.opIndex === index && allowed.has(insertion.cover));
      const replacement = rewrite(op, opPlan, content, fontInfo(outPage, fonts[index]?.name ?? null).codeWidth, here);
      if (replacement === null) {
        for (const c of opPlan.cover) if (c >= 0) failed.add(c);
        continue;
      }
      pieces.push(latin1(content.subarray(cursor, op.start)), replacement);
      cursor = op.end;
    }
    pieces.push(latin1(content.subarray(cursor)));
    return { failed, source: cursor === 0 ? null : pieces.join('') };
  };
  let allowed = new Set(laidOut.map((insertion) => insertion.cover));
  let outcome = attempt(allowed);
  if ([...allowed].some((c) => outcome.failed.has(c))) {
    allowed = new Set([...allowed].filter((c) => !outcome.failed.has(c)));
    outcome = attempt(allowed);
  }
  covers.forEach((_, k) => {
    if (reached[k] && !outcome.failed.has(k)) result.clean.add(k);
  });
  result.inserted = new Set([...allowed, ...placed]);
  if (outcome.source === null && !drawn.length) return result;

  // Text drawn at a new spot comes after everything else, from the page's
  // initial graphics state — the original content is wrapped so nothing it
  // leaves set (a transform, a clip) carries over.
  let source = outcome.source ?? latin1(content);
  if (drawn.length) source = `q\n${source}\nQ\n${drawn.join('\n')}\n`;
  const bytes = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) bytes[i] = source.charCodeAt(i) & 255;
  // The replaced stream, original text and all, is left for `buildPdf`'s
  // final sweep of unreachable objects to drop — deleting it here would also
  // break another page that happens to share it.
  outPage.node.set(PDFName.of('Contents'), context.register(context.flateStream(bytes)));
  return result;
}
