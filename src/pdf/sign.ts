import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { t } from '../i18n/translations';

export class SignPdfError extends Error {}

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

function pdfDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
 * and signed — everything in the file except the /Contents hex digits
 * themselves. */
function computeByteRangeAndSignedRegion(bytes: Uint8Array): { patched: Uint8Array; signedRegion: Uint8Array; contentsHexStart: number } {
  const contentsPattern = `<${CONTENTS_PLACEHOLDER_HEX}`;
  const ltIdx = findAsciiOffset(bytes, contentsPattern);
  if (ltIdx === -1) throw new SignPdfError(t('sign.placeholderNotFound'));
  const gtIdx = ltIdx + contentsPattern.length; // position of the closing '>'
  const contentsHexStart = ltIdx + 1;

  // The array's first element is always the literal `0` written by
  // `addSignaturePlaceholder` (not a placeholder value) — only the other
  // three were given the wide placeholder number.
  const byteRangePlaceholderText = `0 ${Array(3).fill(String(BYTE_RANGE_PLACEHOLDER)).join(' ')}`;
  const brIdx = findAsciiOffset(bytes, byteRangePlaceholderText);
  if (brIdx === -1) throw new SignPdfError(t('sign.placeholderNotFound'));

  const byteRange = [0, contentsHexStart, gtIdx, bytes.length - gtIdx];
  const byteRangeText = `0 ${byteRange.slice(1).map((n) => String(n).padEnd(BYTE_RANGE_WIDTH, ' ')).join(' ')}`;

  const patched = new Uint8Array(bytes);
  patched.set(new TextEncoder().encode(byteRangeText), brIdx);

  const signedRegion = new Uint8Array(byteRange[1] + byteRange[3]);
  signedRegion.set(patched.subarray(0, byteRange[1]), 0);
  signedRegion.set(patched.subarray(byteRange[2], byteRange[2] + byteRange[3]), byteRange[1]);

  return { patched, signedRegion, contentsHexStart };
}

/** Parses the .pfx, matches its certificate to its private key, and returns
 * a detached CMS/PKCS#7 SignedData signature over `data`, as a hex string
 * ready to splice into /Contents. */
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

async function signWithForge(data: Uint8Array, pfxBytes: Uint8Array, password: string): Promise<string> {
  const forge = await import('node-forge');

  let p12;
  try {
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(toArrayBufferView(pfxBytes)));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  } catch {
    throw new SignPdfError(t('sign.wrongPasswordOrFile'));
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const privateKey = keyBags[0]?.key as import('node-forge').pki.rsa.PrivateKey | undefined;
  if (!privateKey) throw new SignPdfError(t('sign.noPrivateKey'));

  // A .pfx can bundle more than one certificate (the signer's plus the
  // issuing chain) — the one that actually pairs with the private key is
  // identified by comparing RSA moduli, the same way real signing tools do.
  let certificate = certBags.find((bag) => {
    const pub = bag.cert?.publicKey as import('node-forge').pki.rsa.PublicKey | undefined;
    return pub?.n.equals(privateKey.n);
  })?.cert;
  if (!certificate) certificate = certBags[0]?.cert;
  if (!certificate) throw new SignPdfError(t('sign.noCertificate'));

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(toArrayBufferView(data));
  for (const bag of certBags) if (bag.cert) p7.addCertificate(bag.cert);
  p7.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      // messageDigest and signingTime are left without an explicit value —
      // forge computes/fills both itself from `content` and the current
      // time when `sign()` runs.
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime },
    ],
  });
  p7.sign({ detached: true });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hex = forge.util.bytesToHex(der);
  if (hex.length > CONTENTS_PLACEHOLDER_HEX.length) {
    throw new SignPdfError(t('sign.signatureTooLarge'));
  }
  return hex;
}

/**
 * Signs `pdfBytes` with the given PKCS#12 (.pfx/.p12) certificate and
 * password, returning a new PDF with a PAdES-B signature embedded. Never
 * transmits the certificate or password anywhere — everything happens
 * in-memory, client-side.
 */
export async function signPdf(pdfBytes: Uint8Array, pfxBytes: Uint8Array, password: string): Promise<Uint8Array> {
  const withPlaceholder = await addSignaturePlaceholder(pdfBytes);
  const { patched, signedRegion, contentsHexStart } = computeByteRangeAndSignedRegion(withPlaceholder);
  const signatureHex = await signWithForge(signedRegion, pfxBytes, password);
  const paddedHex = signatureHex.padEnd(CONTENTS_PLACEHOLDER_HEX.length, '0');
  patched.set(new TextEncoder().encode(paddedHex), contentsHexStart);
  return patched;
}
