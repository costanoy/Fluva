import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * Fonts embedded in a PDF are frequently subset or non-redistributable, so text that
 * the user rewrites has to be drawn in a substitute. Three of the families below are
 * the PDF standard-14 fonts (Helvetica/Times/Courier), always available with zero
 * download cost. The rest are real, openly-licensed (SIL OFL / Apache) TrueType
 * families — several of them (Carlito, Caladea) are metric-compatible clones of
 * Calibri and Cambria specifically, so documents written in Word's own defaults get
 * an exact-width match instead of a merely similar-looking stand-in. Their files live
 * under public/fonts/<key>/ and are fetched on demand, only when actually picked or
 * needed for export — nothing here is loaded until a document asks for it.
 */
export interface SubstituteFamily {
  key: string;
  /** Name shown in the picker. */
  label: string;
  /** Font family used for the on-screen preview — matches the @font-face names in styles/fonts.css. */
  cssFamily: string;
  /** Original fonts this family is a metric-compatible replacement for. */
  metricMatches: string[];
  /** Originals with no exact metric twin that still map here as the closest match. */
  approximates: string[];
  /** Either one of the PDF's built-in standard-14 fonts, or a custom TrueType family fetched and embedded on demand. */
  source:
    | { type: 'standard'; regular: StandardFonts; bold: StandardFonts; italic: StandardFonts; boldItalic: StandardFonts }
    | { type: 'custom'; regular: string; bold: string; italic: string; boldItalic: string };
}

export const SUBSTITUTE_FAMILIES: SubstituteFamily[] = [
  {
    key: 'sans',
    label: 'Helvetica',
    cssFamily: 'Helvetica, Arial, sans-serif',
    metricMatches: ['Arial', 'Helvetica', 'Liberation Sans', 'Arimo', 'Nimbus Sans'],
    approximates: [],
    source: {
      type: 'standard',
      regular: StandardFonts.Helvetica,
      bold: StandardFonts.HelveticaBold,
      italic: StandardFonts.HelveticaOblique,
      boldItalic: StandardFonts.HelveticaBoldOblique,
    },
  },
  {
    key: 'serif',
    label: 'Times',
    cssFamily: '"Times New Roman", Times, serif',
    metricMatches: ['Times New Roman', 'Times', 'Liberation Serif', 'Tinos', 'Nimbus Roman'],
    approximates: [],
    source: {
      type: 'standard',
      regular: StandardFonts.TimesRoman,
      bold: StandardFonts.TimesRomanBold,
      italic: StandardFonts.TimesRomanItalic,
      boldItalic: StandardFonts.TimesRomanBoldItalic,
    },
  },
  {
    key: 'mono',
    label: 'Courier',
    cssFamily: '"Courier New", Courier, monospace',
    metricMatches: ['Courier New', 'Courier', 'Liberation Mono', 'Cousine', 'Nimbus Mono'],
    approximates: [],
    source: {
      type: 'standard',
      regular: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      boldItalic: StandardFonts.CourierBoldOblique,
    },
  },
  {
    key: 'carlito',
    label: 'Carlito',
    cssFamily: 'Carlito, Calibri, sans-serif',
    // Metric-identical clone of Calibri, Word's own default body font since 2007 —
    // documents written in it are extremely common, so this earns its own family
    // rather than falling back to the visually different Helvetica.
    metricMatches: ['Calibri', 'Carlito'],
    approximates: [],
    source: { type: 'custom', regular: '/fonts/carlito/Regular.ttf', bold: '/fonts/carlito/Bold.ttf', italic: '/fonts/carlito/Italic.ttf', boldItalic: '/fonts/carlito/BoldItalic.ttf' },
  },
  {
    key: 'caladea',
    label: 'Caladea',
    cssFamily: 'Caladea, Cambria, serif',
    // Metric-identical clone of Cambria, Word's default heading font.
    metricMatches: ['Cambria', 'Caladea'],
    approximates: ['Georgia'],
    source: { type: 'custom', regular: '/fonts/caladea/Regular.ttf', bold: '/fonts/caladea/Bold.ttf', italic: '/fonts/caladea/Italic.ttf', boldItalic: '/fonts/caladea/BoldItalic.ttf' },
  },
  {
    key: 'opensans',
    label: 'Open Sans',
    cssFamily: '"Open Sans", sans-serif',
    metricMatches: ['Open Sans'],
    approximates: ['Segoe UI', 'Verdana', 'Tahoma', 'PT Sans', 'Noto Sans'],
    source: { type: 'custom', regular: '/fonts/opensans/Regular.ttf', bold: '/fonts/opensans/Bold.ttf', italic: '/fonts/opensans/Italic.ttf', boldItalic: '/fonts/opensans/BoldItalic.ttf' },
  },
  {
    key: 'roboto',
    label: 'Roboto',
    cssFamily: 'Roboto, sans-serif',
    metricMatches: ['Roboto'],
    approximates: ['Droid Sans'],
    source: { type: 'custom', regular: '/fonts/roboto/Regular.ttf', bold: '/fonts/roboto/Bold.ttf', italic: '/fonts/roboto/Italic.ttf', boldItalic: '/fonts/roboto/BoldItalic.ttf' },
  },
  {
    key: 'lato',
    label: 'Lato',
    cssFamily: 'Lato, sans-serif',
    metricMatches: ['Lato'],
    approximates: [],
    source: { type: 'custom', regular: '/fonts/lato/Regular.ttf', bold: '/fonts/lato/Bold.ttf', italic: '/fonts/lato/Italic.ttf', boldItalic: '/fonts/lato/BoldItalic.ttf' },
  },
  {
    key: 'montserrat',
    label: 'Montserrat',
    cssFamily: 'Montserrat, sans-serif',
    metricMatches: ['Montserrat'],
    approximates: ['Century Gothic', 'Futura'],
    source: { type: 'custom', regular: '/fonts/montserrat/Regular.ttf', bold: '/fonts/montserrat/Bold.ttf', italic: '/fonts/montserrat/Italic.ttf', boldItalic: '/fonts/montserrat/BoldItalic.ttf' },
  },
  {
    key: 'nunito',
    label: 'Nunito',
    cssFamily: 'Nunito, sans-serif',
    metricMatches: ['Nunito'],
    approximates: ['Quicksand', 'Comfortaa'],
    source: { type: 'custom', regular: '/fonts/nunito/Regular.ttf', bold: '/fonts/nunito/Bold.ttf', italic: '/fonts/nunito/Italic.ttf', boldItalic: '/fonts/nunito/BoldItalic.ttf' },
  },
  {
    key: 'merriweather',
    label: 'Merriweather',
    cssFamily: 'Merriweather, serif',
    metricMatches: ['Merriweather'],
    approximates: ['Lora', 'Playfair Display'],
    source: { type: 'custom', regular: '/fonts/merriweather/Regular.ttf', bold: '/fonts/merriweather/Bold.ttf', italic: '/fonts/merriweather/Italic.ttf', boldItalic: '/fonts/merriweather/BoldItalic.ttf' },
  },
  {
    key: 'ptserif',
    label: 'PT Serif',
    cssFamily: '"PT Serif", serif',
    metricMatches: ['PT Serif'],
    approximates: ['Book Antiqua', 'Palatino', 'Bookman', 'Garamond'],
    source: { type: 'custom', regular: '/fonts/ptserif/Regular.ttf', bold: '/fonts/ptserif/Bold.ttf', italic: '/fonts/ptserif/Italic.ttf', boldItalic: '/fonts/ptserif/BoldItalic.ttf' },
  },
  {
    key: 'sourcecodepro',
    label: 'Source Code Pro',
    cssFamily: '"Source Code Pro", monospace',
    metricMatches: ['Source Code Pro'],
    approximates: ['Consolas', 'Monaco', 'Menlo', 'Fira Code', 'JetBrains Mono'],
    source: { type: 'custom', regular: '/fonts/sourcecodepro/Regular.ttf', bold: '/fonts/sourcecodepro/Bold.ttf', italic: '/fonts/sourcecodepro/Italic.ttf', boldItalic: '/fonts/sourcecodepro/BoldItalic.ttf' },
  },
];

export const DEFAULT_FAMILY_KEY = 'sans';

export function familyByKey(key: string): SubstituteFamily {
  return SUBSTITUTE_FAMILIES.find((f) => f.key === key) ?? SUBSTITUTE_FAMILIES[0];
}

/** PDF font names are often subset-tagged, e.g. "ABCDEF+Calibri-Bold". */
export function cleanFontName(raw: string | undefined | null): string {
  if (!raw) return '';
  let name = raw.replace(/^[A-Z]{6}\+/, '');
  name = name.replace(/[-_,](Bold|Italic|Oblique|Regular|Roman|Light|Medium|Semibold|BoldItalic|BoldOblique|MT|PS)+$/gi, '');
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

export interface FontMatch {
  family: SubstituteFamily;
  /** True when the substitute has identical metrics to the original. */
  exact: boolean;
}

export function matchSubstitute(originalName: string): FontMatch {
  const clean = cleanFontName(originalName).toLowerCase();
  if (clean) {
    for (const family of SUBSTITUTE_FAMILIES) {
      if (family.metricMatches.some((m) => clean.includes(m.toLowerCase()))) {
        return { family, exact: true };
      }
    }
    for (const family of SUBSTITUTE_FAMILIES) {
      if (family.approximates.some((m) => clean.includes(m.toLowerCase()))) {
        return { family, exact: false };
      }
    }
    // Fall back on the shape of the name when it is not a font we know by name.
    // This also covers the generic families pdf.js reports when a font's real
    // name cannot be resolved ("sans-serif", "serif", "monospace").
    if (/mono|code|consol|courier/.test(clean)) return { family: familyByKey('mono'), exact: false };
    if (/sans/.test(clean)) return { family: familyByKey('sans'), exact: false };
    if (/serif|times|georgia|garamond|book|roman|minion/.test(clean)) {
      return { family: familyByKey('serif'), exact: false };
    }
  }
  return { family: familyByKey('sans'), exact: false };
}

export function isBoldName(raw: string | undefined | null): boolean {
  return /bold|black|heavy|semibold|[-_]700|[-_]800|[-_]900/i.test(raw ?? '');
}

export function isItalicName(raw: string | undefined | null): boolean {
  return /italic|oblique/i.test(raw ?? '');
}

/**
 * Standard-14 fonts use WinAnsi (CP1252) encoding. Portuguese accents are covered,
 * but anything outside it (emoji, CJK, some typographic marks) would make pdf-lib
 * throw, so unsupported characters are folded to a close ASCII equivalent.
 *
 * Written with \u escapes throughout rather than the literal glyphs — several of
 * these (the space variants especially) are visually indistinguishable from one
 * another and from a plain ASCII space in an editor, which is a very easy way to
 * end up with silently-duplicated map keys.
 */
const WINANSI_FALLBACKS: Record<string, string> = {
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-',
  '…': '...', '•': '*',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '−': '-', '­': '', '​': '', '﻿': '',
  '′': "'", '″': '"', '‹': '<', '›': '>',
};

/** Characters WinAnsiEncoding (CP1252) can represent, beyond plain ASCII. */
const WINANSI_EXTRA = new Set<string>([
  // The CP1252 0x80-0x9F block maps to these specific, non-contiguous code points
  // (a handful of slots — 0x81, 0x8D, 0x8F, 0x90, 0x9D — are undefined and omitted).
  '€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ',
  '‰', 'Š', '‹', 'Œ', 'Ž', '‘', '’', '“',
  '”', '•', '–', '—', '˜', '™', 'š', '›',
  'œ', 'ž', 'Ÿ',
  // 0xA0-0xFF maps 1:1 onto Unicode U+00A0-U+00FF (Latin-1 Supplement).
  ...Array.from({ length: 0xff - 0xa0 + 1 }, (_, i) => String.fromCodePoint(0xa0 + i)),
]);

/**
 * Applied to every family, standard or custom — custom fonts could in principle
 * render more of Unicode than WinAnsi covers, but pdf-lib's behavior on a glyph
 * truly missing from a custom font isn't guaranteed the same safe way, so this
 * keeps every family on the one alphabet already known to always work.
 */
export function sanitizeForStandardFont(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out += ch;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    const mapped = WINANSI_FALLBACKS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    out += WINANSI_EXTRA.has(ch) ? ch : '?';
  }
  return out;
}

export interface EmbeddedFontSet {
  get(familyKey: string, bold: boolean, italic: boolean): Promise<PDFFont>;
}

/** Embeds standard and custom fonts lazily and caches them per output document. */
export function createFontSet(doc: PDFDocument): EmbeddedFontSet {
  const cache = new Map<string, Promise<PDFFont>>();
  let fontkitRegistered = false;

  return {
    get(familyKey, bold, italic) {
      const key = `${familyKey}|${bold ? 'b' : ''}${italic ? 'i' : ''}`;
      let entry = cache.get(key);
      if (!entry) {
        const family = familyByKey(familyKey);
        if (family.source.type === 'standard') {
          const variant = bold && italic ? family.source.boldItalic
            : bold ? family.source.bold
            : italic ? family.source.italic
            : family.source.regular;
          entry = doc.embedFont(variant);
        } else {
          const url = bold && italic ? family.source.boldItalic
            : bold ? family.source.bold
            : italic ? family.source.italic
            : family.source.regular;
          entry = (async () => {
            if (!fontkitRegistered) {
              doc.registerFontkit(fontkit);
              fontkitRegistered = true;
            }
            const bytes = await fetch(url).then((r) => r.arrayBuffer());
            return doc.embedFont(bytes, { subset: true });
          })();
        }
        cache.set(key, entry);
      }
      return entry;
    },
  };
}
