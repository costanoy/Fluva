import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { zipSync, strToU8 } from 'fflate';
import type { DocumentState } from './model';
import { buildPdf } from './build';
import { canvasToBlob, rasterizePdf } from './render';
import { extractPageImages, extractPageText, groupIntoLines } from './textExtract';
import { stripExtension } from './loader';
import { t } from '../i18n/translations';

export type ExportFormat = 'pdf' | 'png' | 'jpg' | 'docx';

/** Resolution used when turning pages into images. 150 DPI reads cleanly on screen and in print. */
const IMAGE_EXPORT_DPI = 150;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  downloadBlob(new Blob([copy.buffer], { type: mime }), filename);
}

export async function exportAsPdf(doc: DocumentState, baseName: string) {
  const bytes = await buildPdf(doc);
  downloadBytes(bytes, `${baseName}.pdf`, 'application/pdf');
}

/**
 * Exports every page as an image. A single page downloads directly; multiple pages
 * are bundled into a .zip so the user gets one file instead of N downloads.
 */
export async function exportAsImages(
  doc: DocumentState,
  baseName: string,
  format: 'png' | 'jpg',
  onProgress?: (done: number, total: number) => void,
) {
  const baked = await buildPdf(doc);
  const canvases = await rasterizePdf(baked, IMAGE_EXPORT_DPI / 72, onProgress);
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = format === 'jpg' ? 0.92 : undefined;

  if (canvases.length === 1) {
    const blob = await canvasToBlob(canvases[0], mime, quality);
    downloadBlob(blob, `${baseName}.${format}`);
    return;
  }

  const files: Record<string, Uint8Array> = {};
  const pad = String(canvases.length).length;
  for (let i = 0; i < canvases.length; i++) {
    const blob = await canvasToBlob(canvases[i], mime, quality);
    const name = `${baseName}_pagina_${String(i + 1).padStart(pad, '0')}.${format}`;
    files[name] = new Uint8Array(await blob.arrayBuffer());
  }
  const zipped = zipSync(files, { level: 6 });
  downloadBytes(zipped, `${baseName}_${format}.zip`, 'application/zip');
}

/** Word renders images at 96 CSS px per inch, PDF space is 72 points per inch. */
const DOCX_PX_PER_PT = 96 / 72;
/** Keeps a large photo or screenshot from blowing out the page width. */
const DOCX_MAX_IMAGE_WIDTH_PX = 500;

/**
 * Builds a real .docx from the text and images actually present in the PDF.
 *
 * This recovers the content and its reading order, not the original layout:
 * columns and tables are not reconstructed, and each page's images are placed
 * after its text rather than interleaved at their exact original position.
 * The UI says so before the user commits.
 */
export async function exportAsDocx(
  doc: DocumentState,
  baseName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ paragraphs: number; images: number }> {
  const paragraphs: Paragraph[] = [];
  let count = 0;
  let imageCount = 0;

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const items = await extractPageText(doc, page);
    const lines = groupIntoLines(items);

    if (i > 0) {
      paragraphs.push(new Paragraph({ text: '', pageBreakBefore: true }));
    }

    if (!lines.length) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: t('export.docxNoExtractableText', { n: i + 1 }), italics: true, color: '6E6E67' })],
        }),
      );
    } else {
      // The largest run on a page is treated as its heading; everything else is body text.
      const maxSize = Math.max(...items.map((t) => t.fontSize));
      for (const line of lines) {
        const isHeading = items.some((t) => t.fontSize >= maxSize - 0.5 && line.includes(t.text.trim()) && t.text.trim().length > 2);
        paragraphs.push(
          isHeading && line.length < 120
            ? new Paragraph({ text: line, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
            : new Paragraph({ children: [new TextRun(line)], spacing: { after: 120 } }),
        );
        count += 1;
      }
    }

    // Text overlays the user added are part of the document's content too.
    for (const overlay of page.overlays) {
      if (overlay.kind !== 'text' || !overlay.text.trim()) continue;
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: overlay.text, bold: overlay.bold, italics: overlay.italic })] }));
      count += 1;
    }

    for (const img of await extractPageImages(doc, page)) {
      const widthPx = Math.round(img.width * DOCX_PX_PER_PT);
      const heightPx = Math.round(img.height * DOCX_PX_PER_PT);
      const shrink = Math.min(1, DOCX_MAX_IMAGE_WIDTH_PX / widthPx);
      paragraphs.push(
        new Paragraph({
          spacing: { before: 120, after: 120 },
          children: [
            new ImageRun({
              type: 'png',
              data: img.bytes,
              transformation: { width: Math.round(widthPx * shrink), height: Math.round(heightPx * shrink) },
            }),
          ],
        }),
      );
      imageCount += 1;
    }

    onProgress?.(i + 1, doc.pages.length);
  }

  const docx = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  const blob = await Packer.toBlob(docx);
  downloadBlob(blob, `${baseName}.docx`);
  return { paragraphs: count, images: imageCount };
}

export function baseNameFor(doc: DocumentState): string {
  return stripExtension(doc.name || 'documento') || 'documento';
}

export function zipFiles(files: Array<{ name: string; bytes: Uint8Array }>, zipName: string) {
  const map: Record<string, Uint8Array> = {};
  for (const f of files) map[f.name] = f.bytes;
  downloadBytes(zipSync(map, { level: 6 }), zipName, 'application/zip');
}

export { strToU8 };
