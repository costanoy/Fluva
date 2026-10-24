import { FontNames } from '@pdf-lib/standard-fonts';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFontEmbedder, type PDFContext } from 'pdf-lib';
import { getLang, t } from '../i18n/translations';
import { displayRectToRaw, displayedSize, normalizeRotation } from './geometry';
import { appendUpdate, lastXref } from './incremental';

export class SignPdfError extends Error {
  constructor(
    message: string,
    /** Set only for the one failure the dialog handles inline (7a). */
    public readonly code?: 'wrong-password',
  ) {
    super(message);
  }
}

/** Read straight from the signer's own certificate — shown back to the user
 * once signing succeeds, nothing here is invented or looked up elsewhere. */
export interface SignerInfo {
  name: string | null;
  /** ICP-Brasil e-CPF certificates carry the CPF after the name in the CN
   * ("NOME:12345678900") — masked here, never kept whole. */
  cpfMasked: string | null;
  validUntil: Date | null;
  icpBrasil: boolean;
}

export interface SignResult {
  bytes: Uint8Array;
  signer: SignerInfo;
  signedAt: Date;
}

export type StampCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** Where the signature shows on the page: a stamp with who signed and when. */
export interface StampPlacement {
  /** 0-based. */
  page: number;
  corner: StampCorner;
}

function describeSigner(certificate: import('node-forge').pki.Certificate): SignerInfo {
  const cn = certificate.subject.getField('CN')?.value as string | undefined;
  let name: string | null = cn?.trim() || null;
  let cpfMasked: string | null = null;
  const m = cn?.match(/^(.*?):(\d{11})$/);
  if (m) {
    name = m[1].trim() || null;
    const d = m[2];
    cpfMasked = `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  }
  const issuerOrg = certificate.issuer.getField('O')?.value as string | undefined;
  return {
    name,
    cpfMasked,
    validUntil: certificate.validity?.notAfter ?? null,
    icpBrasil: !!issuerOrg && /icp-brasil/i.test(issuerOrg),
  };
}

/**
 * PAdES-B signing: the user supplies their own already-issued ICP-Brasil A1
 * certificate (.pfx/.p12); this only packages a correct signature with it.
 * The legal standing of the result comes entirely from the certificate being
 * genuinely ICP-Brasil-issued — nothing here vouches for that.
 *
 * Built on pdf-lib for the PDF-side structure (it already gets xref/trailer
 * serialization right, so there's no need to hand-write an incremental PDF
 * update from scratch) and node-forge for the actual cryptography (parsing
 * the PKCS#12 file and building the CMS/PKCS#7 SignedData — genuinely
 * browser-safe, unlike most Node-oriented PDF-signing libraries, which lean
 * on `Buffer` and often on a second heavy PDF-construction library besides).
 * Both are loaded lazily, on the rare occasion this is actually called, not
 * at module load like the rest of `pdf/`'s heavier dependencies.
 *
 * Targets PAdES-B only (signature + signing time) — no trusted-timestamp
 * (PAdES-T) or long-term-validation (PAdES-LTV) support, both of which need
 * a network call to a timestamp authority and are a deliberately separate,
 * later piece of work.
 */

/** Bytes reserved for the CMS/PKCS#7 signature — comfortably fits a real
 * RSA-2048 signature plus a typical ICP-Brasil certificate chain. Fixed and
 * generous on purpose: the placeholder written now and the real signature
 * spliced in later must be exactly the same byte length, or every offset
 * after it in the file would shift. */
const SIGNATURE_RESERVED_BYTES = 8192;
const CONTENTS_PLACEHOLDER_HEX = '0'.repeat(SIGNATURE_RESERVED_BYTES * 2);

/** Same fixed-width reasoning as above, applied to `/ByteRange`'s own four
 * numbers — reserved wide enough that any real offset in a file up to
 * Fluva's own 50MB upload cap still fits once written in, later, in place. */
const BYTE_RANGE_PLACEHOLDER = 9_999_999_999;
const BYTE_RANGE_WIDTH = String(BYTE_RANGE_PLACEHOLDER).length;

/** PDF date with the UTC offset spelled out — PAdES takes the signing time
 * from this /M entry, and without an offset a reader has to guess the zone. */
function pdfDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const zone = offset === 0 ? 'Z' : `${offset > 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}'${pad(Math.abs(offset) % 60)}'`;
  return `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${zone}`;
}

/** Locates a byte-exact ASCII pattern in the (mostly-binary) PDF buffer.
 * Decoding the whole buffer as latin1 first, rather than scanning byte by
 * byte, is what keeps this fast even on a large file — latin1 maps each
 * byte to exactly one JS UTF-16 code unit, so the resulting string's own
 * (native, optimized) `indexOf` gives back a true byte offset directly. */
function findAsciiOffset(bytes: Uint8Array, pattern: string, from = 0): number {
  const at = new TextDecoder('latin1').decode(bytes.subarray(from)).indexOf(pattern);
  return at === -1 ? -1 : from + at;
}

/** A field name the document doesn't use yet: "Assinatura1", "Assinatura2"... */
function freeFieldName(context: PDFContext, fields: PDFArray): string {
  const used = new Set<string>();
  const walk = (array: PDFArray) => {
    for (const item of array.asArray()) {
      const field = context.lookup(item);
      if (!(field instanceof PDFDict)) continue;
      const name = field.lookup(PDFName.of('T'));
      if (name instanceof PDFString || name instanceof PDFHexString) used.add(name.decodeText());
      const kids = field.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray) walk(kids);
    }
  };
  walk(fields);
  let n = 1;
  while (used.has(`Assinatura${n}`)) n++;
  return `Assinatura${n}`;
}

/** A document its author certified as final (DocMDP, no changes allowed):
 * any signature added would break the certification. */
function certifiedWithoutChanges(context: PDFContext, catalog: PDFDict): boolean {
  const perms = catalog.lookup(PDFName.of('Perms'));
  const docMdp = perms instanceof PDFDict ? perms.lookup(PDFName.of('DocMDP')) : undefined;
  const refs = docMdp instanceof PDFDict ? docMdp.lookup(PDFName.of('Reference')) : undefined;
  if (!(refs instanceof PDFArray)) return false;
  return refs.asArray().some((item) => {
    const ref = context.lookup(item);
    if (!(ref instanceof PDFDict) || ref.lookup(PDFName.of('TransformMethod')) !== PDFName.of('DocMDP')) return false;
    const params = ref.lookup(PDFName.of('TransformParams'));
    const p = params instanceof PDFDict ? params.lookup(PDFName.of('P')) : undefined;
    return p instanceof PDFNumber && p.asNumber() === 1;
  });
}

/** How big the stamp is, in points: about a business card's third. */
const STAMP = { width: 244, height: 74, margin: 24 };

/** The stamp's text: who signed and when, and where to check it. */
function stampLines(signer: SignerInfo, signedAt: Date): Array<{ text: string; bold?: boolean; size: number; muted?: boolean }> {
  const offset = -signedAt.getTimezoneOffset();
  const zone = `UTC${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  const when = new Intl.DateTimeFormat(getLang() === 'pt' ? 'pt-BR' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(signedAt);
  return [
    { text: t('stamp.signedBy'), size: 7.5, muted: true },
    { text: signer.name ?? '—', bold: true, size: 10.5 },
    ...(signer.cpfMasked ? [{ text: t('stamp.cpf', { cpf: signer.cpfMasked }), size: 8 }] : []),
    { text: t('stamp.date', { date: `${when} (${zone})` }), size: 8 },
    { text: t('stamp.verify'), size: 7, muted: true },
  ];
}

/**
 * The stamp's appearance: a form drawn upright as the page is seen (its
 * /Matrix turns it against the page's /Rotate), in Helvetica, which every
 * PDF reader has — nothing needs embedding.
 */
function stampAppearance(context: PDFContext, lines: ReturnType<typeof stampLines>, rotation: number): PDFRef {
  const regular = StandardFontEmbedder.for(FontNames.Helvetica);
  const bold = StandardFontEmbedder.for(FontNames.HelveticaBold);
  const regularRef = regular.embedIntoContext(context) as PDFRef;
  const boldRef = bold.embedIntoContext(context) as PDFRef;
  const { width: w, height: h } = STAMP;
  const ops: string[] = [
    'q',
    '1 1 1 rg',
    `0 0 ${w} ${h} re f`,
    '0.114 0.62 0.459 RG 1.2 w',
    `0.6 0.6 ${w - 1.2} ${h - 1.2} re S`,
    '0.114 0.62 0.459 rg',
    `0 0 5 ${h} re f`,
  ];
  // Spread over the height, top to bottom.
  const step = (h - 12) / lines.length;
  lines.forEach((line, i) => {
    const font = line.bold ? bold : regular;
    // Only what the font can show (Latin-1, as names here are).
    const text = Array.from(line.text)
      .map((ch) => (font.encoding.canEncodeUnicodeCodePoint(ch.codePointAt(0)!) ? ch : '?'))
      .join('');
    let size = line.size;
    const room = w - 22;
    const width = font.widthOfTextAtSize(text, size);
    if (width > room) size = Math.max(5, (size * room) / width);
    const y = h - 6 - step * (i + 0.5) - size * 0.35;
    const color = line.muted ? '0.36 0.35 0.33' : '0.12 0.11 0.1';
    ops.push(`BT /${line.bold ? 'F2' : 'F1'} ${size.toFixed(2)} Tf ${color} rg 14 ${y.toFixed(2)} Td ${font.encodeText(text).toString()} Tj ET`);
  });
  ops.push('Q');
  const matrix = rotation === 90 ? [0, 1, -1, 0, 0, 0] : rotation === 180 ? [-1, 0, 0, -1, 0, 0] : rotation === 270 ? [0, -1, 1, 0, 0, 0] : [1, 0, 0, 1, 0, 0];
  const stream = context.flateStream(ops.join('\n'), {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, w, h],
    Matrix: matrix,
    Resources: { Font: { F1: regularRef, F2: boldRef } },
  });
  return context.register(stream);
}

/** The rects (in page space) of the signatures already shown on a page. */
function signatureRects(context: PDFContext, annots: PDFArray | undefined): number[][] {
  if (!annots) return [];
  return annots.asArray().flatMap((item) => {
    const annot = context.lookup(item);
    if (!(annot instanceof PDFDict) || annot.lookup(PDFName.of('Subtype')) !== PDFName.of('Widget')) return [];
    const rect = annot.lookup(PDFName.of('Rect'));
    if (!(rect instanceof PDFArray)) return [];
    const [x0, y0, x1, y1] = rect.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0));
    return Math.abs(x1 - x0) > 1 && Math.abs(y1 - y0) > 1 ? [[Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]] : [];
  });
}

/**
 * Adds the signature to `base` as an incremental update (see incremental.ts):
 * the signature dictionary, with fixed-width placeholders for /ByteRange and
 * /Contents to be patched in place once the signature is made; its field and
 * widget — a stamp on the page, or nothing visible; the page and the form
 * pointing at them. Everything else in the file stays exactly as it was, so
 * the signatures it already has stay valid.
 */
async function addSignatureUpdate(base: Uint8Array, signer: SignerInfo, signedAt: Date, stamp: StampPlacement | null): Promise<Uint8Array> {
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const { context, catalog } = doc;
  const xref = lastXref(base);
  // New objects get numbers the file has never used.
  context.largestObjectNumber = Math.max(context.largestObjectNumber, xref.size - 1);
  const firstNew = context.largestObjectNumber + 1;
  if (certifiedWithoutChanges(context, catalog)) throw new SignPdfError(t('sign.certifiedNoChanges'));

  const changed: PDFRef[] = [];
  const rootRef = context.trailerInfo.Root as PDFRef;

  // The form: its own object, inside the catalog, or none yet.
  let acroForm: PDFDict;
  const acroRaw = catalog.get(PDFName.of('AcroForm'));
  if (acroRaw instanceof PDFRef) {
    acroForm = context.lookup(acroRaw, PDFDict);
    changed.push(acroRaw);
  } else if (acroRaw instanceof PDFDict) {
    acroForm = acroRaw;
    changed.push(rootRef);
  } else {
    acroForm = context.obj({});
    catalog.set(PDFName.of('AcroForm'), context.register(acroForm));
    changed.push(rootRef);
  }
  let fields: PDFArray;
  const fieldsRaw = acroForm.get(PDFName.of('Fields'));
  if (fieldsRaw instanceof PDFRef) {
    fields = context.lookup(fieldsRaw, PDFArray);
    changed.push(fieldsRaw);
  } else if (fieldsRaw instanceof PDFArray) {
    fields = fieldsRaw;
  } else {
    fields = context.obj([]);
    acroForm.set(PDFName.of('Fields'), fields);
  }

  const pageIndex = Math.max(0, Math.min(doc.getPageCount() - 1, stamp?.page ?? 0));
  const page = doc.getPage(pageIndex);
  const annotsRaw = page.node.get(PDFName.of('Annots'));
  const annots = annotsRaw instanceof PDFRef ? context.lookup(annotsRaw, PDFArray) : annotsRaw instanceof PDFArray ? annotsRaw : undefined;

  // A zero-size rect is the standard way to add a signature with nothing
  // drawn for it; a stamp sits in the chosen corner, as the page is seen —
  // moved along the edge if another signature's stamp is there already.
  let rect = [0, 0, 0, 0];
  let appearance: PDFRef | undefined;
  if (stamp) {
    const rotation = normalizeRotation(page.getRotation().angle);
    const box = page.getCropBox();
    const shown = displayedSize(rotation, box.width, box.height);
    const { width: w, height: h, margin } = STAMP;
    const taken = signatureRects(context, annots);
    const right = stamp.corner.endsWith('right');
    const bottom = stamp.corner.startsWith('bottom');
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = right ? shown.width - w - margin : margin;
      const y = bottom ? margin + attempt * (h + 8) : shown.height - h - margin - attempt * (h + 8);
      const raw = displayRectToRaw(rotation, box.width, box.height, { x, y, width: w, height: h });
      rect = [box.x + raw.x, box.y + raw.y, box.x + raw.x + raw.width, box.y + raw.y + raw.height];
      const overlaps = taken.some(([x0, y0, x1, y1]) => rect[0] < x1 && rect[2] > x0 && rect[1] < y1 && rect[3] > y0);
      if (!overlaps) break;
    }
    appearance = stampAppearance(context, stampLines(signer, signedAt), rotation);
  }

  const sigRef = context.register(
    context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'ETSI.CAdES.detached',
      ByteRange: [0, BYTE_RANGE_PLACEHOLDER, BYTE_RANGE_PLACEHOLDER, BYTE_RANGE_PLACEHOLDER],
      Contents: PDFHexString.of(CONTENTS_PLACEHOLDER_HEX),
      M: PDFString.of(pdfDate(signedAt)),
    }),
  );
  const widgetRef = context.register(
    context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      Rect: rect,
      F: 4, // Print — several validators warn on signature widgets missing it.
      V: sigRef,
      T: PDFString.of(freeFieldName(context, fields)),
      P: page.ref,
      ...(appearance ? { AP: { N: appearance } } : {}),
    }),
  );

  // The page lists the widget among its annotations — written straight into
  // /Annots: pdf-lib's own `addAnnot` would also rewrap the page's content
  // streams, a change to the page an earlier signature would object to.
  if (annotsRaw instanceof PDFRef) {
    annots!.push(widgetRef);
    changed.push(annotsRaw);
  } else if (annots) {
    annots.push(widgetRef);
    changed.push(page.ref);
  } else {
    page.node.set(PDFName.of('Annots'), context.obj([widgetRef]));
    changed.push(page.ref);
  }
  fields.push(widgetRef);
  acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3)); // SignaturesExist | AppendOnly

  for (const [ref] of context.enumerateIndirectObjects()) if (ref.objectNumber >= firstNew) changed.push(ref);
  return appendUpdate(base, doc, changed, xref);
}

/** Rewrites the placeholder /ByteRange with the real byte spans (same total
 * width, so nothing shifts), and returns the exact bytes that get hashed
 * and signed — everything in the file except the /Contents value, its
 * `<` `>` delimiters included (the convention Acrobat and the PAdES
 * validators check the gap against). Only looked for after `from`, where
 * the update starts: what came before is the original, untouched. */
function computeByteRangeAndSignedRegion(bytes: Uint8Array, from: number): { patched: Uint8Array; signedRegion: Uint8Array; contentsHexStart: number } {
  const contentsPattern = `<${CONTENTS_PLACEHOLDER_HEX}`;
  const ltIdx = findAsciiOffset(bytes, contentsPattern, from);
  if (ltIdx === -1) throw new SignPdfError(t('sign.placeholderNotFound'));
  const afterGt = ltIdx + contentsPattern.length + 1; // first byte after the closing '>'
  const contentsHexStart = ltIdx + 1;

  // The array's first element is always the literal `0` written by
  // `addSignatureUpdate` (not a placeholder value) — only the other three
  // were given the wide placeholder number.
  const byteRangePlaceholderText = `0 ${Array(3).fill(String(BYTE_RANGE_PLACEHOLDER)).join(' ')}`;
  const brIdx = findAsciiOffset(bytes, byteRangePlaceholderText, from);
  if (brIdx === -1) throw new SignPdfError(t('sign.placeholderNotFound'));

  const byteRange = [0, ltIdx, afterGt, bytes.length - afterGt];
  const byteRangeText = `0 ${byteRange.slice(1).map((n) => String(n).padEnd(BYTE_RANGE_WIDTH, ' ')).join(' ')}`;

  const patched = new Uint8Array(bytes);
  patched.set(new TextEncoder().encode(byteRangeText), brIdx);

  const signedRegion = new Uint8Array(byteRange[1] + byteRange[3]);
  signedRegion.set(patched.subarray(0, byteRange[1]), 0);
  signedRegion.set(patched.subarray(byteRange[2], byteRange[2] + byteRange[3]), byteRange[1]);

  return { patched, signedRegion, contentsHexStart };
}

/** node-forge's own `ArrayBufferView` type is a minimal structural interface
 * a real `Uint8Array` already satisfies at runtime (`.buffer`/`.byteLength`)
 * — this just helps TypeScript's overload resolution see that, rather than
 * casting to a type (`ArrayBuffer`) it doesn't actually have. */
function toArrayBufferView(bytes: Uint8Array): import('node-forge').util.ArrayBufferView {
  // TS types `Uint8Array.buffer` as `ArrayBufferLike` (which also admits
  // `SharedArrayBuffer`) where forge's declared type wants a plain
  // `ArrayBuffer` specifically — bytes handled by this module always come
  // from a regular `ArrayBuffer` (file reads, PDF byte arrays), never a
  // shared one, so this narrowing is safe in practice.
  return bytes as unknown as import('node-forge').util.ArrayBufferView;
}

type Forge = typeof import('node-forge');
type Certificate = import('node-forge').pki.Certificate;
type RsaPrivateKey = import('node-forge').pki.rsa.PrivateKey;

/** ESS signing-certificate-v2 (RFC 5035) — the attribute PAdES baseline
 * requires so a validator can tie the signature to exactly one certificate. */
const OID_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';

/** SHA-256 as a forge binary string. WebCrypto when available (every secure
 * context, which a signing page always is): it hashes a 50MB file in a blink,
 * where forge's pure-JS digest takes seconds. */
async function sha256Binary(forge: Forge, data: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
    let bin = '';
    for (const byte of digest) bin += String.fromCharCode(byte);
    return bin;
  }
  const md = forge.md.sha256.create();
  md.update(forge.util.createBuffer(toArrayBufferView(data)).getBytes());
  return md.digest().getBytes();
}

function formatCertDate(d: Date): string {
  return new Intl.DateTimeFormat(getLang() === 'pt' ? 'pt-BR' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** Opens the .pfx and returns the private key with the certificate that
 * actually pairs with it — a .pfx can bundle the issuing chain too, so the
 * match is made by comparing RSA moduli, the way signing tools do. */
function openPkcs12(forge: Forge, pfxBytes: Uint8Array, password: string): { privateKey: RsaPrivateKey; certificate: Certificate; chain: Certificate[] } {
  let p12;
  try {
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(toArrayBufferView(pfxBytes)));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  } catch (err) {
    // An elliptic-curve key opens fine with the right password but can't be
    // read by forge, which only speaks RSA — that is not a password problem.
    if (err instanceof Error && /RSAPrivateKey|Unknown OID|not RSA/i.test(err.message)) {
      throw new SignPdfError(t('sign.unsupportedKey'));
    }
    throw new SignPdfError(t('sign.wrongPasswordOrFile'), 'wrong-password');
  }

  const { oids } = forge.pki;
  const chain = (p12.getBags({ bagType: oids.certBag })[oids.certBag] ?? [])
    .map((bag) => bag.cert)
    .filter((cert): cert is Certificate => !!cert);
  // Most .pfx files wrap the key in a password-encrypted bag, but some
  // exporters store it as a plain keyBag inside the (still MAC-protected) file.
  const keys = [
    ...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? []),
  ]
    .map((bag) => bag.key as RsaPrivateKey | undefined)
    .filter((key): key is RsaPrivateKey => !!key);
  if (!keys.length) throw new SignPdfError(t('sign.noPrivateKey'));
  if (!chain.length) throw new SignPdfError(t('sign.noCertificate'));

  for (const privateKey of keys) {
    if (!privateKey.n) throw new SignPdfError(t('sign.unsupportedKey'));
    const certificate = chain.find((cert) => (cert.publicKey as import('node-forge').pki.rsa.PublicKey).n?.equals(privateKey.n));
    if (certificate) return { privateKey, certificate, chain };
  }
  return { privateKey: keys[0], certificate: chain[0], chain };
}

/**
 * Builds the detached CMS SignedData by hand rather than through
 * `forge.pkcs7`, whose signer only knows the contentType / messageDigest /
 * signingTime attributes. PAdES baseline (ETSI EN 319 142-1, B-B level)
 * needs exactly the opposite on two counts: the ESS signing-certificate-v2
 * attribute must be present, and signing-time must not be (the claimed time
 * is the signature dictionary's /M instead).
 */
async function buildCmsSignature(
  forge: Forge,
  signedRegion: Uint8Array,
  privateKey: RsaPrivateKey,
  certificate: Certificate,
  chain: Certificate[],
): Promise<string> {
  const { asn1, pki } = forge;
  const { oids } = pki;
  const U = asn1.Class.UNIVERSAL;
  const T = asn1.Type;
  const oid = (id: string) => asn1.create(U, T.OID, false, asn1.oidToDer(id).getBytes());
  const seq = (value: import('node-forge').asn1.Asn1[]) => asn1.create(U, T.SEQUENCE, true, value);
  const set = (value: import('node-forge').asn1.Asn1[]) => asn1.create(U, T.SET, true, value);
  const octets = (bin: string) => asn1.create(U, T.OCTETSTRING, false, bin);
  const nul = () => asn1.create(U, T.NULL, false, '');
  const integer = (bin: string) => asn1.create(U, T.INTEGER, false, bin);
  const attribute = (type: string, value: import('node-forge').asn1.Asn1) => seq([oid(type), set([value])]);
  const sha256AlgorithmId = () => seq([oid(oids.sha256), nul()]);

  const certDer = asn1.toDer(pki.certificateToAsn1(certificate)).getBytes();
  const certHash = forge.md.sha256.create().update(certDer).digest().getBytes();

  // ESSCertIDv2 with the hash algorithm left at its SHA-256 default (so it is
  // omitted, as DER requires) and no issuerSerial, as CAdES baseline advises.
  const signingCertificateV2 = seq([seq([seq([octets(certHash)])])]);

  // DER encodes a SET OF in ascending order of its members' encodings, and the
  // signature covers exactly that encoding — so sort before signing.
  const signedAttributes = [
    attribute(oids.contentType, oid(oids.data)),
    attribute(oids.messageDigest, octets(await sha256Binary(forge, signedRegion))),
    attribute(OID_SIGNING_CERTIFICATE_V2, signingCertificateV2),
  ]
    .map((attr) => ({ attr, der: asn1.toDer(attr).getBytes() }))
    .sort((a, b) => (a.der < b.der ? -1 : a.der > b.der ? 1 : 0))
    .map(({ attr }) => attr);

  const attributesDigest = forge.md.sha256.create();
  attributesDigest.update(asn1.toDer(set(signedAttributes)).getBytes());
  const signature = privateKey.sign(attributesDigest);

  const signerInfo = seq([
    integer(asn1.integerToDer(1).getBytes()),
    seq([pki.distinguishedNameToAsn1(certificate.issuer), integer(forge.util.hexToBytes(certificate.serialNumber))]),
    sha256AlgorithmId(),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, signedAttributes),
    seq([oid(oids.rsaEncryption), nul()]),
    octets(signature),
  ]);

  const signedData = seq([
    integer(asn1.integerToDer(1).getBytes()),
    set([sha256AlgorithmId()]),
    seq([oid(oids.data)]),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, chain.map((cert) => pki.certificateToAsn1(cert))),
    set([signerInfo]),
  ]);

  const contentInfo = seq([oid(oids.signedData), asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [signedData])]);
  return forge.util.bytesToHex(asn1.toDer(contentInfo).getBytes());
}

/**
 * Signs `pdfBytes` with the given PKCS#12 (.pfx/.p12) certificate and
 * password, returning the PDF with a PAdES-B signature added — as an
 * incremental update, so any signature it already has stays valid — and,
 * with `stamp`, shown on the page. Never transmits the certificate or
 * password anywhere — everything happens in-memory, client-side.
 */
export async function signPdf(pdfBytes: Uint8Array, pfxBytes: Uint8Array, password: string, stamp: StampPlacement | null = null): Promise<SignResult> {
  const forge = await import('node-forge');
  const { privateKey, certificate, chain } = openPkcs12(forge, pfxBytes, password);

  // A signature from an expired (or not yet valid) certificate is rejected by
  // every validator — refuse up front instead of handing over a dud file.
  const now = new Date();
  if (now > certificate.validity.notAfter) {
    throw new SignPdfError(t('sign.certExpired', { date: formatCertDate(certificate.validity.notAfter) }));
  }
  if (now < certificate.validity.notBefore) {
    throw new SignPdfError(t('sign.certNotYetValid', { date: formatCertDate(certificate.validity.notBefore) }));
  }

  const signer = describeSigner(certificate);
  // One moment for the stamp, the /M entry and the done screen alike.
  const signedAt = new Date();
  const withPlaceholder = await addSignatureUpdate(pdfBytes, signer, signedAt, stamp);
  const { patched, signedRegion, contentsHexStart } = computeByteRangeAndSignedRegion(withPlaceholder, pdfBytes.length);
  const signatureHex = await buildCmsSignature(forge, signedRegion, privateKey, certificate, chain);
  if (signatureHex.length > CONTENTS_PLACEHOLDER_HEX.length) throw new SignPdfError(t('sign.signatureTooLarge'));
  const paddedHex = signatureHex.padEnd(CONTENTS_PLACEHOLDER_HEX.length, '0');
  patched.set(new TextEncoder().encode(paddedHex), contentsHexStart);
  return { bytes: patched, signer, signedAt };
}

/** What the signing dialog tells the person beforehand: how many signatures
 * a PDF already has, and whether it's encrypted (it then can't be signed as
 * it is — see `untouchedPdfBytes`). */
export async function pdfSignatureInfo(bytes: Uint8Array): Promise<{ signatures: number; encrypted: boolean }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const { context } = doc;
  const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'));
  const fields = acroForm instanceof PDFDict ? acroForm.lookup(PDFName.of('Fields')) : undefined;
  let signatures = 0;
  const walk = (array: PDFArray, inheritedType: unknown) => {
    for (const item of array.asArray()) {
      const field = context.lookup(item);
      if (!(field instanceof PDFDict)) continue;
      const type = field.lookup(PDFName.of('FT')) ?? inheritedType;
      if (type === PDFName.of('Sig') && field.get(PDFName.of('V'))) signatures++;
      const kids = field.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray) walk(kids, type);
    }
  };
  if (fields instanceof PDFArray) walk(fields, undefined);
  return { signatures, encrypted: doc.isEncrypted };
}
