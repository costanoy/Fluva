import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';

/**
 * Fonts embedded in a PDF are frequently subset or non-redistributable, so text that
 * the user rewrites has to be drawn in a substitute. The three families below are the
 * PDF standard-14 fonts, which are *metrically identical* to the Microsoft fonts they
 * replace — line breaks and text width are preserved exactly.
 */
export interface SubstituteFamily {
  key: string;
  /** Name shown in the picker. */
  label: string;
  /** Font family used for the on-screen preview. */
  cssFamily: string;
  /** Original fonts this family is a metric-compatible replacement for. */
  metricMatches: string[];
  /** Originals with no exact metric twin that still map here as the closest match. */
  approximates: string[];
  standard: {
    regular: StandardFonts;
    bold: StandardFonts;
    italic: StandardFonts;
    boldItalic: StandardFonts;
  };
}

export const SUBSTITUTE_FAMILIES: SubstituteFamily[] = [
  {
    key: 'sans',
    label: 'Helvetica',
    cssFamily: 'Helvetica, Arial, sans-serif',
    metricMatches: ['Arial', 'Helvetica', 'Liberation Sans', 'Arimo', 'Nimbus Sans'],
    approximates: ['Calibri', 'Carlito', 'Verdana', 'Tahoma', 'Segoe UI', 'Open Sans', 'Roboto'],
    standard: {
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
    approximates: ['Cambria', 'Caladea', 'Georgia', 'Garamond', 'Book Antiqua', 'Palatino'],
    standard: {
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
    approximates: ['Consolas', 'Monaco', 'Menlo', 'Source Code Pro'],
    standard: {
      regular: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      boldItalic: StandardFonts.CourierBoldOblique,
    },
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
 * Standard-14 fonts use WinAnsi encoding. Portuguese accents are covered, but
 * anything outside it (emoji, CJK, some typographic marks) would make pdf-lib throw,
 * so unsupported characters are folded to a close ASCII equivalent.
 */
const WINANSI_FALLBACKS: Record<string, string> = {
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-',
  '…': '...', '•': '*', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '−': '-', '­': '', '​': '', '﻿': '',
  '′': "'", '″': '"', '‹': '<', '›': '>',
};

/** Characters WinAnsiEncoding can represent, beyond plain ASCII. */
const WINANSI_EXTRA = new Set(
  ('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿' +
    'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ').split(''),
);

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

/** Embeds standard fonts lazily and caches them per output document. */
export function createFontSet(doc: PDFDocument): EmbeddedFontSet {
  const cache = new Map<string, Promise<PDFFont>>();
  return {
    get(familyKey, bold, italic) {
      const key = `${familyKey}|${bold ? 'b' : ''}${italic ? 'i' : ''}`;
      let entry = cache.get(key);
      if (!entry) {
        const family = familyByKey(familyKey);
        const variant = bold && italic ? family.standard.boldItalic
          : bold ? family.standard.bold
          : italic ? family.standard.italic
          : family.standard.regular;
        entry = doc.embedFont(variant);
        cache.set(key, entry);
      }
      return entry;
    },
  };
}
