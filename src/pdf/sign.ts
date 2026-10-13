import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { getLang, t } from '../i18n/translations';

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
function findAsciiOffset(bytes: Uint8Array, pattern: string): number {
  const text = new TextDecoder('latin1').decode(bytes);
  return text.indexOf(pattern);
}

/**
 * Adds the /Sig, /Widget and /AcroForm structure pdf-lib doesn't have a
 * high-level API for (form-filling libraries rarely support signature
 * fields specifically), reserving fixed-width placeholders for /ByteRange
 * and /Contents so they can be patched in place afterward without shifting
 * any other byte offset in the file.
 */
async function addSignaturePlaceholder(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const { context, catalog } = pdfDoc;
  const page = pdfDoc.getPage(0);

  const sigDict = context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: [0, BYTE_RANGE_PLACEHOLDER, BYTE_RANGE_PLACEHOLDER, BYTE_RANGE_PLACEHOLDER],
    Contents: PDFHexString.of(CONTENTS_PLACEHOLDER_HEX),
    M: PDFString.of(pdfDate(new Date())),
  });
  const sigRef = context.register(sigDict);

  const widgetDict = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    // A zero-size rect is the standard way to add a non-visual signature —
    // present and valid, but nothing is drawn on the page for it.
    Rect: [0, 0, 0, 0],
    F: 4, // Print — several validators warn on signature widgets missing it.
    V: sigRef,
    T: PDFString.of('Assinatura1'),
    P: page.ref,
  });
  const widgetRef = context.register(widgetDict);
  page.node.addAnnot(widgetRef);

  // Merges into an existing /AcroForm if the source PDF already had one
  // (e.g. from other form fields) rather than clobbering it.
  const acroForm = catalog.getOrCreateAcroForm();
  acroForm.addField(widgetRef);
  acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3)); // SignaturesExist | AppendOnly

  // Object streams would compress /ByteRange and /Contents away as binary,
  // making them unfindable as the literal text the next step searches for.
  return pdfDoc.save({ useObjectStreams: false });
}

/** Rewrites the placeholder /ByteRange with the real byte spans (same total
 * width, so nothing shifts), and returns the exact bytes that get hashed
 * and signed — everything in the file except the /Contents value, its
 * `<` `>` delimiters included (the convention Acrobat and the PAdES
 * validators check the gap against). */
function computeByteRangeAndSignedRegion(bytes: Uint8Array): { patched: Uint8Array; signedRegion: Uint8Array; contentsHexStart: number } {
  const contentsPattern = `<${CONTENTS_PLACEHOLDER_HEX}`;
  const ltIdx = findAsciiOffset(bytes, contentsPattern);
  if (ltIdx === -1) throw new SignPdfError(t('sign.placeholderNotFound'));
  const afterGt = ltIdx + contentsPattern.length + 1; // first byte after the closing '>'
  const contentsHexStart = ltIdx + 1;

  // The array's first element is always the literal `0` written by
  // `addSignaturePlaceholder` (not a placeholder value) — only the other
  // three were given the wide placeholder number.
  const byteRangePlaceholderText = `0 ${Array(3).fill(String(BYTE_RANGE_PLACEHOLDER)).join(' ')}`;
  const brIdx = findAsciiOffset(bytes, byteRangePlaceholderText);
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
 * password, returning a new PDF with a PAdES-B signature embedded. Never
 * transmits the certificate or password anywhere — everything happens
 * in-memory, client-side.
 */
export async function signPdf(pdfBytes: Uint8Array, pfxBytes: Uint8Array, password: string): Promise<SignResult> {
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

  const withPlaceholder = await addSignaturePlaceholder(pdfBytes);
  const { patched, signedRegion, contentsHexStart } = computeByteRangeAndSignedRegion(withPlaceholder);
  const signedAt = new Date();
  const signatureHex = await buildCmsSignature(forge, signedRegion, privateKey, certificate, chain);
  if (signatureHex.length > CONTENTS_PLACEHOLDER_HEX.length) throw new SignPdfError(t('sign.signatureTooLarge'));
  const paddedHex = signatureHex.padEnd(CONTENTS_PLACEHOLDER_HEX.length, '0');
  patched.set(new TextEncoder().encode(paddedHex), contentsHexStart);
  return { bytes: patched, signer: describeSigner(certificate), signedAt };
}
