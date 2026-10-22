import { t } from '../i18n/translations';

/**
 * The Android app. Its WebView ignores downloads — a link to a file, even
 * with `download` on it, does nothing there — so every export is saved
 * through Android's own "save as" sheet instead (see `saveThroughSystem`).
 */
export const IN_ANDROID_APP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && /Android/i.test(navigator.userAgent);

/** The person closed the save sheet without saving: nothing went wrong, and
 * nothing is reported (see `withBusy` in the store). */
export class SaveCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SaveCancelled';
  }
}

const WRITE_SLICE = 512 * 1024;

/**
 * Saves `blob` where the person picks, through the system's save sheet
 * (Android's "create document"), which hands back the chosen file's address
 * to write to. Throws `SaveCancelled` when the sheet is closed.
 */
export async function saveThroughSystem(blob: Blob, filename: string): Promise<void> {
  const [{ save }, { open }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
  let target: string | null;
  try {
    // A type with a slash goes to Android as it is, rather than guessed back
    // from the extension.
    target = await save({ defaultPath: filename, filters: [{ name: filename, extensions: [blob.type || 'application/octet-stream'] }] });
  } catch (err) {
    if (/cancel/i.test(String(err))) throw new SaveCancelled();
    throw new Error(t('save.failed', { detail: String(err) }));
  }
  if (!target) throw new SaveCancelled();
  try {
    // Android's WebView sends every call to the app as JSON, a byte becoming
    // a number of up to four characters, so the file goes in slices: one
    // whole 50 MB PDF would be a 200 MB string.
    const file = await open(target, { write: true, create: true, truncate: true });
    try {
      for (let at = 0; at < blob.size; ) {
        const slice = new Uint8Array(await blob.slice(at, at + WRITE_SLICE).arrayBuffer());
        for (let done = 0; done < slice.length; ) {
          const wrote = await file.write(done ? slice.subarray(done) : slice);
          if (wrote <= 0) throw new Error('0 bytes written');
          done += wrote;
        }
        at += slice.length;
      }
    } finally {
      await file.close();
    }
  } catch (err) {
    throw new Error(t('save.failed', { detail: String(err) }));
  }
}
