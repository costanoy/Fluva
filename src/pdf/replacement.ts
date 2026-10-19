import type { CoverOverlay, Overlay, TextOverlay, WorkPage } from './model';

/**
 * Whether a replacement text still looks like the run it replaced — the same
 * font, style and color — in which case it's drawn with that run's own font
 * program and text state wherever it now sits (see textRemoval.ts): the
 * cover it pairs with, or -1.
 */
export function runFontCover(overlay: TextOverlay, covers: CoverOverlay[]): number {
  const original = overlay.replaces;
  if (!original || overlay.rotation !== 0 || !overlay.text.trim()) return -1;
  const sameLook =
    overlay.fontKey === original.fontKey &&
    overlay.originalFontKey === original.originalFontKey &&
    overlay.bold === original.bold &&
    overlay.italic === original.italic &&
    overlay.color.toUpperCase() === original.color.toUpperCase();
  return sameLook ? covers.findIndex((cover) => cover.id === original.coverId) : -1;
}

/**
 * The cover a replacement text pairs with when its text is all that changed
 * — same look, spot, size, one line: it then goes back into the original run
 * itself, keeping every bit of its state (clipping, transparency, tagging).
 */
export function inPlaceCover(overlay: TextOverlay, covers: CoverOverlay[]): number {
  const original = overlay.replaces;
  if (!original || /[\r\n]/.test(overlay.text)) return -1;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  if (!near(overlay.size, original.size) || !near(overlay.x, original.x) || !near(overlay.y, original.y)) return -1;
  return runFontCover(overlay, covers);
}

/**
 * What the editor draws into the page itself, the way the export will: every
 * cover (the original text it hides is removed from the page) and every
 * replacement drawn with its run's own font — except `liveId`, the one being
 * edited right now, which stays a live overlay until it's left.
 */
export function pageEdits(page: WorkPage, liveId: string | null): Overlay[] {
  const covers = page.overlays.filter((o): o is CoverOverlay => o.kind === 'cover');
  if (!covers.length) return [];
  const native = page.overlays.filter((o): o is TextOverlay => o.kind === 'text' && o.id !== liveId && runFontCover(o, covers) >= 0);
  return [...covers, ...native];
}
