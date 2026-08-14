import type { ImageAsset, WatermarkConfig, WorkPage } from '../pdf/model';
import { buildWatermarkOverlay } from '../pdf/build';
import { familyByKey } from '../pdf/fonts';

/**
 * Draws the watermark using the very same overlay the exporter will bake in, so
 * what the user positions on screen is what lands in the file.
 */
export function WatermarkPreview({
  page,
  watermark,
  assets,
  scale,
  isTargetPage,
}: {
  page: WorkPage;
  watermark: WatermarkConfig;
  assets: Record<string, ImageAsset>;
  scale: number;
  isTargetPage: boolean;
}) {
  if (!watermark.enabled) return null;
  if (!watermark.allPages && !isTargetPage) return null;

  const overlay = buildWatermarkOverlay(watermark, page, assets);
  if (!overlay) return null;

  const common = {
    position: 'absolute' as const,
    pointerEvents: 'none' as const,
    opacity: 0.35,
    // Matches the page's own zoom transition (see PageView) — without this,
    // the watermark snapped straight to each new size/position a beat ahead
    // of the page smoothly resizing around it, which read as it glitching
    // during a zoom.
    transition: 'left .16s ease-out, top .16s ease-out, width .16s ease-out, height .16s ease-out, font-size .16s ease-out',
  };

  if (overlay.kind === 'text') {
    const family = familyByKey(overlay.fontKey);
    return (
      <div
        style={{
          ...common,
          left: overlay.x * scale,
          top: (page.height - overlay.y) * scale,
          transform: `translate(-50%, -50%) rotate(${-overlay.rotation}deg)`,
          fontFamily: family.cssFamily,
          fontSize: overlay.size * scale,
          fontWeight: 700,
          color: overlay.color,
          whiteSpace: 'nowrap',
        }}
      >
        {overlay.text}
      </div>
    );
  }

  if (overlay.kind !== 'image') return null;
  const asset = assets[overlay.assetId];
  if (!asset) return null;

  return (
    <img
      src={assetUrl(asset)}
      alt=""
      style={{
        ...common,
        left: overlay.x * scale,
        top: (page.height - overlay.y - overlay.height) * scale,
        width: overlay.width * scale,
        height: overlay.height * scale,
        transform: `rotate(${-overlay.rotation}deg)`,
        transformOrigin: 'center center',
      }}
    />
  );
}

const urlCache = new Map<string, string>();

function assetUrl(asset: ImageAsset): string {
  const cached = urlCache.get(asset.id);
  if (cached) return cached;
  const copy = new Uint8Array(asset.bytes.length);
  copy.set(asset.bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: asset.mime }));
  urlCache.set(asset.id, url);
  return url;
}
