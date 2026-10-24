// Makes the files the end-to-end tests open: photos with known content,
// PDFs (rotated, encrypted, image-heavy...) and throwaway test certificates.
// Written to a temporary folder on each run (see run.mjs) — none of it lives
// in the project, certificates and their password least of all.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import forge from 'node-forge';
import pdfLib from 'pdf-lib';
import sharp from 'sharp';

// pdf-lib is CommonJS for Node, its names only reachable through the default export.
const { degrees, PDFDocument, PDFString, rgb, StandardFonts } = pdfLib;

/** Bump when a fixture changes, so the next run makes them again. */
const VERSION = '6';

/** The test certificates' password. */
export const CERT_PASSWORD = 'teste123';
/** The opening password of protegido-senha.pdf. */
export const PDF_PASSWORD = '1234';

const ROBOTO = new URL('../../public/fonts/roboto/Regular.ttf', import.meta.url);

/** A photo with known content: a sky gradient; red, green, blue and yellow
 * squares in the corners; a grey ramp (16 steps) and lines of black text. */
async function photo(W = 1600, H = 1000) {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = y / H;
      const i = (y * W + x) * 3;
      raw[i] = Math.max(0, Math.min(255, Math.trunc(90 + 120 * t + 30 * Math.sin(x / 180))));
      raw[i + 1] = Math.max(0, Math.min(255, Math.trunc(140 + 80 * t)));
      raw[i + 2] = Math.max(0, Math.min(255, Math.trunc(220 - 90 * t)));
    }
  }
  const box = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) raw.set(c, (y * W + x) * 3);
  };
  box(60, 60, 260, 260, [220, 30, 40]);
  box(W - 260, 60, W - 60, 260, [30, 180, 60]);
  box(60, H - 260, 260, H - 60, [30, 60, 210]);
  box(W - 260, H - 260, W - 60, H - 60, [240, 210, 30]);
  for (let i = 0; i < 16; i++) {
    const v = Math.trunc((i * 255) / 15);
    box(400 + i * 50, 420, 400 + i * 50 + 49, 580, [v, v, v]);
  }
  const lines = [0, 1, 2]
    .map((k) => `<text x="420" y="${680 + k * 56}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#0a0a0a">Fluva editor de imagens 0123456789</text>`)
    .join('');
  const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines}</svg>`);
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: text }]);
}

/** A logo on a see-through background: a green disc with a pink one inside,
 * the pink one itself only partly opaque (alpha 200). */
function logo() {
  const W = 600;
  const H = 400;
  const raw = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - 300, y + 0.5 - 200);
      const i = (y * W + x) * 4;
      if (d <= 70) raw.set([255, 79, 163, 200], i);
      else if (d <= 150) raw.set([29, 158, 117, 255], i);
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 4 } });
}

/** A 24-bit BMP, written by hand (sharp doesn't write BMP). */
async function bmp(image) {
  const { data, info } = await image.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const row = Math.ceil((W * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * H);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(W, 18);
  out.writeInt32LE(H, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * H, 34);
  for (let y = 0; y < H; y++) {
    const dst = 54 + (H - 1 - y) * row;
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 3;
      out[dst + x * 3] = data[s + 2];
      out[dst + x * 3 + 1] = data[s + 1];
      out[dst + x * 3 + 2] = data[s];
    }
  }
  return out;
}

/** A busy 12-megapixel photo (4032 × 3024), as a phone takes them. */
async function bigPhoto() {
  const W = 4032;
  const H = 3024;
  const raw = Buffer.alloc(W * H * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const n = rnd() * 40;
      raw[i] = (x * 200) / W + n;
      raw[i + 1] = (y * 200) / H + n;
      raw[i + 2] = 120 + 60 * Math.sin((x + y) / 90) + n / 2;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

async function textPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText('CONTRATO DE TESTE', { x: 72, y: 760, size: 20, font: bold });
  p1.drawText('Valor total: R$ 1.200,00', { x: 72, y: 700, size: 14, font });
  p1.drawText('CPF: 123.456.789-00', { x: 72, y: 670, size: 14, font });
  p1.drawRectangle({ x: 70, y: 600, width: 260, height: 30, color: rgb(1, 0.95, 0.6) });
  p1.drawText('Texto sobre marca-texto amarelo', { x: 76, y: 610, size: 13, font, color: rgb(0.6, 0.1, 0.1) });
  doc.addPage([595.28, 841.89]).drawText('Pagina dois - texto de exemplo', { x: 72, y: 760, size: 16, font });
  doc.addPage([595.28, 841.89]).drawText('Pagina tres - final', { x: 72, y: 760, size: 16, font });
  doc.setTitle('Contrato de teste');
  return doc.save();
}

/** Text over two big photos: what compression should shrink, keeping the text. */
async function imagePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const W = 2400;
  const H = 1800;
  const raw = Buffer.alloc(W * H * 3);
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      raw[i] = ((x * 255) / W) ^ (rnd() * 50);
      raw[i + 1] = ((y * 255) / H) ^ (rnd() * 50);
      raw[i + 2] = ((x + y) % 255) ^ (rnd() * 50);
    }
  }
  const jpg = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).resize(1200, 900).png().toBuffer();
  const photoJpg = await doc.embedJpg(jpg);
  const photoPng = await doc.embedPng(png);
  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText('Relatorio com fotos', { x: 50, y: 780, size: 22, font });
  p1.drawImage(photoJpg, { x: 50, y: 360, width: 495, height: 371 });
  p1.drawText('Legenda da foto de teste', { x: 50, y: 330, size: 14, font });
  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText('Segunda pagina com outra foto', { x: 50, y: 780, size: 18, font });
  p2.drawImage(photoPng, { x: 50, y: 360, width: 495, height: 371 });
  return doc.save();
}

/** A photo cut out round (see-through around it), shown small over a colored page. */
async function cutoutPdf() {
  const W = 1200;
  const H = 800;
  const raw = Buffer.alloc(W * H * 4);
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inside = ((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2 <= 1;
      raw[i] = 200 + rnd() * 55;
      raw[i + 1] = 40 + rnd() * 60;
      raw[i + 2] = 90 + rnd() * 60;
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cutout = await doc.embedPng(png);
  const p = doc.addPage([595.28, 841.89]);
  p.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 0.9, 0.4) });
  p.drawImage(cutout, { x: 60, y: 640, width: 180, height: 120 });
  p.drawText('Foto recortada sobre fundo amarelo', { x: 60, y: 600, size: 16, font });
  return doc.save();
}

/** Landscape pages stored as portrait + /Rotate, and one with its MediaBox off the origin. */
async function rotatedPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('Pagina com Rotate 90 - texto alvo', { x: 100, y: 400, size: 18, font });
  p1.setRotation(degrees(90));
  const p2 = doc.addPage([612, 792]);
  p2.setMediaBox(50, 50, 612, 792);
  p2.drawText('Pagina com MediaBox deslocada - texto alvo', { x: 120, y: 500, size: 18, font });
  return doc.save();
}

async function formPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(ROBOTO), { subset: true });
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Formulario com campos e link', { x: 72, y: 780, size: 16, font });
  const form = doc.getForm();
  const nome = form.createTextField('nome');
  nome.setText('Maria Silva');
  nome.addToPage(p, { x: 72, y: 700, width: 250, height: 28 });
  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [70, 595, 200, 615],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/') },
  });
  p.node.addAnnot(doc.context.register(link));
  return doc.save();
}

// ---- RC4-40 (standard security handler, revision 2), written by hand ----
const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const padPwd = (p) => Buffer.concat([Buffer.from(p, 'latin1'), PAD]).subarray(0, 32);
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
/** A one-page PDF encrypted with `userPwd` to open (empty: opens freely,
 * still protected by its author) and `ownerPwd` for its permissions. */
function encryptedPdf(userPwd, ownerPwd, text) {
  const P = -64;
  const id0 = randomBytes(16);
  const O = rc4(md5(padPwd(ownerPwd)).subarray(0, 5), padPwd(userPwd));
  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(P);
  const key = md5(padPwd(userPwd), O, pBuf, id0).subarray(0, 5);
  const U = rc4(key, PAD);
  const objKey = (num, gen) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255])).subarray(0, 10);
  const content = Buffer.from(`BT /F1 24 Tf 72 700 Td (${text}) Tj ET`, 'latin1');
  const encContent = rc4(objKey(6, 0), content);
  const objs = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
    `5 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>\nendobj\n`,
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  for (const o of objs) {
    offsets.push(pos);
    const b = Buffer.from(o, 'latin1');
    parts.push(b);
    pos += b.length;
  }
  offsets.push(pos);
  const head = Buffer.from(`6 0 obj\n<< /Length ${encContent.length} >>\nstream\n`, 'latin1');
  const tail = Buffer.from('\nendstream\nendobj\n', 'latin1');
  parts.push(head, encContent, tail);
  pos += head.length + encContent.length + tail.length;
  let xref = `xref\n0 7\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 5 0 R /ID [<${id0.toString('hex')}> <${id0.toString('hex')}>] >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

/** A PKCS#12 test certificate, issued by a made-up "ICP-Brasil" test CA. */
function certificate({ cn, notBefore, notAfter }) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const c = forge.pki.createCertificate();
  c.publicKey = keys.publicKey;
  c.serialNumber = '0' + randomBytes(8).toString('hex');
  c.validity.notBefore = notBefore;
  c.validity.notAfter = notAfter;
  c.setSubject([{ name: 'commonName', value: cn }, { name: 'countryName', value: 'BR' }, { name: 'organizationName', value: 'ICP-Brasil' }]);
  c.setIssuer([{ name: 'commonName', value: 'AC TESTE FLUVA' }, { name: 'countryName', value: 'BR' }, { name: 'organizationName', value: 'ICP-Brasil' }]);
  c.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [c], CERT_PASSWORD, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

/** Writes every fixture into `dir` (skipped when that version is there already). */
export async function makeFixtures(dir) {
  const stamp = join(dir, `.version-${VERSION}`);
  if (existsSync(stamp)) return dir;
  mkdirSync(dir, { recursive: true });
  const save = (name, bytes) => writeFileSync(join(dir, name), bytes);

  const foto = await photo();
  save('foto-teste.jpg', await foto.clone().jpeg({ quality: 92 }).toBuffer());
  const webp = await foto.clone().webp({ quality: 80 }).toBuffer();
  save('foto.webp', webp);
  // A WebP behind a .jpg name, as web downloads often are.
  save('foto-webp-disfarcada.jpg', webp);
  save('foto.gif', await foto.clone().gif().toBuffer());
  save('foto.bmp', await bmp(foto));
  save('logo-transparente.png', await logo().png().toBuffer());
  save('recorte.pdf', await cutoutPdf());
  save('logo-lossless.webp', await logo().webp({ lossless: true }).toBuffer());
  save('foto-12mp.jpg', await bigPhoto());
  save('largo-16400.png', await sharp({ create: { width: 16400, height: 300, channels: 3, background: { r: 120, g: 170, b: 220 } } }).png().toBuffer());

  save('texto.pdf', await textPdf());
  // The same, with a classic cross-reference table instead of a stream.
  save('texto-classico.pdf', await (await PDFDocument.load(await textPdf())).save({ useObjectStreams: false }));
  save('imagem-pesada.pdf', await imagePdf());
  save('rotacionado.pdf', await rotatedPdf());
  save('formulario.pdf', await formPdf());
  save('protegido-senha.pdf', encryptedPdf(PDF_PASSWORD, 'dono', 'Documento com senha'));
  save('protegido-dono.pdf', encryptedPdf('', 'dono', 'Documento protegido'));

  const now = Date.now();
  const day = 864e5;
  save('cert-valido.p12', certificate({ cn: 'FULANO DE TAL:12345678900', notBefore: new Date(now - day), notAfter: new Date(now + 365 * day) }));
  save('cert-segundo.p12', certificate({ cn: 'CICLANA DA SILVA:98765432100', notBefore: new Date(now - day), notAfter: new Date(now + 365 * day) }));
  save('cert-vencido.p12', certificate({ cn: 'CERTIFICADO VENCIDO:11122233344', notBefore: new Date('2020-01-01'), notAfter: new Date('2021-01-01') }));

  writeFileSync(stamp, new Date().toISOString());
  return dir;
}
