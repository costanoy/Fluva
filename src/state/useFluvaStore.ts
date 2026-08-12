import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultWatermark,
  emptyDocument,
  newId,
  type ImageAsset,
  type Overlay,
  type Rect,
  type SourceDoc,
  type WatermarkConfig,
  type WorkPage,
} from '../pdf/model';
import { formatBytes, isAcceptedFile, loadFile, readImageSize, stripExtension, fileKind, MAX_FILE_BYTES } from '../pdf/loader';
import { buildPdf, TEXT_BASELINE_RATIO } from '../pdf/build';
import { canvasToBlob, rasterizePdf, releaseAll } from '../pdf/render';
import { compressDocument, extractSelectedPages, splitByRanges, splitEveryPage, splitIntoParts, type CompressLevel } from '../pdf/ops';
import { baseNameFor, downloadBytes, exportAsDocx, exportAsImages, exportAsPdf, zipFiles, type ExportFormat } from '../pdf/exporters';
import { DEFAULT_FAMILY_KEY, cleanFontName, familyByKey, matchSubstitute } from '../pdf/fonts';
import { extractPageText, sampleRunColors, type SampledColors } from '../pdf/textExtract';
import {
  applySnapshot,
  snapshot,
  type AppState,
  type QueuedFile,
  type Screen,
  type SplitMode,
  type SplitPagesSubMode,
  type SplitRangeItem,
  type SplitRangeSubMode,
  type TextItem,
  type TextRunDraft,
} from './appTypes';

const initialState: AppState = {
  screen: 'empty',
  doc: emptyDocument(),
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
  exportOpen: false,
  exportFormat: 'pdf',
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

  /** Updates document content and pushes the previous content onto the undo stack. */
  const mutate = useCallback((updater: Updater) => {
    setStateRaw((st) => {
      const patch = typeof updater === 'function' ? updater(st) : updater;
      if (!patch) return st;
      return { ...st, ...patch, dirty: true, history: st.history.concat([snapshot(st)]).slice(-50), future: [] };
    });
  }, []);

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
      if (e.key.toLowerCase() !== 'z') return;
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
        const message = err instanceof Error ? err.message : 'Algo deu errado.';
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
      const replacement: Overlay = {
        id: newId('ov'),
        kind: 'text',
        x: bounds.x,
        y: originalBaseline + size * TEXT_BASELINE_RATIO,
        text,
        fontKey,
        size,
        bold,
        italic,
        color: colors.color,
        rotation: 0,
      };
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
      set({ textRunTarget: null, textRunDraft: null });
      sampleRunColors(st.doc, page, [bounds]).then(([colors]) => {
        mutate((cur) => {
          const idx = cur.doc.pages.findIndex((p) => p.id === pageId);
          if (idx === -1) return null; // the page was deleted while colors were sampling
          const targetPage = cur.doc.pages[idx];
          const { cover, replacement } = buildTextReplacementOverlays(bounds, draft.text, draft.fontKey, draft.size, draft.bold, draft.italic, colors);
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
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
      const { width, height } = await readImageSize(bytes, mime);
      return { id: newId('asset'), bytes, mime, width, height };
    };

    return {
      /* ---------------------------------------------------------------- queue */

      addFiles: (files: File[]) => {
        const accepted: QueuedFile[] = [];
        const rejected: string[] = [];
        for (const file of files) {
          if (!isAcceptedFile(file)) {
            rejected.push(`${file.name} (formato não suportado)`);
            continue;
          }
          if (file.size > MAX_FILE_BYTES) {
            rejected.push(`${file.name} (${formatBytes(file.size)}, acima de 50MB)`);
            continue;
          }
          accepted.push({ id: newId('q'), file, name: file.name, size: file.size, kind: fileKind(file) });
        }
        set((st) => ({
          queue: st.queue.concat(accepted),
          error: rejected.length ? `Ignorado: ${rejected.join('; ')}` : null,
        }));
      },

      pickFiles: async () => {
        const files = await pickFile('application/pdf,image/png,image/jpeg', true);
        if (files.length) actions.addFiles(files);
      },

      removeQueued: (id: string) => set((st) => ({ queue: st.queue.filter((q) => q.id !== id) })),

      clearError: () => set({ error: null }),

      /** Loads every queued file: the first becomes the working document, the rest stay available to merge. */
      /** Loads every queued file into one document — when more than one was
       * picked together, their pages are already joined end to end, rather
       * than opening just the first and leaving the rest to merge by hand. */
      openQueue: async () => {
        const queue = stateRef.current.queue;
        if (!queue.length) return;
        await withBusy('Abrindo arquivos…', async (progress) => {
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
            toast: queue.length > 1 ? `${queue.length} arquivos juntados em um único documento.` : null,
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

      /** Converts every queued file to the chosen format and downloads the result. */
      convertQueue: async (target: 'pdf' | 'png' | 'jpg') => {
        const queue = stateRef.current.queue;
        if (!queue.length) return;
        await withBusy(`Convertendo para ${target.toUpperCase()}…`, async (progress) => {
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
              const baked = await buildPdf(doc);
              const canvases = await rasterizePdf(baked, 150 / 72);
              const mime = target === 'png' ? 'image/png' : 'image/jpeg';
              for (let p = 0; p < canvases.length; p++) {
                const blob = await canvasToBlob(canvases[p], mime, target === 'jpg' ? 0.92 : undefined);
                const suffix = canvases.length > 1 ? `_pagina_${p + 1}` : '';
                outputs.push({ name: `${base}${suffix}.${target}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
              }
            }
            progress(i + 1, queue.length);
          }

          if (outputs.length === 1) {
            const mime = target === 'pdf' ? 'application/pdf' : target === 'png' ? 'image/png' : 'image/jpeg';
            downloadBytes(outputs[0].bytes, outputs[0].name, mime);
          } else {
            zipFiles(outputs, `convertidos_${target}.zip`);
          }
          set({ toast: `${outputs.length} arquivo(s) convertido(s) para ${target.toUpperCase()}.` });
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

      /* ---------------------------------------------------------- page basics */

      setActivePage: (index: number) => {
        commitTextRunEditNow();
        set({ activePageIndex: index, selectedOverlayId: null, editingTextId: null, textRunTarget: null, textRunDraft: null });
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
            text: 'Novo texto',
            fontKey: st.capturedFontKey ?? DEFAULT_FAMILY_KEY,
            size: 18,
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
        const files = await pickFile('image/png,image/jpeg');
        if (!files.length) return;
        await withBusy('Inserindo imagem…', async () => {
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

      updateOverlay: (id: string, patch: Partial<Overlay>, recordHistory = true) => {
        const apply = (st: AppState): Patch => {
          const page = currentPage(st);
          if (!page) return null;
          const overlays = page.overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o));
          return { doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, { ...page, overlays }) } };
        };
        if (recordHistory) mutate(apply);
        else set(apply);
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
       */
      replaceTextRun: (bounds: Rect, text: string, fontKey: string, size: number, bold: boolean, italic: boolean, enterMoveMode = false) => {
        const st = stateRef.current;
        const page = currentPage(st);
        if (!page) return;
        const pageId = page.id;
        sampleRunColors(st.doc, page, [bounds]).then(([colors]) => {
          mutate((cur) => {
            const idx = cur.doc.pages.findIndex((p) => p.id === pageId);
            if (idx === -1) return null;
            const targetPage = cur.doc.pages[idx];
            const { cover, replacement } = buildTextReplacementOverlays(bounds, text, fontKey, size, bold, italic, colors);
            const nextPage = { ...targetPage, overlays: [...targetPage.overlays, cover, replacement] };
            const pages = cur.doc.pages.map((p, i) => (i === idx ? nextPage : p));
            return {
              doc: { ...cur.doc, pages },
              selectedOverlayId: replacement.id,
              editingTextId: null,
              movingOverlayId: enterMoveMode ? replacement.id : null,
            };
          });
        });
      },

      setEditingText: (id: string | null) => set({ editingTextId: id, selectedOverlayId: null }),

      setTextRunTarget: (item: TextItem | null) =>
        set({
          textRunTarget: item,
          textRunDraft: item
            ? { text: item.text, fontKey: item.substituteKey, size: Math.round(item.fontSize * 10) / 10, bold: item.bold, italic: item.italic }
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
        withBusy('Procurando esta fonte no documento…', async () => {
          const st = stateRef.current;
          const target = cleanFontName(originalFont).toLowerCase();
          const familyLabel = familyByKey(fontKey).label;
          if (!target) {
            set({ toast: 'Não foi possível identificar essa fonte.' });
            return 0;
          }

          const perPage = await Promise.all(
            st.doc.pages.map(async (page) => {
              const items = await extractPageText(st.doc, page);
              const matches = items.filter((item) => item.id !== excludeRunId && cleanFontName(item.originalFont).toLowerCase() === target);
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
            set({ toast: 'Nenhum outro texto com essa fonte foi encontrado no documento.' });
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

          set({ toast: `${totalMatches} texto(s) atualizado(s) para ${familyLabel}.` });
          return totalMatches;
        }),

      /* ------------------------------------------------------------ watermark */

      updateWatermark: (patch: Partial<WatermarkConfig>, recordHistory = true) => {
        const apply = (st: AppState): Patch => ({ doc: { ...st.doc, watermark: { ...st.doc.watermark, ...patch } } });
        if (recordHistory) mutate(apply);
        else set(apply);
      },

      uploadWatermarkImage: async () => {
        const files = await pickFile('image/png,image/jpeg');
        if (!files.length) return;
        await withBusy('Carregando marca d\'água…', async () => {
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
        await withBusy('Carregando PDFs…', async (progress) => {
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
            toast: `${count} arquivo(s) juntados — ${added.length} páginas adicionadas.`,
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
        await withBusy('Dividindo…', async () => {
          const baseName = baseNameFor(st.doc);
          let results: Awaited<ReturnType<typeof splitEveryPage>> = [];
          let message = '';

          if (st.splitMode === 'range') {
            if (st.splitRangeSubMode === 'auto') {
              results = await splitIntoParts(st.doc, baseName, st.splitAutoParts);
              message = `Dividido em ${results.length} arquivo(s).`;
            } else {
              if (!st.splitCustomRanges.length) {
                set({ toast: 'Adicione pelo menos um intervalo.' });
                return;
              }
              results = await splitByRanges(st.doc, baseName, st.splitCustomRanges);
              message = `Dividido em ${results.length} arquivo(s).`;
            }
          } else {
            if (st.splitPagesSubMode === 'all') {
              results = await splitEveryPage(st.doc, baseName);
              message = `${results.length} PDFs gerados, um por página.`;
            } else {
              if (!st.splitSelectedPages.length) {
                set({ toast: 'Selecione ao menos uma página.' });
                return;
              }
              results = await extractSelectedPages(st.doc, baseName, st.splitSelectedPages, st.splitMergeSelected);
              message = st.splitMergeSelected
                ? 'Páginas selecionadas mescladas em um PDF.'
                : `${results.length} PDFs gerados a partir das páginas selecionadas.`;
            }
          }

          if (results.length === 1) downloadBytes(results[0].bytes, results[0].name, 'application/pdf');
          else zipFiles(results.map((r) => ({ name: r.name, bytes: r.bytes })), `${baseName}_dividido.zip`);
          set({ toast: message, toolMode: null });
        });
      },

      setCompressLevel: (level: CompressLevel) => set({ compressLevel: level, compressOutcome: null }),

      runCompress: async () => {
        const st = stateRef.current;
        await withBusy('Comprimindo…', async (progress) => {
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

      downloadCompressed: () => {
        const outcome = stateRef.current.compressOutcome;
        if (!outcome) return;
        downloadBytes(outcome.bytes, `${baseNameFor(stateRef.current.doc)}_comprimido.pdf`, 'application/pdf');
      },

      /* --------------------------------------------------------------- export */

      toggleExport: () => set((st) => ({ exportOpen: !st.exportOpen })),
      closeExport: () => set({ exportOpen: false }),
      setExportFormat: (exportFormat: ExportFormat) => set({ exportFormat }),

      runExport: async (format: ExportFormat) => {
        const st = stateRef.current;
        const base = baseNameFor(st.doc);
        set({ exportOpen: false });
        await withBusy('Exportando…', async (progress) => {
          if (format === 'pdf') {
            await exportAsPdf(st.doc, base);
            set({ toast: `${base}.pdf exportado.` });
          } else if (format === 'png' || format === 'jpg') {
            await exportAsImages(st.doc, base, format, progress);
            const multi = st.doc.pages.length > 1;
            set({ toast: multi ? `${st.doc.pages.length} imagens exportadas em .zip.` : `${base}.${format} exportado.` });
          } else {
            const { paragraphs } = await exportAsDocx(st.doc, base, progress);
            set({
              toast: paragraphs
                ? `${base}.docx exportado com ${paragraphs} parágrafos de texto.`
                : `${base}.docx exportado, mas nenhum texto foi encontrado no PDF.`,
            });
          }
          // Reached only if the export above didn't throw — the document is now
          // safely out of the browser, so the "unsaved changes" warning can stand down.
          set({ dirty: false });
        });
      },

      dismissToast: () => set({ toast: null }),

      /* ----------------------------------------------------------------- zoom */

      setZoom: (zoom: number | null) => set({ zoom }),
      setEffectiveZoom: (effectiveZoom: number) => set({ effectiveZoom }),

      /* ------------------------------------------------------------- font pick */

      setFontPickerActive: (active: boolean) => set({ fontPickerActive: active }),

      /** Reads the font a clicked DOM element is actually rendered in and maps it
       * to the closest substitute family, so newly added text can match it. */
      captureFontFromElement: (el: Element) => {
        const family = getComputedStyle(el).fontFamily;
        const match = matchSubstitute(family);
        set({ capturedFontKey: match.family.key, fontPickerActive: false, toast: `Fonte capturada: ${match.family.label}` });
      },

      undo,
      redo,
    };
  }, [set, mutate, undo, redo, withBusy]);

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

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const id = stateRef.current.selectedOverlayId;
      if (!id) return;
      e.preventDefault();
      actions.removeOverlay(id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);

  return { state, actions };
}

export type FluvaActions = ReturnType<typeof useFluvaStore>['actions'];
