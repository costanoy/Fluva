// Checks on a PDF the tests got back from Fluva, made on their own — not with
// any of Fluva's code: every signature's hash and RSA signature checked from
// scratch, where its widget sits on the page, and the images inside.
import { createHash } from 'node:crypto';
import forge from 'node-forge';
import pdfLib from 'pdf-lib';

const { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } = pdfLib;

const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';

/** Verifies one CMS (PKCS#7) detached signature over `signed`. */
function verifyCms(der, signed) {
  const { asn1, pki } = forge;
  const content = asn1.fromDer(forge.util.createBuffer(der.toString('binary')), { strict: false });
  // ContentInfo → [0] → SignedData
  const signedData = content.value[1].value[0];
  const fields = signedData.value;
  const certsNode = fields.find((n) => n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === 0);
  const signerInfos = fields[fields.length - 1];
  const signerInfo = signerInfos.value[0];
  const signedAttrs = signerInfo.value.find((n) => n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === 0);
  const signature = signerInfo.value[signerInfo.value.length - 1].value;
  const certificates = (certsNode?.value ?? []).map((c) => pki.certificateFromAsn1(c));

  const digest = createHash('sha256').update(signed).digest();
  const mdAttr = signedAttrs.value.find((attr) => asn1.derToOid(attr.value[0].value) === OID_MESSAGE_DIGEST);
  const claimed = Buffer.from(mdAttr.value[1].value[0].value, 'binary');

  // The signature covers the attributes encoded as a SET, not as [0].
  const asSet = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, signedAttrs.value);
  const attrsDigest = forge.md.sha256.create().update(asn1.toDer(asSet).getBytes()).digest().getBytes();
  const signer = certificates.find((cert) => {
    try {
      return cert.publicKey.verify(attrsDigest, signature);
    } catch {
      return false;
    }
  });
  return {
    digestOk: claimed.equals(digest),
    signatureOk: !!signer,
    signer: signer?.subject.getField('CN')?.value ?? null,
  };
}

function lookup(context, value) {
  return value instanceof PDFRef ? context.lookup(value) : value;
}

export async function inspectPdf(bytes) {
  const text = bytes.toString('latin1');
  const result = { size: bytes.length, revisions: (text.match(/%%EOF/g) ?? []).length, signatures: [], widgets: [], images: [] };

  // Every signature, wherever it is in the file — each /ByteRange names
  // the bytes it covers, the gap between its two spans holding /Contents.
  for (const m of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const [a, b, c, d] = m.slice(1, 5).map(Number);
    if (b > bytes.length) continue; // a placeholder never filled in
    const hex = text.slice(a + b + 1, c - 1);
    const padded = Buffer.from(hex, 'hex');
    // The reserved space is zero-padded: the DER header says where it ends.
    const lenByte = padded[1];
    const lenBytes = lenByte & 0x80 ? lenByte & 0x7f : 0;
    let length = lenBytes ? 0 : lenByte;
    for (let k = 0; k < lenBytes; k++) length = length * 256 + padded[2 + k];
    const der = padded.subarray(0, 2 + lenBytes + length);
    const signed = Buffer.concat([bytes.subarray(a, a + b), bytes.subarray(c, c + d)]);
    let check;
    try {
      check = verifyCms(der, signed);
    } catch (err) {
      check = { digestOk: false, signatureOk: false, signer: null, error: String(err.message ?? err) };
    }
    result.signatures.push({ byteRange: [a, b, c, d], coversToEnd: a === 0 && c + d === bytes.length, ...check });
  }

  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    result.error = String(err.message ?? err);
    return result;
  }
  result.encrypted = doc.isEncrypted;
  result.pages = doc.getPageCount();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    const list = annots instanceof PDFArray ? annots.asArray() : [];
    for (const item of list) {
      const annot = lookup(doc.context, item);
      if (!(annot instanceof PDFDict)) continue;
      const ft = annot.lookup(PDFName.of('FT')) ?? annot.lookup(PDFName.of('Parent'))?.lookup?.(PDFName.of('FT'));
      if (ft !== PDFName.of('Sig')) continue;
      const rect = annot.lookup(PDFName.of('Rect'));
      const ap = annot.lookup(PDFName.of('AP'));
      result.widgets.push({
        page: index + 1,
        rect: rect instanceof PDFArray ? rect.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) : null,
        appearance: ap instanceof PDFDict && !!ap.get(PDFName.of('N')),
        rotation: page.getRotation().angle,
      });
    }
  });
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const filter = object.dict.lookup(PDFName.of('Filter'));
    result.images.push({
      width: object.dict.lookup(PDFName.of('Width'))?.asNumber?.(),
      height: object.dict.lookup(PDFName.of('Height'))?.asNumber?.(),
      filter: filter instanceof PDFArray ? filter.asArray().map(String).join(',') : String(filter ?? ''),
      bytes: object.contents.length,
    });
  }
  return result;
}
