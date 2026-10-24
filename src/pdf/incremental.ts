import { PDFArray, PDFHexString, type PDFDocument, type PDFRef } from 'pdf-lib';

/**
 * An incremental update: the PDF exactly as it was, byte for byte, with the
 * objects that changed or are new written after it, and a cross-reference
 * section of their own pointing back at the original's (`/Prev`). Nothing an
 * earlier signature covers moves or changes — which is what keeps it valid
 * when another signature is added.
 */

/** The original's last cross-reference section: where it starts, whether it's a
 * stream (PDF 1.5 and up) or a classic table, and its /Size. */
export interface XrefInfo {
  offset: number;
  isStream: boolean;
  size: number;
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

/** The file's cross-reference can't be found where it says: an update
 * pointing back at it would leave readers lost. Write the file anew instead. */
export class BrokenXrefError extends Error {
  constructor() {
    super('broken cross-reference');
    this.name = 'BrokenXrefError';
  }
}

export function lastXref(bytes: Uint8Array): XrefInfo {
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail) ?? [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!m) throw new BrokenXrefError();
  const offset = Number(m[1]);
  // What's there: "xref" and a table, or "N G obj" and the stream's dictionary.
  const head = latin1(bytes.subarray(offset, offset + 64 * 1024));
  if (!/^\s*(xref|\d+\s+\d+\s+obj)/.test(head)) throw new BrokenXrefError();
  const isStream = !/^\s*xref/.test(head);
  const dict = isStream ? head.slice(0, head.indexOf('stream')) : head.slice(head.indexOf('trailer'));
  const size = Number(/\/Size\s+(\d+)/.exec(dict)?.[1] ?? 0);
  return { offset, isStream, size };
}

/** Consecutive object numbers grouped: [first, count] pairs. */
function runs(numbers: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const n of numbers) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === n) last[1] += 1;
    else out.push([n, 1]);
  }
  return out;
}

/**
 * Appends to `base` the objects `refs` point to, as they now are in `doc`
 * (which was parsed from `base`), with the cross-reference section and
 * trailer of an incremental update. `xref` is `lastXref(base)`.
 */
export function appendUpdate(base: Uint8Array, doc: PDFDocument, refs: PDFRef[], xref: XrefInfo): Uint8Array {
  const { context } = doc;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [base];
  let at = base.length;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    at += bytes.length;
  };
  const last = base[base.length - 1];
  if (last !== 0x0a && last !== 0x0d) push('\n');

  const sorted = [...new Map(refs.map((r) => [r.objectNumber, r])).values()].sort((a, b) => a.objectNumber - b.objectNumber);
  const offsets = new Map<number, { offset: number; gen: number }>();
  for (const ref of sorted) {
    const object = context.lookup(ref);
    if (!object) continue;
    offsets.set(ref.objectNumber, { offset: at, gen: ref.generationNumber });
    push(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
    const body = new Uint8Array(object.sizeInBytes());
    object.copyBytesInto(body, 0);
    push(body);
    push('\nendobj\n');
  }

  const { Root, Info } = context.trailerInfo;
  // The file's identifier: its first half stays, as it names the document;
  // the second changes with each version.
  const id = context.trailerInfo.ID instanceof PDFArray ? context.trailerInfo.ID.get(0) : undefined;
  const fresh = PDFHexString.of(Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
  const idText = `[${(id ?? fresh).toString()} ${fresh.toString()}]`;
  const highest = Math.max(0, ...sorted.map((r) => r.objectNumber));
  const common = `/Root ${Root}${Info ? ` /Info ${Info}` : ''} /ID ${idText} /Prev ${xref.offset}`;

  const xrefAt = at;
  if (!xref.isStream) {
    const size = Math.max(xref.size, highest + 1);
    let table = 'xref\n';
    for (const [first, count] of runs([...offsets.keys()])) {
      table += `${first} ${count}\n`;
      for (let n = first; n < first + count; n++) {
        const { offset, gen } = offsets.get(n)!;
        table += `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} n \n`;
      }
    }
    push(`${table}trailer\n<< /Size ${size} ${common} >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  } else {
    // A cross-reference stream, as the original's: each entry 1 + 4 + 2
    // bytes (type 1, offset, generation), this stream's own included.
    const self = Math.max(xref.size, highest + 1);
    offsets.set(self, { offset: xrefAt, gen: 0 });
    const numbers = [...offsets.keys()].sort((a, b) => a - b);
    const rows = new Uint8Array(numbers.length * 7);
    numbers.forEach((n, i) => {
      const { offset, gen } = offsets.get(n)!;
      const o = i * 7;
      rows[o] = 1;
      rows[o + 1] = (offset >>> 24) & 0xff;
      rows[o + 2] = (offset >>> 16) & 0xff;
      rows[o + 3] = (offset >>> 8) & 0xff;
      rows[o + 4] = offset & 0xff;
      rows[o + 5] = (gen >>> 8) & 0xff;
      rows[o + 6] = gen & 0xff;
    });
    const index = runs(numbers).flat().join(' ');
    push(`${self} 0 obj\n<< /Type /XRef /Size ${self + 1} /W [1 4 2] /Index [${index}] ${common} /Length ${rows.length} >>\nstream\n`);
    push(rows);
    push(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`);
  }

  const out = new Uint8Array(at);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
