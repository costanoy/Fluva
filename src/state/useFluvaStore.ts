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
import { buildPdf } from '../pdf/build';
import { canvasToBlob, rasterizePdf, releaseAll } from '../pdf/render';
import { compressDocument, splitByRange, splitEveryPage, type CompressLevel } from '../pdf/ops';
import { baseNameFor, downloadBytes, exportAsDocx, exportAsImages, exportAsPdf, zipFiles, type ExportFormat } from '../pdf/exporters';
import { clampRect } from '../pdf/geometry';
import { DEFAULT_FAMILY_KEY } from '../pdf/fonts';
import { applySnapshot, snapshot, type AppState, type QueuedFile, type TextItem } from './appTypes';

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
  cropDraft: null,
  exportOpen: false,
  exportFormat: 'pdf',
  mergeSelected: [],
  splitStart: 1,
  splitEnd: 1,
  compressLevel: 'medium',
  compressOutcome: null,
  reorderFrom: '',
  reorderTo: '',
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
      return { ...st, ...patch, history: st.history.concat([snapshot(st)]).slice(-50), future: [] };
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
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
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
      openQueue: async () => {
        const queue = stateRef.current.queue;
        if (!queue.length) return;
        await withBusy('Abrindo arquivos…', async (progress) => {
          const sources: Record<string, SourceDoc> = {};
          const assets: Record<string, ImageAsset> = {};
          let pages: WorkPage[] = [];
          const spare: string[] = [];
          let name = '';
          let kind: 'pdf' | 'image' = 'pdf';

          for (let i = 0; i < queue.length; i++) {
            const loaded = await loadFile(queue[i].file);
            sources[loaded.source.id] = loaded.source;
            if (loaded.asset) assets[loaded.asset.id] = loaded.asset;
            if (i === 0) {
              pages = loaded.pages;
              name = loaded.source.name;
              kind = loaded.source.kind;
            } else {
              spare.push(loaded.source.id);
            }
            progress(i + 1, queue.length);
          }

          set({
            screen: 'editing',
            doc: { sources, assets, pages, watermark: defaultWatermark(), name, kind },
            spareSourceIds: spare,
            queue: [],
            activePageIndex: 0,
            toolMode: null,
            selectedOverlayId: null,
            editingTextId: null,
            splitStart: 1,
            splitEnd: pages.length,
            exportFormat: kind === 'pdf' ? 'pdf' : 'png',
            history: [],
            future: [],
            compressOutcome: null,
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

      /* ---------------------------------------------------------- page basics */

      setActivePage: (index: number) => set({ activePageIndex: index, selectedOverlayId: null, editingTextId: null }),

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
            fontKey: DEFAULT_FAMILY_KEY,
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
          };
        }),

      selectOverlay: (id: string | null) => set({ selectedOverlayId: id, editingTextId: null, toolMode: null }),

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

      /** Replaces an original text run: covers it, then draws editable text on top. */
      replaceTextRun: (bounds: Rect, text: string, fontKey: string, size: number, bold: boolean, italic: boolean) =>
        mutate((st) => {
          const page = currentPage(st);
          if (!page) return null;
          const cover: Overlay = {
            id: newId('ov'),
            kind: 'cover',
            x: bounds.x - 1,
            y: bounds.y - 1,
            width: bounds.width + 2,
            height: bounds.height + 2,
            color: '#FFFFFF',
          };
          const replacement: Overlay = {
            id: newId('ov'),
            kind: 'text',
            x: bounds.x,
            y: bounds.y + size * 0.2,
            text,
            fontKey,
            size,
            bold,
            italic,
            color: '#2C2C2A',
            rotation: 0,
          };
          const next = { ...page, overlays: [...page.overlays, cover, replacement] };
          return {
            doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, next) },
            selectedOverlayId: replacement.id,
            editingTextId: null,
          };
        }),

      setEditingText: (id: string | null) => set({ editingTextId: id, selectedOverlayId: null }),

      setTextRunTarget: (item: TextItem | null) => set({ textRunTarget: item }),

      /* ----------------------------------------------------------------- crop */

      setCropDraft: (rect: Rect | null) => set({ cropDraft: rect }),

      applyCrop: () =>
        mutate((st) => {
          const page = currentPage(st);
          const draft = st.cropDraft;
          if (!page || !draft) return null;
          const crop = clampRect(draft, page.width, page.height);
          return {
            doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, { ...page, crop }) },
            cropDraft: null,
          };
        }),

      clearCrop: () =>
        mutate((st) => {
          const page = currentPage(st);
          if (!page || !page.crop) return null;
          return { doc: { ...st.doc, pages: replacePage(st, st.activePageIndex, { ...page, crop: null }) }, cropDraft: null };
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

      clearWatermarkImage: () =>
        mutate((st) => ({
          doc: { ...st.doc, watermark: { ...st.doc.watermark, source: { kind: 'text', text: 'AMOSTRA' } } },
        })),

      /* ---------------------------------------------------------------- tools */

      setTool: (toolMode: AppState['toolMode']) =>
        set((st) => ({
          toolMode: st.toolMode === toolMode ? null : toolMode,
          selectedOverlayId: null,
          editingTextId: null,
          cropDraft: null,
          compressOutcome: toolMode === 'compress' ? st.compressOutcome : null,
          splitStart: 1,
          splitEnd: st.doc.pages.length,
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

      setSplitRange: (start: number, end: number) => set({ splitStart: start, splitEnd: end }),

      runSplitRange: async () => {
        const st = stateRef.current;
        await withBusy('Dividindo…', async () => {
          const results = await splitByRange(st.doc, baseNameFor(st.doc), st.splitStart, st.splitEnd);
          if (results.length === 1) downloadBytes(results[0].bytes, results[0].name, 'application/pdf');
          else zipFiles(results.map((r) => ({ name: r.name, bytes: r.bytes })), `${baseNameFor(st.doc)}_dividido.zip`);
          set({ toast: `Dividido em ${results.length} arquivo(s).`, toolMode: null });
        });
      },

      runSplitEveryPage: async () => {
        const st = stateRef.current;
        await withBusy('Dividindo páginas…', async () => {
          const results = await splitEveryPage(st.doc, baseNameFor(st.doc));
          zipFiles(results.map((r) => ({ name: r.name, bytes: r.bytes })), `${baseNameFor(st.doc)}_paginas.zip`);
          set({ toast: `${results.length} PDFs gerados, um por página.`, toolMode: null });
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

      setReorderFrom: (v: string) => set({ reorderFrom: v }),
      setReorderTo: (v: string) => set({ reorderTo: v }),

      confirmReorder: () =>
        mutate((st) => {
          const from = parseInt(st.reorderFrom, 10);
          const to = parseInt(st.reorderTo, 10);
          if (Number.isNaN(from) || Number.isNaN(to)) return null;
          const fromIdx = Math.max(1, Math.min(st.doc.pages.length, from)) - 1;
          const toIdx = Math.max(1, Math.min(st.doc.pages.length, to)) - 1;
          if (fromIdx === toIdx) return null;
          const pages = st.doc.pages.slice();
          const [moved] = pages.splice(fromIdx, 1);
          pages.splice(toIdx, 0, moved);
          return { doc: { ...st.doc, pages }, activePageIndex: toIdx, reorderTo: '' };
        }),

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
        });
      },

      dismissToast: () => set({ toast: null }),
      undo,
      redo,
    };
  }, [set, mutate, undo, redo, withBusy]);

  return { state, actions };
}

export type FluvaActions = ReturnType<typeof useFluvaStore>['actions'];
