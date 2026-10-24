// Checks on a PDF the tests got back from Fluva, made on their own — not with
// any of Fluva's code: every signature's hash and RSA signature checked from
// scratch, where its widget sits on the page, and the images inside.
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
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

/**
 * Walks the file's cross-reference sections from the last one back through
 * every /Prev — classic tables and streams alike — and checks that each
 * object they place is really at that offset ("N G obj"). A reader that
 * trusts the table (Acrobat does) finds what it's told is there.
 */
function checkXref(bytes) {
  const text = bytes.toString('latin1');
  const problems = [];
  let objects = 0;
  let sections = 0;
  const kinds = [];
  const at = (offset, num, gen) => {
    objects++;
    const head = text.slice(offset, offset + 40);
    if (!new RegExp(`^${num}\\s+${gen}\\s+obj\\b`).test(head)) problems.push(`object ${num} ${gen} is not at ${offset} (found "${head.slice(0, 16)}")`);
  };
  let next = Number(/startxref\s+(\d+)\s*%%EOF\s*$/.exec(text.slice(-2048))?.[1]);
  const seen = new Set();
  while (Number.isFinite(next) && !seen.has(next)) {
    seen.add(next);
    sections++;
    let trailer;
    if (text.startsWith('xref', next)) {
      kinds.push('table');
      const end = text.indexOf('trailer', next);
      const lines = text.slice(next + 4, end).trim().split(/\r\n|\r|\n/);
      for (let i = 0; i < lines.length; ) {
        const [start, count] = lines[i++].trim().split(/\s+/).map(Number);
        for (let k = 0; k < count; k++, i++) {
          const [off, gen, type] = lines[i].trim().split(/\s+/);
          if (type === 'n') at(Number(off), start + k, Number(gen));
        }
      }
      trailer = text.slice(end, text.indexOf('startxref', end));
    } else {
      kinds.push('stream');
      const streamAt = text.indexOf('stream', next);
      trailer = text.slice(next, streamAt);
      const header = /^(\d+)\s+(\d+)\s+obj/.exec(text.slice(next, next + 30));
      if (!header) {
        problems.push(`no cross-reference stream at ${next}`);
        break;
      }
      const length = Number(/\/Length\s+(\d+)/.exec(trailer)[1]);
      let dataAt = streamAt + 6;
      if (text[dataAt] === '\r') dataAt++;
      if (text[dataAt] === '\n') dataAt++;
      let data = bytes.subarray(dataAt, dataAt + length);
      if (/\/Filter\s*\/FlateDecode/.test(trailer)) data = inflateSync(data);
      const w = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(trailer).slice(1, 4).map(Number);
      const size = Number(/\/Size\s+(\d+)/.exec(trailer)[1]);
      const index = /\/Index\s*\[([^\]]*)\]/.exec(trailer)?.[1].trim().split(/\s+/).map(Number) ?? [0, size];
      const columns = w[0] + w[1] + w[2];
      const predictor = Number(/\/Predictor\s+(\d+)/.exec(trailer)?.[1] ?? 1);
      if (predictor >= 10) {
        // PNG "Up" rows, each led by its filter byte.
        const rows = [];
        let prev = new Uint8Array(columns);
        for (let r = 0; r * (columns + 1) < data.length; r++) {
          const row = data.subarray(r * (columns + 1) + 1, (r + 1) * (columns + 1));
          const out = new Uint8Array(columns);
          for (let c = 0; c < columns; c++) out[c] = (row[c] + (data[r * (columns + 1)] === 2 ? prev[c] : 0)) & 255;
          rows.push(out);
          prev = out;
        }
        data = Buffer.concat(rows.map((r) => Buffer.from(r)));
      }
      const field = (row, from, width) => {
        let v = 0;
        for (let k = 0; k < width; k++) v = v * 256 + data[row * columns + from + k];
        return v;
      };
      let row = 0;
      for (let i = 0; i < index.length; i += 2) {
        for (let k = 0; k < index[i + 1]; k++, row++) {
          const type = w[0] ? field(row, 0, w[0]) : 1;
          if (type === 1) at(field(row, w[0], w[1]), index[i] + k, w[2] ? field(row, w[0] + w[1], w[2]) : 0);
        }
      }
    }
    next = Number(/\/Prev\s+(\d+)/.exec(trailer)?.[1]);
  }
  return { ok: !problems.length && sections > 0, sections, kinds, objects, problems: problems.slice(0, 5) };
}

function lookup(context, value) {
  return value instanceof PDFRef ? context.lookup(value) : value;
}

export async function inspectPdf(bytes) {
  const text = bytes.toString('latin1');
  const result = { size: bytes.length, revisions: (text.match(/%%EOF/g) ?? []).length, signatures: [], widgets: [], images: [] };
  try {
    result.xref = checkXref(bytes);
  } catch (err) {
    result.xref = { ok: false, problems: [String(err.message ?? err)] };
  }

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
