// Runs inside the page before scenario.js: the line back to run.mjs, through
// the DevTools binding it adds (`__qaCall`). Works the same on the website
// and in the desktop app, whose security policy lets the page fetch nothing
// from anywhere else.
(() => {
  if (window.__qa) return;
  let next = 0;
  const waiting = new Map();
  window.__qaResolve = (id, reply) => {
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    if (reply.ok) entry.resolve(reply.value);
    else entry.reject(new Error(reply.error));
  };
  /** Asks run.mjs for something (see `answer` there). */
  window.__qa = (cmd, data = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      window.__qaCall(JSON.stringify({ id, cmd, data }));
    });

  const toBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  const fromBase64 = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };
  const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', pdf: 'application/pdf', p12: 'application/x-pkcs12' };

  /** A test file (made by fixtures.mjs), as the File a person would pick. */
  window.__file = async (name, type) => {
    const { b64 } = await window.__qa('file', { name });
    return new File([fromBase64(b64)], name, { type: type ?? TYPES[name.split('.').pop()] ?? 'application/octet-stream' });
  };
  /** Keeps a file the page made, in the run's output folder. */
  window.__sink = async (blob, name) => window.__qa('save', { name, b64: await toBase64(blob) });
  /** What verify.mjs finds in a PDF: its signatures checked, their widgets, its images. */
  window.__inspectPdf = async (blob) => window.__qa('inspectPdf', { b64: await toBase64(blob) });
})();
