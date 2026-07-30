import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy;
export type PDFPageProxy = pdfjsLib.PDFPageProxy;

/** A document plus the handle needed to release its worker resources. */
export interface OpenedPdf {
  doc: PDFDocumentProxy;
  destroy: () => Promise<void>;
}

/**
 * pdf.js takes ownership of (and detaches) the buffer it is given, so callers must
 * always hand it a copy and keep the pristine original for pdf-lib to write with.
 */
export async function openWithPdfJs(bytes: Uint8Array): Promise<OpenedPdf> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  // Teardown lives on the loading task, not on the document proxy.
  const task = pdfjsLib.getDocument({ data: copy });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

export { pdfjsLib };
