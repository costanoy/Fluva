import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { ImageAsset, Overlay, WorkPage } from '../pdf/model';
import { TEXT_LINE_HEIGHT } from '../pdf/build';
import { familyByKey } from '../pdf/fonts';

/** Height a text overlay occupies, in points. */
export function textOverlayHeight(overlay: Extract<Overlay, { kind: 'text' }>): number {
  const lines = Math.max(1, overlay.text.split('\n').length);
  return lines * overlay.size * TEXT_LINE_HEIGHT;
}

export function overlayBox(overlay: Overlay): { x: number; y: number; width: number; height: number } {
  if (overlay.kind === 'text') {
    // Width is only needed for hit-testing, so a generous estimate is fine; the
    // element itself sizes to its content.
    const longest = overlay.text.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
    return { x: overlay.x, y: overlay.y, width: longest * overlay.size * 0.55, height: textOverlayHeight(overlay) };
  }
  return { x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height };
}

/**
 * Converts a pointer movement on screen into a movement in page space.
 * The plane is rotated by the page rotation, so screen deltas must be un-rotated
 * before they mean anything in page coordinates.
 */
function screenDeltaToPage(dxScreen: number, dyScreen: number, rotationDeg: number, scale: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const planeDx = dxScreen * cos + dyScreen * sin;
  const planeDy = -dxScreen * sin + dyScreen * cos;
  // Page space has its origin bottom-left, so downward screen movement lowers y.
  return { dx: planeDx / scale, dy: -planeDy / scale };
}

interface OverlayLayerProps {
  page: WorkPage;
  assets: Record<string, ImageAsset>;
  scale: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Live update while dragging; history is only recorded on release. */
  onLiveChange: (id: string, patch: Partial<Overlay>) => void;
  onCommit: (id: string, patch: Partial<Overlay>) => void;
  interactive: boolean;
}

export function OverlayLayer({ page, assets, scale, selectedId, onSelect, onLiveChange, onCommit, interactive }: OverlayLayerProps) {
  return (
    <>
      {page.overlays.map((overlay) => (
        <OverlayItem
          key={overlay.id}
          overlay={overlay}
          page={page}
          assets={assets}
          scale={scale}
          selected={selectedId === overlay.id}
          onSelect={onSelect}
          onLiveChange={onLiveChange}
          onCommit={onCommit}
          interactive={interactive}
        />
      ))}
    </>
  );
}

interface OverlayItemProps extends Omit<OverlayLayerProps, 'selectedId'> {
  overlay: Overlay;
  selected: boolean;
}

function OverlayItem({ overlay, page, assets, scale, selected, onSelect, onLiveChange, onCommit, interactive }: OverlayItemProps) {
  const box = overlayBox(overlay);
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; w: number; h: number } | null>(null);
  const [latest, setLatest] = useState<Partial<Overlay> | null>(null);
  // Hooks must run on every render, so the asset URL is resolved before any
  // kind-specific branching below.
  const imageSrc = useAssetUrl(overlay.kind === 'image' ? assets[overlay.assetId] : undefined);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!interactive) return;
      e.stopPropagation();
      onSelect(overlay.id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragState.current = { startX: e.clientX, startY: e.clientY, originX: overlay.x, originY: overlay.y };
    },
    [interactive, onSelect, overlay.id, overlay.x, overlay.y],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (resizeState.current) {
        const { dx, dy } = screenDeltaToPage(
          e.clientX - resizeState.current.startX,
          e.clientY - resizeState.current.startY,
          page.rotation,
          scale,
        );
        const width = Math.max(8, resizeState.current.w + dx);
        const height = Math.max(8, resizeState.current.h - dy);
        const patch = { width, height } as Partial<Overlay>;
        setLatest(patch);
        onLiveChange(overlay.id, patch);
        return;
      }
      if (!dragState.current) return;
      const { dx, dy } = screenDeltaToPage(
        e.clientX - dragState.current.startX,
        e.clientY - dragState.current.startY,
        page.rotation,
        scale,
      );
      const patch = { x: dragState.current.originX + dx, y: dragState.current.originY + dy } as Partial<Overlay>;
      setLatest(patch);
      onLiveChange(overlay.id, patch);
    },
    [onLiveChange, overlay.id, page.rotation, scale],
  );

  const handlePointerUp = useCallback(() => {
    if ((dragState.current || resizeState.current) && latest) onCommit(overlay.id, latest);
    dragState.current = null;
    resizeState.current = null;
    setLatest(null);
  }, [latest, onCommit, overlay.id]);

  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      if (overlay.kind === 'text' || overlay.kind === 'cover') return;
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      resizeState.current = { startX: e.clientX, startY: e.clientY, w: overlay.width, h: overlay.height };
    },
    [overlay],
  );

  // Covers are static backdrops and carry no rotation of their own.
  const ownRotation = overlay.kind === 'cover' ? 0 : overlay.rotation;

  const base: CSSProperties = {
    position: 'absolute',
    left: box.x * scale,
    top: (page.height - box.y) * scale,
    transform: `rotate(${-ownRotation}deg)`,
    // Text hangs from its top-left; boxes pivot on their bottom-left corner, which
    // is the anchor pdf-lib rotates them about when the file is written.
    transformOrigin: overlay.kind === 'text' ? 'top left' : 'bottom left',
    cursor: interactive ? 'move' : 'default',
    outline: selected ? '2px solid var(--color-accent)' : '2px solid transparent',
    outlineOffset: 2,
    touchAction: 'none',
  };

  const pointerHandlers = interactive
    ? { onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: handlePointerUp }
    : {};

  if (overlay.kind === 'cover') {
    return (
      <div
        style={{
          position: 'absolute',
          left: overlay.x * scale,
          top: (page.height - overlay.y - overlay.height) * scale,
          width: overlay.width * scale,
          height: overlay.height * scale,
          background: overlay.color,
          pointerEvents: 'none',
        }}
      />
    );
  }

  if (overlay.kind === 'text') {
    const family = familyByKey(overlay.fontKey);
    return (
      <div
        {...pointerHandlers}
        style={{
          ...base,
          transform: `rotate(${-overlay.rotation}deg)`,
          fontFamily: family.cssFamily,
          fontSize: overlay.size * scale,
          lineHeight: TEXT_LINE_HEIGHT,
          fontWeight: overlay.bold ? 700 : 400,
          fontStyle: overlay.italic ? 'italic' : 'normal',
          color: overlay.color,
          whiteSpace: 'pre',
          userSelect: 'none',
        }}
      >
        {overlay.text}
      </div>
    );
  }

  if (overlay.kind === 'image') {
    return (
      <div
        {...pointerHandlers}
        style={{
          ...base,
          top: (page.height - overlay.y - overlay.height) * scale,
          width: overlay.width * scale,
          height: overlay.height * scale,
        }}
      >
        {imageSrc && <img src={imageSrc} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }} />}
        {selected && interactive && <ResizeHandle onPointerDown={startResize} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />}
      </div>
    );
  }

  return (
    <div
      {...pointerHandlers}
      style={{
        ...base,
        top: (page.height - overlay.y - overlay.height) * scale,
        width: overlay.width * scale,
        height: overlay.height * scale,
        background: overlay.color,
        borderRadius: overlay.shape === 'circle' ? '50%' : 0,
      }}
    >
      {selected && interactive && <ResizeHandle onPointerDown={startResize} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />}
    </div>
  );
}

function ResizeHandle(props: {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
}) {
  return (
    <div
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerUp}
      style={{
        position: 'absolute',
        right: -7,
        bottom: -7,
        width: 14,
        height: 14,
        borderRadius: 3,
        background: 'var(--color-accent)',
        border: '2px solid #FFFFFF',
        cursor: 'nwse-resize',
        touchAction: 'none',
      }}
    />
  );
}

/** Object URLs for image assets, created once per asset and revoked on unmount. */
const urlCache = new Map<string, string>();

function useAssetUrl(asset: ImageAsset | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (asset ? urlCache.get(asset.id) ?? null : null));

  useEffect(() => {
    if (!asset) {
      setUrl(null);
      return;
    }
    const cached = urlCache.get(asset.id);
    if (cached) {
      setUrl(cached);
      return;
    }
    const copy = new Uint8Array(asset.bytes.length);
    copy.set(asset.bytes);
    const objectUrl = URL.createObjectURL(new Blob([copy.buffer], { type: asset.mime }));
    urlCache.set(asset.id, objectUrl);
    setUrl(objectUrl);
  }, [asset]);

  return url;
}
