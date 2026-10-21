import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultWatermark,
  emptyDocument,
  imageEditsOf,
  isImagePage,
  newId,
  NO_ADJUST,
  type DrawOverlay,
  type ImageAdjust,
  type ImageAsset,
  type ImageEdits,
  type ImageFilterId,
  type Overlay,
  type Rect,
  type SourceDoc,
  type TextOverlay,
  type WatermarkConfig,
  type WorkPage,
} from '../pdf/model';
import { compactImageEdits } from '../pdf/imageEdit';
import { aspectInPage, clampRect, coversPage, fitAspect, type CropAspect } from '../pdf/crop';
import { thicknessToPoints } from '../pdf/annotations';
import { FILE_ACCEPT, formatBytes, IMAGE_ACCEPT, imageMimeOf, isAcceptedFile, loadFile, stripExtension, fileKind, MAX_FILE_BYTES } from '../pdf/loader';
import { TEXT_BASELINE_RATIO, isCoveredRect } from '../pdf/geometry';
import { canvasToBlob, releaseAll } from '../pdf/render';
import type { CompressLevel, SplitResult } from '../pdf/ops';
import type { ExportFormat } from '../pdf/exporters';
import { DEFAULT_FAMILY_KEY, cleanFontName, familyByKey, matchSubstitute } from '../pdf/fonts';
import { extractPageText, sampleRunColors, type SampledColors } from '../pdf/textExtract';
import { getLang, setLang as setGlobalLang, t, type Lang } from '../i18n/translations';
import {
  applySnapshot,
  snapshot,
  type AppState,
  type CropDraft,
  type DrawSettings,
  type FileRejection,
  type QueuedFile,
  type SignOutcome,
  type Screen,
  type SplitMode,
  type SplitPagesSubMode,
  type SplitRangeItem,
  type SplitRangeSubMode,
  type TextItem,
  type TextRunDraft,
} from './appTypes';

const initialState: AppState = {
  lang: getLang(),
  screen: 'empty',
  doc: emptyDocument(),
  readerFile: null,
  spareSourceIds: [],
  queue: [],
  activePageIndex: 0,
  toolMode: null,
  selectedOverlayId: null,
  editingTextId: null,
  textRunTarget: null,
  textRunDraft: null,
  pendingOverlayId: null,
  movingOverlayId: null,
  capturedFontKey: null,
  fontPickerActive: false,
  zoom: null,
  effectiveZoom: 1,
  dirty: false,
  cropDraft: null,
  comparing: false,
  draw: {
    tool: 'pen',
    pen: { color: '#E5383B', thickness: 12 },
    highlighter: { color: '#FFE14D', thickness: 45 },
  },
  exportOpen: false,
  exportFormat: 'pdf',
  signDialogOpen: false,
  mergeSelected: [],
  splitMode: 'range',
  splitRangeSubMode: 'auto',
  splitAutoParts: 1,
  splitCustomRanges: [],
  splitPagesSubMode: 'all',
  splitSelectedPages: [],
  splitMergeSelected: false,
  compressLevel: 'medium',
  compressOutcome: null,
  busy: null,
  toast: null,
  error: null,
  fileRejections: [],
  history: [],
  future: [],
};

type Patch = Partial<AppState> | null;
type Updater = Patch | ((state: AppState) => Patch);

export function useFluvaStore() {
  const [state, setStateRaw] = useState<AppState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Updates UI-only state; does not touch undo history. */
  const set = useCallback((updater: Updater) => {
    setStateRaw((st) => {
      const patch = typeof updater === 'function' ? updater(st) : updater;
      return patch ? { ...st, ...patch } : st;
    });
  }, []);

  /** Which gesture (a box being dragged, a slider being moved) is mid-way —
   * see `liveEdit`. */
  const liveKeyRef = useRef<string | null>(null);

  /** Updates document content and pushes the previous content onto the undo stack. */
  const mutate = useCallback((updater: Updater) => {
    liveKeyRef.current = null;
    setStateRaw((st) => {
      const patch = typeof updater === 'function' ? updater(st) : updater;
      if (!patch) return st;
      return { ...st, ...patch, dirty: true, history: st.history.concat([snapshot(st)]).slice(-50), future: [] };
    });
  }, []);

  /**
   * One step of a gesture that changes the document continuously (dragging a
   * box, moving a slider): applied right away, but only its first step adds
   * an undo entry — holding the state from *before* the gesture. Recording it
   * at the end instead, as before, snapshotted the already-moved state, and
   * undo left the box exactly where it had been dragged to. `done` ends the
   * gesture; a gesture that never ran (a plain click) records as usual.
   */
  const liveEdit = useCallback(
    (key: string, updater: Updater, done: boolean) => {
      if (liveKeyRef.current === key) {
        if (done) liveKeyRef.current = null;
        set(updater);
        return;
      }
      mutate(updater);
      if (!done) liveKeyRef.current = key;
    },
    [set, mutate],
  );

  const undo = useCallback(() => {
    setStateRaw((st) => {
      if (!st.history.length) return st;
      const prev = st.history[st.history.length - 1];
      return {
        ...st,
        ...applySnapshot(st, prev),
        history: st.history.slice(0, -1),
        future: st.future.concat([snapshot(st)]),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setStateRaw((st) => {
      if (!st.future.length) return st;
      const next = st.future[st.future.length - 1];
      return {
        ...st,
        ...applySnapshot(st, next),
        history: st.history.concat([snapshot(st)]),
        future: st.future.slice(0, -1),
      };
    });
  }, []);

  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Let the browser's own undo work while the user is typing in a field.
      if (target && (/^(INPUT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      // Ctrl+Y is redo on Windows, next to Ctrl+Shift+Z everywhere.
      if (key === 'y' && !e.shiftKey) {
        e.preventDefault();
        redoRef.current();
        return;
      }
      if (key !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redoRef.current();
      else undoRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const withBusy = useCallback(
    async <T,>(label: string, fn: (progress: (done: number, total: number) => void) => Promise<T>): Promise<T | null> => {
      set({ busy: { label }, error: null });
      try {
        const result = await fn((done, total) => set({ busy: { label, done, total } }));
        set({ busy: null });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : t('store.genericError');
        set({ busy: null, error: message });
        return null;
      }
    },
    [set],
  );

  const actions = useMemo(() => {
    const currentPage = (st: AppState): WorkPage | undefined => st.doc.pages[st.activePageIndex];

    const replacePage = (st: AppState, index: number, next: WorkPage): WorkPage[] =>
      st.doc.pages.map((p, i) => (i === index ? next : p));

    /** The crop tool's starting point for a page: where it's cropped now. */
    const cropDraftFor = (page: WorkPage): CropDraft => {
      const e = imageEditsOf(page);
      return {
        pageId: page.id,
        rect: page.crop ? clampRect(page.crop, page) : { x: 0, y: 0, width: page.width, height: page.height },
        rotation: page.rotation,
        flipH: e.flipH,
        flipV: e.flipV,
        straighten: e.straighten,
        aspect: 'free',
      };
    };

    /** A page's photo edits through `fn`, by page id. */
    const writeImageEdits = (st: AppState, pageId: string, fn: (e: ImageEdits) => ImageEdits): Patch => {
      const index = st.doc.pages.findIndex((p) => p.id === pageId);
      const page = st.doc.pages[index];
      if (!page || !isImagePage(st.doc, page)) return null;
      const image = compactImageEdits(fn(imageEditsOf(page)));
      return { doc: { ...st.doc, pages: replacePage(st, index, { ...page, image }) } };
    };

    const updateActivePage = (fn: (page: WorkPage) => WorkPage) =>
      mutate((st) => {
        const page = currentPage(st);
        if (!page) return null;
        return { doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, fn(page)) } };
      });

    /**
     * Shared by `replaceTextRun` and `commitPendingTextRunEdit` — covers the
     * original run, then draws editable text on top.
     *
     * `bounds` (the detected run) stores its own top as `originalBaseline -
     * originalFontSize * 0.2`, with `bounds.height === originalFontSize * 1.2`
     * (see textExtract.ts). Recovering that baseline and re-adding this
     * overlay's own TEXT_BASELINE_RATIO drop is what lands the new glyphs
     * exactly where the old ones sat, however different its size is — using
     * `bounds.y` directly here would anchor the new text almost a full line
     * below the original, which read as the text "jumping" on click.
     */
    const buildTextReplacementOverlays = (
      bounds: Rect,
      text: string,
      fontKey: string,
      size: number,
      bold: boolean,
      italic: boolean,
      colors: SampledColors = { color: '#2C2C2A', backgroundColor: '#FFFFFF' },
      originalFontKey?: string,
      original?: TextItem,
    ) => {
      const originalBaseline = bounds.y + bounds.height / 6;
      const cover: Overlay = {
        id: newId('ov'),
        kind: 'cover',
        x: bounds.x - 1,
        y: bounds.y - 1,
        width: bounds.width + 2,
        height: bounds.height + 2,
        color: colors.backgroundColor,
      };
      const replacement: TextOverlay = {
        id: newId('ov'),
        kind: 'text',
        x: bounds.x,
        y: originalBaseline + size * TEXT_BASELINE_RATIO,
        text,
        fontKey,
        originalFontKey,
        size,
        bold,
        italic,
        color: colors.color,
        rotation: 0,
      };
      // How the overlay looks when only the text changed — while it still
      // does, the export writes the new text back into the run itself.
      if (original) {
        const originalSize = Math.round(original.fontSize * 10) / 10;
        replacement.replaces = {
          coverId: cover.id,
          x: bounds.x,
          y: originalBaseline + originalSize * TEXT_BASELINE_RATIO,
          fontKey: original.substituteKey,
          originalFontKey: original.originalFontKey,
          size: originalSize,
          bold: original.bold,
          italic: original.italic,
          color: colors.color,
        };
      }
      return { cover, replacement };
    };

    /**
     * The actual work behind the `commitPendingTextRunEdit` action — pulled out
     * so other actions that also mean "the user is leaving this text run" (like
     * switching pages) can trigger the same save without going through the
     * public action object, which doesn't exist yet while it's being built.
     *
     * A no-op if there's no target, or if the draft is empty/unchanged from the
     * original (nothing worth saving, and an empty replacement isn't allowed
     * here either, matching the disabled state of the explicit button).
     *
     * Sampling the run's own ink/background color reads the actual rendered
     * page, so it takes a beat — `textRunTarget`/`textRunDraft` are cleared
     * immediately regardless (the caller is already moving on), and the save
     * itself is applied by page id once sampling resolves, never by
     * `activePageIndex` and never touching selection — either could easily
     * point somewhere else entirely by the time this finishes.
     */
    const commitTextRunEditNow = () => {
      const st = stateRef.current;
      const target = st.textRunTarget;
      const draft = st.textRunDraft;
      if (!target || !draft) return;
      const unchanged =
        draft.text === target.text &&
        draft.fontKey === target.substituteKey &&
        draft.useOriginalFont === !!target.originalFontKey &&
        draft.size === Math.round(target.fontSize * 10) / 10 &&
        draft.bold === target.bold &&
        draft.italic === target.italic;
      if (!draft.text.trim() || unchanged) {
        set({ textRunTarget: null, textRunDraft: null });
        return;
      }
      const page = currentPage(st);
      if (!page) {
        set({ textRunTarget: null, textRunDraft: null });
        return;
      }
      const pageId = page.id;
      const bounds: Rect = { x: target.x, y: target.y, width: target.width, height: target.height };
      const originalFontKey = draft.useOriginalFont ? target.originalFontKey : undefined;
      set({ textRunTarget: null, textRunDraft: null });
      sampleRunColors(st.doc, page, [bounds]).then(([colors]) => {
        mutate((cur) => {
          const idx = cur.doc.pages.findIndex((p) => p.id === pageId);
          if (idx === -1) return null; // the page was deleted while colors were sampling
          const targetPage = cur.doc.pages[idx];
          const { cover, replacement } = buildTextReplacementOverlays(bounds, draft.text, draft.fontKey, draft.size, draft.bold, draft.italic, colors, originalFontKey, target);
          const nextPage = { ...targetPage, overlays: [...targetPage.overlays, cover, replacement] };
          const pages = cur.doc.pages.map((p, i) => (i === idx ? nextPage : p));
          return { doc: { ...cur.doc, pages } };
        });
      });
    };

    const addOverlayToActivePage = (overlay: Overlay) =>
      mutate((st) => {
        const page = currentPage(st);
        if (!page) return null;
        const next = { ...page, overlays: [...page.overlays, overlay] };
        return {
          doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, next) },
          selectedOverlayId: overlay.id,
          toolMode: null,
        };
      });

    const pickFile = (accept: string, multiple = false): Promise<File[]> =>
      new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = multiple;
        input.onchange = () => resolve(Array.from(input.files ?? []));
        input.oncancel = () => resolve([]);
        input.click();
      });

    const registerAsset = async (file: File): Promise<ImageAsset> => {
      // Without its metadata (a photo's GPS position, phone, date) and upright.
      const { prepareImage } = await import('../pdf/imagePrep');
      const original = new Uint8Array(await file.arrayBuffer());
      const { bytes, mime, width, height } = await prepareImage(original, imageMimeOf(file));
      return { id: newId('asset'), bytes, mime, width, height };
    };

    return {
      /* ---------------------------------------------------------------- queue */

      addFiles: (files: File[]) => {
        const accepted: QueuedFile[] = [];
        const rejected: FileRejection[] = [];
        for (const file of files) {
          if (!isAcceptedFile(file)) {
            rejected.push({ id: newId('rej'), kind: 'type', name: file.name, size: file.size });
            continue;
          }
          if (file.size > MAX_FILE_BYTES) {
            rejected.push({ id: newId('rej'), kind: 'size', name: file.name, size: file.size });
            continue;
          }
          accepted.push({ id: newId('q'), file, name: file.name, size: file.size, kind: fileKind(file) });
        }
        const st = stateRef.current;
        // A single clean file (nothing rejected alongside it, nothing already
        // queued) goes straight into the fast reader — the common case, and
        // the whole point of "reader first". Once there's more than one file
        // in play, viewing them as a single reading session no longer makes
        // sense, so it falls back to the existing queue + chooser (merge on
        // edit, or batch convert).
        if (accepted.length === 1 && !rejected.length && !st.queue.length) {
          set({ screen: 'reading', readerFile: accepted[0].file, error: null, fileRejections: [] });
          return;
        }
        set((cur) => ({
          queue: cur.queue.concat(accepted),
          error: null,
          fileRejections: rejected,
        }));
      },

      pickFiles: async () => {
        const files = await pickFile(FILE_ACCEPT, true);
        if (files.length) actions.addFiles(files);
      },

      removeQueued: (id: string) => set((st) => ({ queue: st.queue.filter((q) => q.id !== id) })),

      clearError: () => set({ error: null }),
      dismissRejection: (id: string) => set((st) => ({ fileRejections: st.fileRejections.filter((r) => r.id !== id) })),

      /** Loads every queued file: the first becomes the working document, the rest stay available to merge. */
      /** Loads every queued file into one document — when more than one was
       * picked together, their pages are already joined end to end, rather
       * than opening just the first and leaving the rest to merge by hand. */
      openQueue: async (override?: unknown) => {
        // An explicit list (from the reader) wins over `state.queue`, which a
        // `set()` made in the same tick hasn't reached `stateRef` yet. Also
        // used directly as an onClick handler, hence the array check.
        const queue = Array.isArray(override) ? (override as QueuedFile[]) : stateRef.current.queue;
        if (!queue.length) return;
        await withBusy(t('store.openingFiles'), async (progress) => {
          const sources: Record<string, SourceDoc> = {};
          const assets: Record<string, ImageAsset> = {};
          let pages: WorkPage[] = [];
          let name = '';
          let kind: 'pdf' | 'image' = 'pdf';

          for (let i = 0; i < queue.length; i++) {
            const loaded = await loadFile(queue[i].file);
            sources[loaded.source.id] = loaded.source;
            if (loaded.asset) assets[loaded.asset.id] = loaded.asset;
            pages = pages.concat(loaded.pages);
            if (i === 0) {
              name = loaded.source.name;
              kind = loaded.source.kind;
            }
            progress(i + 1, queue.length);
          }

          set({
            screen: 'editing',
            doc: { sources, assets, pages, watermark: defaultWatermark(), name, kind },
            spareSourceIds: [],
            queue: [],
            toast: queue.length > 1 ? t('store.filesJoined', { count: queue.length }) : null,
            activePageIndex: 0,
            toolMode: null,
            selectedOverlayId: null,
            editingTextId: null,
            splitMode: 'range',
            splitRangeSubMode: 'auto',
            splitAutoParts: Math.min(2, pages.length) || 1,
            splitCustomRanges: [],
            splitPagesSubMode: 'all',
            splitSelectedPages: [],
            splitMergeSelected: false,
            exportFormat: kind === 'pdf' ? 'pdf' : 'png',
            history: [],
            future: [],
            compressOutcome: null,
            dirty: false,
            zoom: null,
            pendingOverlayId: null,
            movingOverlayId: null,
          });
        });
      },

      /** Hands the file currently open in the reader off to the full editor —
       * reuses `openQueue` verbatim rather than duplicating its parsing/opening
       * logic, by seeding the queue with the one file exactly as `addFiles`
       * would have, had this not gone straight to the reader. */
      openReaderFileInEditor: async () => {
        const file = stateRef.current.readerFile;
        if (!file) return;
        await actions.openQueue([{ id: newId('q'), file, name: file.name, size: file.size, kind: fileKind(file) }]);
      },

      /** Same idea as `openReaderFileInEditor`, for the reader's "Alterar
       * formato" shortcut — reuses `convertQueue` verbatim. */
      convertReaderFile: async (target: 'pdf' | 'png' | 'jpg' | 'webp') => {
        const file = stateRef.current.readerFile;
        if (!file) return;
        await actions.convertQueue(target, [{ id: newId('q'), file, name: file.name, size: file.size, kind: fileKind(file) }]);
      },

      /** Converts every queued file to the chosen format and downloads the result. */
      convertQueue: async (target: 'pdf' | 'png' | 'jpg' | 'webp', override?: QueuedFile[]) => {
        const queue = override ?? stateRef.current.queue;
        if (!queue.length) return;
        await withBusy(t('store.convertingTo', { format: target.toUpperCase() }), async (progress) => {
          // Loaded on demand rather than at module load — pdf-lib/docx would
          // otherwise ship in every screen's initial bundle, including the
          // reader and home screen, which never need them.
          const { buildPdf } = await import('../pdf/build');
          const { rasterizeDocument } = await import('../pdf/rasterize');
          const { downloadBytes, imageExportScale, IMAGE_MIME, IMAGE_QUALITY, keepsTransparency, zipFiles } = await import('../pdf/exporters');
          const outputs: Array<{ name: string; bytes: Uint8Array }> = [];

          for (let i = 0; i < queue.length; i++) {
            const loaded = await loadFile(queue[i].file);
            const base = stripExtension(loaded.source.name);
            const doc = {
              sources: { [loaded.source.id]: loaded.source },
              assets: loaded.asset ? { [loaded.asset.id]: loaded.asset } : {},
              pages: loaded.pages,
              watermark: defaultWatermark(),
              name: loaded.source.name,
              kind: loaded.source.kind,
            };

            if (target === 'pdf') {
              outputs.push({ name: `${base}.pdf`, bytes: await buildPdf(doc) });
            } else {
              const mime = IMAGE_MIME[target];
              // An image keeps its own resolution (and what's see-through in
              // it); each page is encoded as soon as it's drawn.
              await rasterizeDocument(
                doc,
                (p) => imageExportScale(doc, doc.pages[p]),
                async (canvas, p, total) => {
                  const blob = await canvasToBlob(canvas, mime, IMAGE_QUALITY[target]);
                  const suffix = total > 1 ? t('file.page', { n: p + 1 }) : '';
                  outputs.push({ name: `${base}${suffix}.${target}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
                },
                (p) => keepsTransparency(doc, doc.pages[p], target),
              );
            }
            progress(i + 1, queue.length);
          }

          if (outputs.length === 1) {
            downloadBytes(outputs[0].bytes, outputs[0].name, target === 'pdf' ? 'application/pdf' : IMAGE_MIME[target]);
          } else {
            // PNG, JPEG and WebP are compressed already; deflating them again only costs time.
            zipFiles(outputs, `${t('file.converted', { format: target })}.zip`, target === 'pdf' ? 6 : 0);
          }
          set({ toast: t('store.filesConverted', { count: outputs.length, format: target.toUpperCase() }) });
        });
      },

      /* -------------------------------------------------------------- session */

      reset: () => {
        releaseAll();
        setStateRaw({ ...initialState, doc: emptyDocument() });
      },

      /** Switches between the home-adjacent screens (empty/beta) — no document
       * state to preserve or discard, so a plain UI-only navigation. */
      setScreen: (screen: Screen) => set({ screen }),

      /** Also updates the module-level language mirror (see i18n/translations.ts)
       * so code outside React — the pdf/ pipeline's own toasts and thrown
       * errors — picks up the change too, not just components re-rendered
       * through this state. */
      setLang: (lang: Lang) => {
        setGlobalLang(lang);
        set({ lang });
      },

      /** Renames the document — this is what every export filename is derived
       * from (see `baseNameFor`). Kept off the undo stack (`set`, not `mutate`)
       * so backspacing through a typo doesn't also eat Ctrl+Z presses meant for
       * page edits; still flags the document dirty so the unsaved-changes
       * warning covers a rename with nothing else touched. */
      renameDocument: (name: string) => set((st) => ({ doc: { ...st.doc, name }, dirty: true })),

      /* ---------------------------------------------------------- page basics */

      setActivePage: (index: number) => {
        commitTextRunEditNow();
        set((st) => {
          const page = st.doc.pages[index];
          return {
            activePageIndex: index,
            selectedOverlayId: null,
            editingTextId: null,
            textRunTarget: null,
            textRunDraft: null,
            comparing: false,
            // The crop tool follows to the page now open.
            cropDraft: st.toolMode === 'crop' && page ? cropDraftFor(page) : null,
          };
        });
      },

      rotateActivePage: () => updateActivePage((page) => ({ ...page, rotation: (page.rotation + 90) % 360 })),

      addBlankPage: () =>
        mutate((st) => {
          const reference = currentPage(st) ?? st.doc.pages[st.doc.pages.length - 1];
          const page: WorkPage = {
            id: newId('pg'),
            sourceId: null,
            sourceIndex: 0,
            width: reference?.width ?? 595.28,
            height: reference?.height ?? 841.89,
            rotation: 0,
            crop: null,
            overlays: [],
          };
          return { doc: { ...st.doc, pages: [...st.doc.pages, page] }, activePageIndex: st.doc.pages.length };
        }),

      deletePage: (index: number) =>
        mutate((st) => {
          if (st.doc.pages.length <= 1) return null;
          const pages = st.doc.pages.filter((_, i) => i !== index);
          return {
            doc: { ...st.doc, pages },
            activePageIndex: Math.min(st.activePageIndex, pages.length - 1),
            selectedOverlayId: null,
          };
        }),

      movePage: (from: number, to: number) =>
        mutate((st) => {
          if (from === to || from < 0 || to < 0 || from >= st.doc.pages.length || to >= st.doc.pages.length) return null;
          const pages = st.doc.pages.slice();
          const [moved] = pages.splice(from, 1);
          pages.splice(to, 0, moved);
          return { doc: { ...st.doc, pages }, activePageIndex: to };
        }),

      /* ------------------------------------------------------------- overlays */

      addText: () =>
        mutate((st) => {
          const page = currentPage(st);
          if (!page) return null;
          const overlay: Overlay = {
            id: newId('ov'),
            kind: 'text',
            x: page.width * 0.15,
            y: page.height * 0.7,
            text: t('store.newText'),
            fontKey: st.capturedFontKey ?? DEFAULT_FAMILY_KEY,
            // Readable on a phone photo thousands of pixels wide as on A4.
            size: Math.round(Math.max(18, Math.min(page.width, page.height) * 0.03)),
            bold: false,
            italic: false,
            color: '#2C2C2A',
            rotation: 0,
          };
          const next = { ...page, overlays: [...page.overlays, overlay] };
          return {
            doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, next) },
            selectedOverlayId: overlay.id,
          };
        }),

      addImage: async () => {
        const files = await pickFile(IMAGE_ACCEPT);
        if (!files.length) return;
        await withBusy(t('store.insertingImage'), async () => {
          const asset = await registerAsset(files[0]);
          const st = stateRef.current;
          const page = st.doc.pages[st.activePageIndex];
          if (!page) return;
          const maxW = page.width * 0.5;
          const width = Math.min(maxW, asset.width);
          const height = width * (asset.height / asset.width);
          const overlay: Overlay = {
            id: newId('ov'),
            kind: 'image',
            x: (page.width - width) / 2,
            y: (page.height - height) / 2,
            width,
            height,
            assetId: asset.id,
            rotation: 0,
          };
          mutate((s) => {
            const p = s.doc.pages[s.activePageIndex];
            if (!p) return null;
            return {
              doc: {
                ...s.doc,
                assets: { ...s.doc.assets, [asset.id]: asset },
                pages: s.doc.pages.map((x, i) => (i === s.activePageIndex ? { ...p, overlays: [...p.overlays, overlay] } : x)),
              },
              selectedOverlayId: overlay.id,
            };
          });
        });
      },

      addShape: () =>
        mutate((st) => {
          const page = currentPage(st);
          if (!page) return null;
          const size = Math.min(page.width, page.height) * 0.18;
          const overlay: Overlay = {
            id: newId('ov'),
            kind: 'shape',
            x: (page.width - size) / 2,
            y: (page.height - size) / 2,
            width: size,
            height: size,
            shape: 'rect',
            color: '#1D9E75',
            rotation: 0,
          };
          const next = { ...page, overlays: [...page.overlays, overlay] };
          return {
            doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, next) },
            selectedOverlayId: overlay.id,
            pendingOverlayId: overlay.id,
          };
        }),

      /** An arrow across the middle of the page, selected to adjust. */
      addLine: () => {
        const page = currentPage(stateRef.current);
        if (!page) return;
        addOverlayToActivePage({
          id: newId('ov'),
          kind: 'line',
          x: page.width * 0.32,
          y: page.height * 0.42,
          dx: page.width * 0.34,
          dy: page.height * 0.16,
          color: '#E5383B',
          strokeWidth: thicknessToPoints(10, page),
          arrowStart: false,
          arrowEnd: true,
          dashed: false,
        });
      },

      /** An area of the photo to blur or pixelate, in the middle of the page. */
      addRedaction: () => {
        const st = stateRef.current;
        const page = currentPage(st);
        if (!page || !isImagePage(st.doc, page)) return;
        const size = Math.min(page.width, page.height) * 0.3;
        addOverlayToActivePage({
          id: newId('ov'),
          kind: 'redact',
          x: (page.width - size) / 2,
          y: (page.height - size) / 2,
          width: size,
          height: size,
          effect: 'blur',
          shape: 'rect',
          strength: 60,
        });
      },

      /** A finished freehand stroke, on the open page — left unselected, so
       * the next one can follow straight away. */
      addStroke: (stroke: Omit<DrawOverlay, 'id' | 'kind'>) =>
        mutate((st) => {
          const page = currentPage(st);
          if (!page) return null;
          const overlay: DrawOverlay = { id: newId('ov'), kind: 'draw', ...stroke };
          return { doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, { ...page, overlays: [...page.overlays, overlay] }) } };
        }),

      /** Strokes rubbed out by the eraser — one gesture, one step to undo
       * (`done` ends it; see `liveEdit`). */
      eraseStrokes: (ids: string[], done: boolean) =>
        liveEdit(
          'erase',
          (st) => {
            const page = currentPage(st);
            if (!page || !ids.length) return null;
            const overlays = page.overlays.filter((o) => !ids.includes(o.id));
            if (overlays.length === page.overlays.length) return null;
            return { doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, { ...page, overlays }) } };
          },
          done,
        ),

      setDrawSettings: (patch: Partial<DrawSettings>) => set((st) => ({ draw: { ...st.draw, ...patch } })),

      setPenStyle: (pen: 'pen' | 'highlighter', patch: Partial<DrawSettings['pen']>) =>
        set((st) => ({ draw: { ...st.draw, [pen]: { ...st.draw[pen], ...patch } } })),

      selectOverlay: (id: string | null) =>
        set((st) => ({
          selectedOverlayId: id,
          editingTextId: null,
          toolMode: null,
          // Selecting something else (or nothing) implicitly confirms whatever
          // shape/text was pending or being moved; only staying on the same one
          // keeps that state.
          pendingOverlayId: id === st.pendingOverlayId ? st.pendingOverlayId : null,
          movingOverlayId: id === st.movingOverlayId ? st.movingOverlayId : null,
        })),

      setMovingOverlay: (id: string | null) => set({ movingOverlayId: id }),

      confirmPendingOverlay: () => set({ pendingOverlayId: null }),

      /** `recordHistory: false` for each step of a drag or slide, then `true`
       * to end it (see `liveEdit`). */
      updateOverlay: (id: string, patch: Partial<Overlay>, recordHistory = true) => {
        const apply = (st: AppState): Patch => {
          const page = currentPage(st);
          if (!page) return null;
          const overlays = page.overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o));
          return { doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, { ...page, overlays }) } };
        };
        liveEdit(`overlay:${id}`, apply, recordHistory);
      },

      removeOverlay: (id: string) =>
        mutate((st) => {
          const page = currentPage(st);
          if (!page) return null;
          const overlays = page.overlays.filter((o) => o.id !== id);
          return {
            doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, { ...page, overlays }) },
            selectedOverlayId: null,
          };
        }),

      /**
       * Replaces an original text run: covers it, then draws editable text on
       * top. Reads the run's own ink/background color off the rendered page
       * first (a beat's delay), then commits by page id — never by
       * `activePageIndex`, which could point somewhere else by the time
       * sampling resolves.
       *
       * Routed through `withBusy` so that beat has a visible "something is
       * happening" state instead of a gap where `textRunTarget` has already
       * been cleared by the caller but the replacement overlay doesn't exist
       * yet — during which the panel had nothing to show but the generic
       * "Adicionar" view and the selection ring simply wasn't there yet. This
       * also gives the sampling step the same error handling every other
       * async action gets, instead of a silent, permanently stuck UI if it
       * ever rejects. `textRunTarget`/`textRunDraft` are cleared here, in the
       * same commit as the new overlay's selection — callers no longer clear
       * them themselves, so there's never a render in between with neither.
       *
       * `offset` shifts only the replacement text's final resting spot, not
       * the cover — the cover always blanks the run's real original position,
       * regardless of where the new text ends up. This is how dragging the
       * preview's own move handle (see TextRunPreview) commits straight into
       * its dragged position in one gesture, instead of landing back on the
       * original spot and needing a second, separate drag once "Movendo
       * texto" mode turns on.
       */
      replaceTextRun: (
        bounds: Rect,
        text: string,
        fontKey: string,
        size: number,
        bold: boolean,
        italic: boolean,
        enterMoveMode = false,
        offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
        originalFontKey?: string,
      ) => {
        const st = stateRef.current;
        const page = currentPage(st);
        if (!page) return;
        const pageId = page.id;
        // The run being replaced, when this is the one open in the panel.
        const target = st.textRunTarget;
        const original =
          target && target.x === bounds.x && target.y === bounds.y && target.width === bounds.width && target.height === bounds.height ? target : undefined;
        withBusy(t('store.applying'), async () => {
          const [colors] = await sampleRunColors(st.doc, page, [bounds]);
          mutate((cur) => {
            const idx = cur.doc.pages.findIndex((p) => p.id === pageId);
            if (idx === -1) return null;
            const targetPage = cur.doc.pages[idx];
            const { cover, replacement } = buildTextReplacementOverlays(bounds, text, fontKey, size, bold, italic, colors, originalFontKey, original);
            replacement.x += offset.dx;
            replacement.y += offset.dy;
            const nextPage = { ...targetPage, overlays: [...targetPage.overlays, cover, replacement] };
            const pages = cur.doc.pages.map((p, i) => (i === idx ? nextPage : p));
            return {
              doc: { ...cur.doc, pages },
              selectedOverlayId: replacement.id,
              editingTextId: null,
              movingOverlayId: enterMoveMode ? replacement.id : null,
              textRunTarget: null,
              textRunDraft: null,
            };
          });
        });
      },

      setEditingText: (id: string | null) => set({ editingTextId: id, selectedOverlayId: null }),

      setTextRunTarget: (item: TextItem | null) =>
        set({
          textRunTarget: item,
          textRunDraft: item
            ? {
                text: item.text,
                fontKey: item.substituteKey,
                useOriginalFont: !!item.originalFontKey,
                size: Math.round(item.fontSize * 10) / 10,
                bold: item.bold,
                italic: item.italic,
              }
            : null,
        }),

      setTextRunDraft: (patch: Partial<TextRunDraft>) =>
        set((st) => (st.textRunDraft ? { textRunDraft: { ...st.textRunDraft, ...patch } } : null)),

      /**
       * Called whenever the user leaves a text run being edited — clicking blank
       * page, selecting something else, picking a different run, or switching
       * pages — so nothing needs an explicit "Substituir texto" click to be kept.
       */
      commitPendingTextRunEdit: commitTextRunEditNow,

      /**
       * Scans every page for runs whose original font matches the given one
       * (the same detection `matchSubstitute` itself uses) and rewrites each —
       * keeping that run's own text, size, bold/italic, ink color and
       * background — just switching the family to the chosen substitute. Lets
       * one font choice apply document-wide instead of repeating it run by run,
       * without flattening every run's own formatting to whatever the one run
       * the user started from happened to look like.
       */
      applyFontToMatchingRuns: (originalFont: string, fontKey: string, excludeRunId?: string) =>
        withBusy(t('store.findingFont'), async () => {
          const st = stateRef.current;
          const target = cleanFontName(originalFont).toLowerCase();
          const familyLabel = familyByKey(fontKey).label;
          if (!target) {
            set({ toast: t('store.fontNotIdentified') });
            return 0;
          }

          const perPage = await Promise.all(
            st.doc.pages.map(async (page) => {
              const items = await extractPageText(st.doc, page);
              // A run the user already replaced is skipped: rewriting it again
              // from its original text would silently undo that edit.
              const covers = page.overlays.filter((o) => o.kind === 'cover');
              const matches = items.filter(
                (item) => item.id !== excludeRunId && !isCoveredRect(item, covers) && cleanFontName(item.originalFont).toLowerCase() === target,
              );
              if (!matches.length) return { pageId: page.id, matches, colors: [] as SampledColors[] };
              const colors = await sampleRunColors(
                st.doc,
                page,
                matches.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height })),
              );
              return { pageId: page.id, matches, colors };
            }),
          );

          const totalMatches = perPage.reduce((n, p) => n + p.matches.length, 0);
          if (!totalMatches) {
            set({ toast: t('store.noOtherFontFound') });
            return 0;
          }

          mutate((cur) => {
            const pages = cur.doc.pages.map((page) => {
              const found = perPage.find((p) => p.pageId === page.id);
              if (!found || !found.matches.length) return page;
              const added = found.matches.flatMap((item, i) => {
                const bounds: Rect = { x: item.x, y: item.y, width: item.width, height: item.height };
                const size = Math.round(item.fontSize * 10) / 10;
                const { cover, replacement } = buildTextReplacementOverlays(bounds, item.text, fontKey, size, item.bold, item.italic, found.colors[i]);
                return [cover, replacement];
              });
              return { ...page, overlays: [...page.overlays, ...added] };
            });
            return { doc: { ...cur.doc, pages } };
          });

          set({ toast: t('store.textsUpdated', { count: totalMatches, font: familyLabel }) });
          return totalMatches;
        }),

      /* ------------------------------------------------------------ watermark */

      /** Same live/commit pairing as `updateOverlay`. */
      updateWatermark: (patch: Partial<WatermarkConfig>, recordHistory = true) => {
        const apply = (st: AppState): Patch => ({ doc: { ...st.doc, watermark: { ...st.doc.watermark, ...patch } } });
        liveEdit('watermark', apply, recordHistory);
      },

      /** A one-page watermark follows whichever page is open — not an edit
       * of its own, so it stays out of the undo history. */
      followWatermarkPage: (index: number) =>
        set((st) => ({ doc: { ...st.doc, watermark: { ...st.doc.watermark, singlePageIndex: index } } })),

      uploadWatermarkImage: async () => {
        const files = await pickFile(IMAGE_ACCEPT);
        if (!files.length) return;
        await withBusy(t('store.loadingWatermark'), async () => {
          const asset = await registerAsset(files[0]);
          mutate((st) => ({
            doc: {
              ...st.doc,
              assets: { ...st.doc.assets, [asset.id]: asset },
              watermark: { ...st.doc.watermark, enabled: true, source: { kind: 'image', assetId: asset.id } },
            },
          }));
        });
      },

      /* ---------------------------------------------------------------- tools */

      setTool: (toolMode: AppState['toolMode']) =>
        set((st) => ({
          toolMode: st.toolMode === toolMode ? null : toolMode,
          cropDraft: toolMode === 'crop' && st.toolMode !== 'crop' && currentPage(st) ? cropDraftFor(currentPage(st)!) : null,
          comparing: false,
          selectedOverlayId: null,
          editingTextId: null,
          compressOutcome: toolMode === 'compress' ? st.compressOutcome : null,
          splitMode: 'range',
          splitRangeSubMode: 'auto',
          splitAutoParts: Math.min(2, st.doc.pages.length) || 1,
          splitCustomRanges: [],
          splitPagesSubMode: 'all',
          splitSelectedPages: [],
          splitMergeSelected: false,
        })),

      toggleMergeSource: (sourceId: string) =>
        set((st) => ({
          mergeSelected: st.mergeSelected.includes(sourceId)
            ? st.mergeSelected.filter((id) => id !== sourceId)
            : st.mergeSelected.concat([sourceId]),
        })),

      reorderMergeSelection: (from: number, to: number) =>
        set((st) => {
          const order = st.mergeSelected.slice();
          const [moved] = order.splice(from, 1);
          order.splice(to, 0, moved);
          return { mergeSelected: order };
        }),

      addFilesToMerge: async () => {
        const files = await pickFile('application/pdf', true);
        if (!files.length) return;
        await withBusy(t('store.loadingPdfs'), async (progress) => {
          const sources: Record<string, SourceDoc> = {};
          const ids: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const loaded = await loadFile(files[i]);
            if (loaded.source.kind !== 'pdf') continue;
            sources[loaded.source.id] = loaded.source;
            ids.push(loaded.source.id);
            progress(i + 1, files.length);
          }
          set((st) => ({
            doc: { ...st.doc, sources: { ...st.doc.sources, ...sources } },
            spareSourceIds: st.spareSourceIds.concat(ids),
            mergeSelected: st.mergeSelected.concat(ids),
          }));
        });
      },

      confirmMerge: () =>
        mutate((st) => {
          if (!st.mergeSelected.length) return null;
          const added: WorkPage[] = [];
          for (const sourceId of st.mergeSelected) {
            const source = st.doc.sources[sourceId];
            if (!source) continue;
            for (let i = 0; i < source.pageCount; i++) {
              added.push({
                id: newId('pg'),
                sourceId,
                sourceIndex: i,
                width: source.pageSizes[i].width,
                height: source.pageSizes[i].height,
                rotation: 0,
                crop: null,
                overlays: [],
              });
            }
          }
          if (!added.length) return null;
          const count = st.mergeSelected.length;
          return {
            doc: { ...st.doc, pages: [...st.doc.pages, ...added] },
            spareSourceIds: st.spareSourceIds.filter((id) => !st.mergeSelected.includes(id)),
            mergeSelected: [],
            toolMode: null,
            toast: t('store.filesJoinedCount', { count, pages: added.length }),
          };
        }),

      setSplitMode: (mode: SplitMode) => set({ splitMode: mode }),

      setSplitRangeSubMode: (mode: SplitRangeSubMode) => set({ splitRangeSubMode: mode }),

      /** Clamped here (not just via the input's min/max) so a typed '0' or a
       * number past the page count can never actually be stored. */
      setSplitAutoParts: (n: number) => {
        const total = stateRef.current.doc.pages.length;
        set({ splitAutoParts: Math.max(1, Math.min(total || 1, Math.round(n) || 1)) });
      },

      addSplitCustomRange: () =>
        set((st) => ({
          splitCustomRanges: [...st.splitCustomRanges, { id: newId('rg'), start: 1, end: st.doc.pages.length }],
        })),

      updateSplitCustomRange: (id: string, patch: Partial<Pick<SplitRangeItem, 'start' | 'end'>>) =>
        set((st) => ({
          splitCustomRanges: st.splitCustomRanges.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),

      removeSplitCustomRange: (id: string) =>
        set((st) => ({ splitCustomRanges: st.splitCustomRanges.filter((r) => r.id !== id) })),

      setSplitPagesSubMode: (mode: SplitPagesSubMode) => set({ splitPagesSubMode: mode }),

      toggleSplitSelectedPage: (pageNumber: number) =>
        set((st) => ({
          splitSelectedPages: st.splitSelectedPages.includes(pageNumber)
            ? st.splitSelectedPages.filter((p) => p !== pageNumber)
            : [...st.splitSelectedPages, pageNumber].sort((a, b) => a - b),
        })),

      setSplitMergeSelected: (v: boolean) => set({ splitMergeSelected: v }),

      /** Reads whichever split mode/sub-mode is currently active and runs it —
       * the same four operations the center preview is describing live. */
      runSplit: async () => {
        const st = stateRef.current;
        await withBusy(t('store.dividing'), async () => {
          const { splitByRanges, splitEveryPage, splitIntoParts, extractSelectedPages } = await import('../pdf/ops');
          const { baseNameFor, downloadBytes, zipFiles } = await import('../pdf/exporters');
          const baseName = baseNameFor(st.doc);
          let results: SplitResult[] = [];
          let message = '';

          if (st.splitMode === 'range') {
            if (st.splitRangeSubMode === 'auto') {
              results = await splitIntoParts(st.doc, baseName, st.splitAutoParts);
              message = t('store.dividedInto', { count: results.length });
            } else {
              if (!st.splitCustomRanges.length) {
                set({ toast: t('store.addAtLeastOneInterval') });
                return;
              }
              results = await splitByRanges(st.doc, baseName, st.splitCustomRanges);
              message = t('store.dividedInto', { count: results.length });
            }
          } else {
            if (st.splitPagesSubMode === 'all') {
              results = await splitEveryPage(st.doc, baseName);
              message = t('store.pdfsPerPage', { count: results.length });
            } else {
              if (!st.splitSelectedPages.length) {
                set({ toast: t('store.selectAtLeastOnePage') });
                return;
              }
              results = await extractSelectedPages(st.doc, baseName, st.splitSelectedPages, st.splitMergeSelected);
              message = st.splitMergeSelected
                ? t('store.pagesMergedIntoOne')
                : t('store.pdfsFromSelection', { count: results.length });
            }
          }

          if (results.length === 1) downloadBytes(results[0].bytes, results[0].name, 'application/pdf');
          else zipFiles(results.map((r) => ({ name: r.name, bytes: r.bytes })), `${baseName}${t('file.split')}.zip`);
          set({ toast: message, toolMode: null });
        });
      },

      /* ------------------------------------------------------------- crop */

      /** (Re)starts the crop tool on the open page. */
      beginCrop: () =>
        set((st) => {
          const page = currentPage(st);
          return page ? { toolMode: 'crop', cropDraft: cropDraftFor(page), selectedOverlayId: null, editingTextId: null } : null;
        }),

      updateCropDraft: (patch: Partial<CropDraft>) => set((st) => (st.cropDraft ? { cropDraft: { ...st.cropDraft, ...patch } } : null)),

      /** A proportion for the crop box: the biggest box of it, where the box is. */
      setCropAspect: (aspect: CropAspect) =>
        set((st) => {
          const draft = st.cropDraft;
          const page = currentPage(st);
          if (!draft || !page) return null;
          return { cropDraft: { ...draft, aspect, rect: fitAspect(draft.rect, aspectInPage(aspect, page, draft.rotation), page) } };
        }),

      /** A quarter turn, clockwise (1) or back (-1). */
      turnCropDraft: (quarter: 1 | -1) =>
        set((st) => {
          const draft = st.cropDraft;
          const page = currentPage(st);
          if (!draft || !page) return null;
          const rotation = (((draft.rotation + quarter * 90) % 360) + 360) % 360;
          // A chosen proportion keeps its shape on screen through the turn.
          const ratio = draft.aspect === 'original' ? null : aspectInPage(draft.aspect, page, rotation);
          return { cropDraft: { ...draft, rotation, rect: ratio ? fitAspect(draft.rect, ratio, page) : draft.rect } };
        }),

      resetCropDraft: () =>
        set((st) => {
          const page = currentPage(st);
          if (!page || !st.cropDraft) return null;
          return {
            cropDraft: { ...st.cropDraft, rect: { x: 0, y: 0, width: page.width, height: page.height }, rotation: 0, flipH: false, flipV: false, straighten: 0, aspect: 'free' },
          };
        }),

      /** Writes the crop tool's work to the page — one step to undo — and closes it. */
      applyCrop: () => {
        const st = stateRef.current;
        const draft = st.cropDraft;
        const page = currentPage(st);
        if (!draft || !page || draft.pageId !== page.id) {
          set({ toolMode: null, cropDraft: null });
          return;
        }
        const photo = isImagePage(st.doc, page);
        // A photo is cut on whole pixels; a PDF page to a hundredth of a point.
        const step = photo ? 1 : 0.01;
        const snap = (n: number) => Math.round(n / step) * step;
        const r = draft.rect;
        const x0 = snap(r.x);
        const y0 = snap(r.y);
        const crop = coversPage(r, page) ? null : { x: x0, y: y0, width: Math.max(step, snap(r.x + r.width) - x0), height: Math.max(step, snap(r.y + r.height) - y0) };
        const image = photo ? compactImageEdits({ ...imageEditsOf(page), flipH: draft.flipH, flipV: draft.flipV, straighten: draft.straighten }) : page.image;
        const same = JSON.stringify([page.crop, page.rotation, page.image ?? null]) === JSON.stringify([crop, draft.rotation, image ?? null]);
        if (same) {
          set({ toolMode: null, cropDraft: null });
          return;
        }
        mutate((cur) => {
          const index = cur.doc.pages.findIndex((p) => p.id === draft.pageId);
          if (index < 0) return { toolMode: null, cropDraft: null };
          const target = cur.doc.pages[index];
          return {
            doc: { ...cur.doc, pages: replacePage(cur, index, { ...target, crop, rotation: draft.rotation, image }) },
            toolMode: null,
            cropDraft: null,
          };
        });
      },

      cancelCrop: () => set({ toolMode: null, cropDraft: null }),

      /* ----------------------------------------------------------- photo */

      /** One light or colour slider; `recordHistory: false` while it moves (see `liveEdit`). */
      updateImageAdjust: (key: keyof ImageAdjust, value: number, recordHistory = true) => {
        const page = currentPage(stateRef.current);
        if (!page) return;
        liveEdit(`image:${page.id}:${key}`, (st) => writeImageEdits(st, page.id, (e) => ({ ...e, adjust: { ...e.adjust, [key]: value } })), recordHistory);
      },

      setImageFilter: (filter: ImageFilterId) => {
        const page = currentPage(stateRef.current);
        if (!page) return;
        mutate((st) => {
          const target = st.doc.pages.find((p) => p.id === page.id);
          if (!target || imageEditsOf(target).filter === filter) return null;
          return writeImageEdits(st, page.id, (e) => ({ ...e, filter, filterStrength: 100 }));
        });
      },

      setFilterStrength: (value: number, recordHistory = true) => {
        const page = currentPage(stateRef.current);
        if (!page) return;
        liveEdit(`image:${page.id}:filterStrength`, (st) => writeImageEdits(st, page.id, (e) => ({ ...e, filterStrength: value })), recordHistory);
      },

      /** Back to the photo's own light and colour, without a filter. */
      resetImageTone: () => {
        const page = currentPage(stateRef.current);
        if (!page) return;
        mutate((st) => writeImageEdits(st, page.id, (e) => ({ ...e, filter: 'none', filterStrength: 100, adjust: { ...NO_ADJUST } })));
      },

      /** The photo's output size, as pixels per original pixel — on the
       * open page, or on every photo page of the document. */
      setImageScale: (scale: number, everyPhoto = false) =>
        mutate((st) => {
          let patch: Patch = null;
          let cur = st;
          const targets = everyPhoto ? st.doc.pages.filter((p) => isImagePage(st.doc, p)) : [currentPage(st)].filter((p): p is WorkPage => !!p);
          for (const target of targets) {
            const next = writeImageEdits(cur, target.id, (e) => ({ ...e, scale }));
            if (!next) continue;
            patch = next;
            cur = { ...cur, ...next };
          }
          return patch;
        }),

      setComparing: (comparing: boolean) => set({ comparing }),

      setCompressLevel: (level: CompressLevel) => set({ compressLevel: level, compressOutcome: null }),

      runCompress: async () => {
        const st = stateRef.current;
        await withBusy(t('store.compressing'), async (progress) => {
          const { compressDocument, compressImages } = await import('../pdf/ops');
          // A photo comes back a photo: images in, images out.
          if (st.doc.kind === 'image') {
            const { baseNameFor } = await import('../pdf/exporters');
            const result = await compressImages(st.doc, baseNameFor(st.doc), st.compressLevel, progress);
            set({
              compressOutcome: {
                level: st.compressLevel,
                originalSize: result.originalSize,
                compressedSize: result.compressedSize,
                reductionPct: result.reductionPct,
                strategy: 'image',
                bytes: result.images[0]?.bytes ?? new Uint8Array(),
                images: result.images,
              },
            });
            return;
          }
          const result = await compressDocument(st.doc, st.compressLevel, progress);
          set({
            compressOutcome: {
              level: st.compressLevel,
              originalSize: result.originalSize,
              compressedSize: result.compressedSize,
              reductionPct: result.reductionPct,
              strategy: result.strategy,
              bytes: result.bytes,
            },
          });
        });
      },

      downloadCompressed: async () => {
        const outcome = stateRef.current.compressOutcome;
        if (!outcome) return;
        const { baseNameFor, downloadBytes, zipFiles } = await import('../pdf/exporters');
        const base = baseNameFor(stateRef.current.doc);
        if (outcome.images) {
          if (outcome.images.length === 1) downloadBytes(outcome.images[0].bytes, outcome.images[0].name, outcome.images[0].mime);
          // Already compressed: deflating them again only costs time.
          else zipFiles(outcome.images, `${base}${t('file.compressed')}.zip`, 0);
          return;
        }
        downloadBytes(outcome.bytes, `${base}${t('file.compressed')}.pdf`, 'application/pdf');
      },

      /* --------------------------------------------------------------- export */

      toggleExport: () => set((st) => ({ exportOpen: !st.exportOpen })),
      closeExport: () => set({ exportOpen: false }),
      setExportFormat: (exportFormat: ExportFormat) => set({ exportFormat }),

      runExport: async (format: ExportFormat) => {
        const st = stateRef.current;
        const { baseNameFor, exportAsDocx, exportAsImages, exportAsPdf } = await import('../pdf/exporters');
        const base = baseNameFor(st.doc);
        set({ exportOpen: false });
        await withBusy(t('store.exporting'), async (progress) => {
          if (format === 'pdf') {
            const report = await exportAsPdf(st.doc, base);
            set({
              toast: report.protectedAsImages
                ? t('store.protectedAsImages', { name: base })
                : report.replacedTextKept
                  ? t('store.replacedTextKept', { name: base })
                  : t('store.pdfExported', { name: base }),
            });
          } else if (format === 'png' || format === 'jpg' || format === 'webp') {
            await exportAsImages(st.doc, base, format, progress);
            const multi = st.doc.pages.length > 1;
            set({
              toast: multi
                ? t('store.imagesExported', { count: st.doc.pages.length })
                : t('store.imageExported', { name: base, format }),
            });
          } else {
            const { paragraphs, images } = await exportAsDocx(st.doc, base, progress);
            const imageNote = images ? t('store.andImages', { count: images }) : '';
            set({
              toast: paragraphs
                ? t('store.docxExported', { name: base, count: paragraphs, imageNote })
                : t('store.docxExportedNoText', { name: base }),
            });
          }
          // Deliberately NOT clearing `dirty` here. An export is a copy, not a
          // save — the document open in the tab is still the one thing with
          // every edit, and there's no way back into it once the tab closes.
          // Leaving `dirty` set keeps both the beforeunload prompt and the
          // Back-button confirm live for the rest of the session after any
          // edit, exported or not, so neither can silently drop changes.
        });
      },

      dismissToast: () => set({ toast: null }),

      /* ------------------------------------------------------------------ sign */

      setSignDialogOpen: (open: boolean) => set({ signDialogOpen: open, exportOpen: false }),

      /** Bakes the current document, signs it with the user's own certificate,
       * and downloads the result — the certificate and password only ever
       * exist in memory for this one call (see `pdf/sign.ts`). Unlike every
       * other action here, the outcome is handed straight back to
       * `SignDialog` instead of going through `state.busy`/`state.error`: a
       * wrong password is shown inline under the field (keeping the chosen
       * certificate), and success is a screen of its own inside the dialog. */
      signAndDownload: async (pfxFile: File, password: string): Promise<SignOutcome> => {
        const st = stateRef.current;
        try {
          const [{ buildPdf }, { baseNameFor, downloadBytes }, { signPdf }] = await Promise.all([
            import('../pdf/build'),
            import('../pdf/exporters'),
            import('../pdf/sign'),
          ]);
          const pdfBytes = await buildPdf(st.doc);
          const pfxBytes = new Uint8Array(await pfxFile.arrayBuffer());
          const result = await signPdf(pdfBytes, pfxBytes, password);
          const fileName = `${baseNameFor(st.doc)}${t('file.signed')}.pdf`;
          downloadBytes(result.bytes, fileName, 'application/pdf');
          return { ok: true, fileName, ...result };
        } catch (err) {
          const wrongPassword = !!err && typeof err === 'object' && (err as { code?: string }).code === 'wrong-password';
          return { ok: false, wrongPassword, message: err instanceof Error ? err.message : t('store.genericError') };
        }
      },

      /* ----------------------------------------------------------------- zoom */

      setZoom: (zoom: number | null) => set({ zoom }),
      setEffectiveZoom: (effectiveZoom: number) => set({ effectiveZoom }),

      /* ------------------------------------------------------------- font pick */

      setFontPickerActive: (active: boolean) => set({ fontPickerActive: active }),

      /** Reads the font a clicked element is in and maps it to the closest
       * substitute family, so newly added text can match it. A PDF's own text
       * is painted on a canvas: the clickable box over it carries the run's
       * font as `data-font-key` (so do added texts) — its CSS font would only
       * ever be the app's own. */
      captureFontFromElement: (el: Element) => {
        const tagged = el.closest('[data-font-key]')?.getAttribute('data-font-key');
        const family = tagged ? familyByKey(tagged) : matchSubstitute(getComputedStyle(el).fontFamily).family;
        set({ capturedFontKey: family.key, fontPickerActive: false, toast: t('store.fontCaptured', { font: family.label }) });
      },

      undo,
      redo,
    };
  }, [set, mutate, liveEdit, undo, redo, withBusy]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Let Delete/Backspace/Enter do their normal job while the user is typing —
      // including typing directly into a selected overlay's own text on the canvas.
      if (target && (/^(INPUT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable)) return;

      if (e.key === 'Enter' && stateRef.current.movingOverlayId) {
        e.preventDefault();
        actions.setMovingOverlay(null);
        return;
      }

      // The crop tool: Enter applies it, Esc leaves it as it was.
      if (stateRef.current.toolMode === 'crop' && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        if (e.key === 'Enter') actions.applyCrop();
        else actions.cancelCrop();
        return;
      }
      if (stateRef.current.toolMode === 'draw' && e.key === 'Escape') {
        e.preventDefault();
        actions.setTool(null);
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const st = stateRef.current;
      if (st.selectedOverlayId) {
        e.preventDefault();
        actions.removeOverlay(st.selectedOverlayId);
        return;
      }
      // The watermark has no per-instance id to "select" — its panel being
      // open is the closest equivalent, so Delete there removes it the same
      // way it would any other selected thing on the page.
      if (st.toolMode === 'watermark' && st.doc.watermark.enabled) {
        e.preventDefault();
        actions.updateWatermark({ enabled: false }, true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);

  return { state, actions };
}

export type FluvaActions = ReturnType<typeof useFluvaStore>['actions'];
