import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** pdf.js's runtime files (see vite.config.ts): the decoders for the image
 * formats scanned documents use, CJK character maps and the standard fonts. */
const assets = `${import.meta.env.BASE_URL}${__PDFJS_ASSETS__}`;

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
 * `password` opens a PDF that needs one (see `loadFile`).
 */
export async function openWithPdfJs(bytes: Uint8Array, password?: string): Promise<OpenedPdf> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  // Teardown lives on the loading task, not on the document proxy.
  const task = pdfjsLib.getDocument({
    data: copy,
    password,
    wasmUrl: `${assets}wasm/`,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    // Fetched by the page and handed to the worker: in the desktop app
    // (WebView2) requests made from inside a worker never reach the app's
    // own files, and the decoders failed to load.
    useWorkerFetch: false,
  });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

export { pdfjsLib };
