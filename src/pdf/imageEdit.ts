import { displaySize, imageEditsOf, NO_ADJUST, type ImageAdjust, type ImageEdits, type ImageFilterId, type Rect, type RedactOverlay, type WorkPage } from './model';
import { MAX_CANVAS_PIXELS } from './geometry';

/**
 * The photo editor's pixels: everything done to a photo page itself — turned
 * straight, flipped, its light and colour, a filter, the areas blurred or
 * pixelated — as one pipeline, shared by the editor's live view (drawn small
 * and fast) and the export (at the photo's own resolution), so what's on
 * screen is what the file gets.
 *
 * Sizes here are in page points — one per pixel of the original photo — and
 * converted at the resolution being drawn, so a blur, a vignette or a
 * pixelated block looks the same on screen as in the exported file.
 */

/** The part of the page a canvas holds, at `ppp` canvas pixels per point. */
export interface Frame extends Rect {
  ppp: number;
}

export const ADJUST_KEYS = Object.keys(NO_ADJUST) as Array<keyof ImageAdjust>;

export const FILTER_IDS: ImageFilterId[] = ['none', 'bw', 'noir', 'sepia', 'vintage', 'vivid', 'warm', 'cool', 'dramatic', 'fade'];

/** Whether light, colour, a filter or the negative change the photo. */
export function tonalActive(e: ImageEdits): boolean {
  return (e.filter !== 'none' && e.filterStrength > 0) || !!e.invert || ADJUST_KEYS.some((k) => e.adjust[k] !== 0);
}

/** Whether the photo is flipped or turned straight. */
export function geometryActive(e: ImageEdits): boolean {
  return e.flipH || e.flipV || Math.abs(e.straighten) > 0.001;
}

export function redactionsOf(page: WorkPage): RedactOverlay[] {
  return page.overlays.filter((o): o is RedactOverlay => o.kind === 'redact');
}

/** Whether the photo can't simply be drawn as it is. */
export function changesPixels(page: WorkPage): boolean {
  const e = imageEditsOf(page);
  return tonalActive(e) || geometryActive(e) || redactionsOf(page).length > 0;
}

/** Changes whenever the photo itself (without its redactions) would. */
export function baseKey(page: WorkPage): string {
  const e = imageEditsOf(page);
  const parts: Array<string | number> = [+e.flipH, +e.flipV, e.straighten, e.filter, e.filterStrength, +!!e.invert, ...ADJUST_KEYS.map((k) => e.adjust[k])];
  // The vignette frames what's shown, so it follows the crop.
  if (e.adjust.vignette && page.crop) parts.push(page.crop.x, page.crop.y, page.crop.width, page.crop.height);
  return parts.join('|');
}

/** Changes whenever the blurred or pixelated areas would. */
export function redactionKey(page: WorkPage): string {
  return redactionsOf(page)
    .map((r) => [r.x, r.y, r.width, r.height, r.effect, r.shape, r.strength].join(','))
    .join(';');
}

/** How much a photo turned by `theta` has to grow to still cover its own box. */
function fillScale(w: number, h: number, theta: number): number {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return Math.max(c + (h / w) * s, (w / h) * s + c);
}

/** The part of the page that's shown: its crop, kept on the page. */
export function shownRect(page: WorkPage): Rect {
  const c = page.crop;
  if (!c) return { x: 0, y: 0, width: page.width, height: page.height };
  const x0 = Math.max(0, c.x);
  const y0 = Math.max(0, c.y);
  const x1 = Math.min(page.width, c.x + c.width);
  const y1 = Math.min(page.height, c.y + c.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: page.width, height: page.height };
}

/**
 * Draws the photo of `page` into `ctx` — flipped, turned straight and, with
 * `tonal`, toned and filtered — `frame` mapping page space onto the canvas.
 * Leaves out the blurred or pixelated areas (see `applyRedactions`).
 */
export function paintPhoto(ctx: CanvasRenderingContext2D, image: CanvasImageSource, page: WorkPage, frame: Frame, tonal = true): void {
  const e = imageEditsOf(page);
  const { width: W, height: H } = page;
  // The canvas's own (whole-pixel) size, not `frame.ppp`: the photo has to
  // reach its very edge, or the last row comes out half see-through.
  const sx = ctx.canvas.width / frame.width;
  const sy = ctx.canvas.height / frame.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Page space with a top-left origin, the way the canvas counts.
  ctx.setTransform(sx, 0, 0, sy, -frame.x * sx, -(H - frame.y - frame.height) * sy);
  ctx.translate(W / 2, H / 2);
  const theta = (e.straighten * Math.PI) / 180;
  const k = theta ? zoomToFill(W, H, theta) : 1;
  if (theta) {
    ctx.rotate(theta);
    ctx.scale(k, k);
  }
  ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.drawImage(downsized(image, W, H, Math.max(sx, sy) * k), -W / 2, -H / 2, W, H);
  ctx.restore();
  if (tonal && tonalActive(e)) tone(ctx, page, e, frame);
}

/** How much a photo turned by `theta` is zoomed: just enough to cover its
 * box, and a hair more, so no sliver of blank edge survives rounding. */
function zoomToFill(w: number, h: number, theta: number): number {
  return fillScale(w, h, theta) * (1 + 2 / Math.min(w, h));
}

/** Whether this browser's canvas has `imageSmoothingQuality` — asked of the
 * prototype: a context it's been set on answers yes either way. */
const SMOOTHS_WELL = typeof CanvasRenderingContext2D !== 'undefined' && 'imageSmoothingQuality' in CanvasRenderingContext2D.prototype;

/**
 * `image` (`w` × `h`) halved until it's within twice the size it's drawn at
 * (`scale` of it) — for a browser that ignores `imageSmoothingQuality`
 * (Firefox), whose single bilinear pass would shrink a detailed photo with
 * jagged edges and moiré. Elsewhere the image as it is.
 */
function downsized(image: CanvasImageSource, w: number, h: number, scale: number): CanvasImageSource {
  if (SMOOTHS_WELL || scale >= 0.5) return image;
  let source = image;
  let cw = w;
  let ch = h;
  while (scale * (w / cw) < 0.5 && cw > 2 && ch > 2) {
    const next = document.createElement('canvas');
    next.width = Math.max(1, Math.round(cw / 2));
    next.height = Math.max(1, Math.round(ch / 2));
    next.getContext('2d')!.drawImage(source, 0, 0, next.width, next.height);
    source = next;
    cw = next.width;
    ch = next.height;
  }
  return source;
}

/**
 * Where a blurred or pixelated area has to go for it to keep covering the
 * same part of the photo, once the photo is flipped or turned straight
 * differently (`before` to `after`): its corners taken through the photo's
 * old transform back to the photo, and through the new one onto the page —
 * the box around them. Not cut to the page: a part a straightened photo's
 * zoom pushes off it comes back, still covered, when it's turned back.
 */
export function followPhoto(area: Rect, page: { width: number; height: number }, before: ImageEdits, after: ImageEdits): Rect {
  const { width: W, height: H } = page;
  // The photo's transform in page space with a top-left origin, as paintPhoto draws it.
  const transform = (e: ImageEdits) => {
    const theta = (e.straighten * Math.PI) / 180;
    return { cos: Math.cos(theta), sin: Math.sin(theta), k: theta ? zoomToFill(W, H, theta) : 1, fx: e.flipH ? -1 : 1, fy: e.flipV ? -1 : 1 };
  };
  const from = transform(before);
  const to = transform(after);
  const move = (x: number, y: number) => {
    // Back to the photo...
    let dx = x - W / 2;
    let dy = y - H / 2;
    let px = (from.cos * dx + from.sin * dy) / from.k;
    let py = (-from.sin * dx + from.cos * dy) / from.k;
    px *= from.fx;
    py *= from.fy;
    // ...and onto the page again.
    px *= to.fx;
    py *= to.fy;
    dx = to.k * (to.cos * px - to.sin * py);
    dy = to.k * (to.sin * px + to.cos * py);
    return { x: W / 2 + dx, y: H / 2 + dy };
  };
  const top = H - area.y - area.height;
  const corners = [move(area.x, top), move(area.x + area.width, top), move(area.x, top + area.height), move(area.x + area.width, top + area.height)];
  const x0 = Math.min(...corners.map((c) => c.x));
  const x1 = Math.max(...corners.map((c) => c.x));
  const y0 = Math.min(...corners.map((c) => c.y));
  const y1 = Math.max(...corners.map((c) => c.y));
  return { x: x0, y: H - y1, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/* ------------------------------------------------------------ light, colour */

const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const toSrgb = (x: number) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);

/** An S-curve around the middle grey: `a` > 0 adds contrast (and rolls off
 * what would clip), < 0 flattens. */
function contrastCurve(x: number, a: number): number {
  if (a > 0) return 0.5 + (0.5 * Math.tanh(a * (2 * x - 1))) / Math.tanh(a);
  if (a < 0) return 0.5 + (x - 0.5) * (1 + 0.7 * Math.max(-1, a));
  return x;
}

/** Each channel's own curve, input byte to output (0..1, may overshoot):
 * exposure and white balance in linear light, then brightness and contrast. */
function channelCurves(a: ImageAdjust): [Float32Array, Float32Array, Float32Array] {
  const stops = 2 ** ((a.exposure / 100) * 2);
  const warm = a.warmth / 100;
  const tint = a.tint / 100;
  let gr = 1 + 0.22 * warm;
  let gg = 1 - 0.2 * tint;
  let gb = 1 - 0.3 * warm;
  // White balance shifts colour, not brightness.
  const lum = LR * gr + LG * gg + LB * gb;
  gr /= lum;
  gg /= lum;
  gb /= lum;
  const gamma = 2 ** (-0.85 * (a.brightness / 100));
  const contrast = a.contrast > 0 ? 2.2 * (a.contrast / 100) : a.contrast / 100;
  return [gr, gg, gb].map((gain) => {
    const lut = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
      let x = toSrgb(toLinear(v / 255) * stops * gain);
      if (gamma !== 1 && x > 0) x **= gamma;
      lut[v] = contrastCurve(x, contrast);
    }
    return lut;
  }) as [Float32Array, Float32Array, Float32Array];
}

interface FilterDef {
  /** r' = m0 r + m1 g + m2 b + m3, and so on for g' and b'. */
  matrix?: number[];
  saturation?: number;
  contrast?: number;
  gamma?: number;
  /** Where black and white land (a faded print). */
  lift?: number;
  ceiling?: number;
}

const GREY = [LR, LG, LB, 0, LR, LG, LB, 0, LR, LG, LB, 0];

const FILTERS: Record<Exclude<ImageFilterId, 'none'>, FilterDef> = {
  bw: { matrix: GREY, contrast: 0.35 },
  noir: { matrix: GREY, contrast: 1.6, gamma: 1.2 },
  sepia: { matrix: [0.393, 0.769, 0.189, 0, 0.349, 0.686, 0.168, 0, 0.272, 0.534, 0.131, 0], contrast: 0.15 },
  vintage: { matrix: [0.95, 0.08, 0, 0.03, 0.03, 0.9, 0.05, 0.025, 0, 0.12, 0.72, 0.06], saturation: 0.85, contrast: 0.12, lift: 0.06 },
  vivid: { saturation: 1.45, contrast: 0.45 },
  warm: { matrix: [1.08, 0, 0, 0.01, 0, 1.01, 0, 0, 0, 0, 0.86, 0], saturation: 1.05 },
  cool: { matrix: [0.9, 0, 0, 0, 0, 1, 0, 0.005, 0, 0, 1.12, 0.01], saturation: 0.97 },
  dramatic: { saturation: 0.72, contrast: 1.25, gamma: 1.12 },
  fade: { saturation: 0.7, lift: 0.13, ceiling: 0.94 },
};

const CURVE_STEPS = 1024;

/** A filter's per-channel curve (contrast, gamma, faded ends), tabulated over 0..1. */
function filterCurve(f: FilterDef): Float32Array | null {
  if (!f.contrast && !f.gamma && !f.lift && !f.ceiling) return null;
  const lut = new Float32Array(CURVE_STEPS);
  const lift = f.lift ?? 0;
  const ceiling = f.ceiling ?? 1;
  for (let i = 0; i < CURVE_STEPS; i++) {
    let x = contrastCurve(i / (CURVE_STEPS - 1), f.contrast ?? 0);
    if (f.gamma) x = Math.max(0, x) ** f.gamma;
    lut[i] = lift + (ceiling - lift) * x;
  }
  return lut;
}

/** Light, colour, filter, vignette, the negative, then blur and sharpening, in place. */
function tone(ctx: CanvasRenderingContext2D, page: WorkPage, e: ImageEdits, frame: Frame) {
  const { width: w, height: h } = ctx.canvas;
  if (!w || !h) return;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const a = e.adjust;
  const [cr, cg, cb] = channelCurves(a);
  const shadows = a.shadows / 100;
  const highlights = a.highlights / 100;
  const sat = a.saturation / 100;
  const vib = a.vibrance / 100;
  const def = e.filter === 'none' ? null : FILTERS[e.filter];
  const strength = def ? e.filterStrength / 100 : 0;
  const m = def?.matrix ?? null;
  const fsat = def?.saturation ?? 1;
  const curve = def ? filterCurve(def) : null;
  const toneOn = shadows !== 0 || highlights !== 0;
  const satOn = sat !== 0 || vib !== 0;
  const filterOn = strength > 0;
  const invert = !!e.invert;

  // The vignette darkens toward the edges of what's shown, not of the whole page.
  const vig = a.vignette / 100;
  let colFall: Float32Array | null = null;
  let rowFall: Float32Array | null = null;
  if (vig > 0) {
    const shown = shownRect(page);
    const cx = (shown.x + shown.width / 2 - frame.x) * frame.ppp;
    const cy = (frame.y + frame.height - (shown.y + shown.height / 2)) * frame.ppp;
    const hw = (shown.width / 2) * frame.ppp;
    const hh = (shown.height / 2) * frame.ppp;
    colFall = new Float32Array(w);
    rowFall = new Float32Array(h);
    for (let x = 0; x < w; x++) colFall[x] = ((x + 0.5 - cx) / hw) ** 2 / 2;
    for (let y = 0; y < h; y++) rowFall[y] = ((y + 0.5 - cy) / hh) ** 2 / 2;
  }

  let i = 0;
  for (let y = 0; y < h; y++) {
    const ry = rowFall ? rowFall[y] : 0;
    for (let x = 0; x < w; x++, i += 4) {
      let r = cr[d[i]];
      let g = cg[d[i + 1]];
      let b = cb[d[i + 2]];

      if (toneOn) {
        const L = LR * r + LG * g + LB * b;
        const l = L < 0 ? 0 : L > 1 ? 1 : L;
        let delta = 0;
        // Shadows lift or deepen the darker tones but leave black black;
        // highlights reach all the way up to white.
        if (shadows !== 0) delta += shadows * 0.3 * 6.75 * l * (1 - l) * (1 - l);
        if (highlights !== 0 && l > 0.4) {
          const t = (l - 0.4) / 0.6;
          delta += highlights * 0.3 * t * t * (3 - 2 * t);
        }
        if (L > 0.004) {
          let f = (L + delta) / L;
          f = f < 0 ? 0 : f > 4 ? 4 : f;
          r *= f;
          g *= f;
          b *= f;
        } else {
          r += delta;
          g += delta;
          b += delta;
        }
      }

      if (satOn) {
        const L = LR * r + LG * g + LB * b;
        let f = 1 + sat;
        if (vib !== 0) {
          // Vibrance mostly moves the muted colours, sparing the vivid ones.
          const spread = Math.max(r, g, b) - Math.min(r, g, b);
          const t = spread >= 1 ? 0 : 1 - spread;
          f *= 1 + vib * t * t;
        }
        r = L + (r - L) * f;
        g = L + (g - L) * f;
        b = L + (b - L) * f;
      }

      if (filterOn) {
        let fr = r;
        let fg = g;
        let fb = b;
        if (m) {
          fr = m[0] * r + m[1] * g + m[2] * b + m[3];
          fg = m[4] * r + m[5] * g + m[6] * b + m[7];
          fb = m[8] * r + m[9] * g + m[10] * b + m[11];
        }
        if (fsat !== 1) {
          const L = LR * fr + LG * fg + LB * fb;
          fr = L + (fr - L) * fsat;
          fg = L + (fg - L) * fsat;
          fb = L + (fb - L) * fsat;
        }
        if (curve) {
          fr = curve[fr <= 0 ? 0 : fr >= 1 ? CURVE_STEPS - 1 : (fr * (CURVE_STEPS - 1) + 0.5) | 0];
          fg = curve[fg <= 0 ? 0 : fg >= 1 ? CURVE_STEPS - 1 : (fg * (CURVE_STEPS - 1) + 0.5) | 0];
          fb = curve[fb <= 0 ? 0 : fb >= 1 ? CURVE_STEPS - 1 : (fb * (CURVE_STEPS - 1) + 0.5) | 0];
        }
        r += (fr - r) * strength;
        g += (fg - g) * strength;
        b += (fb - b) * strength;
      }

      if (colFall) {
        const dist = Math.sqrt(colFall[x] + ry);
        if (dist > 0.35) {
          const t = dist >= 1.05 ? 1 : (dist - 0.35) / 0.7;
          const k = 1 - vig * 0.85 * t * t * (3 - 2 * t);
          r *= k;
          g *= k;
          b *= k;
        }
      }

      // The negative of all of it, as finished.
      if (invert) {
        r = 1 - (r < 0 ? 0 : r > 1 ? 1 : r);
        g = 1 - (g < 0 ? 0 : g > 1 ? 1 : g);
        b = 1 - (b < 0 ? 0 : b > 1 ? 1 : b);
      }

      // A clamped array rounds and clamps on its own.
      d[i] = r * 255;
      d[i + 1] = g * 255;
      d[i + 2] = b * 255;
    }
  }

  const minSide = Math.min(page.width, page.height);
  if (a.blur > 0) {
    const radius = Math.round((a.blur / 100) * 0.015 * minSide * frame.ppp);
    if (radius >= 1) gaussianish(d, w, h, radius);
  }
  if (a.sharpness > 0) sharpen(d, w, h, Math.max(1, Math.round(0.0005 * minSide * frame.ppp)), (a.sharpness / 100) * 1.2);
  ctx.putImageData(image, 0, 0);
}

/* ------------------------------------------------------------------ blur */

let canvasBlur: boolean | null = null;

/** Whether this browser's canvas can blur (its `filter`) — done on the
 * graphics card, many times faster than here. Safari can't: there the blur
 * is done here, in three box passes. */
function canvasBlurs(): boolean {
  if (canvasBlur !== null) return canvasBlur;
  try {
    const dot = document.createElement('canvas');
    dot.width = 9;
    dot.height = 1;
    dot.getContext('2d')!.fillRect(4, 0, 1, 1);
    const probe = document.createElement('canvas');
    probe.width = 9;
    probe.height = 1;
    const ctx = probe.getContext('2d', { willReadFrequently: true })!;
    ctx.filter = 'blur(2px)';
    ctx.drawImage(dot, 0, 0);
    const d = ctx.getImageData(0, 0, 9, 1).data;
    canvasBlur = d[2 * 4 + 3] > 0 && d[4 * 4 + 3] < 255;
  } catch {
    canvasBlur = false;
  }
  return canvasBlur;
}

/**
 * `d` blurred by a Gaussian of `sigma` pixels, on the graphics card. The
 * canvas blurs colour weighed by opacity and reads back colour divided by
 * the blurred opacity, so the photo's edge — where the blur reaches past
 * into nothing — keeps its colours instead of fading; the opacity it had is
 * then put back on an opaque photo.
 */
function blurredOnCanvas(d: Uint8ClampedArray, w: number, h: number, sigma: number): Uint8ClampedArray {
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  source.getContext('2d')!.putImageData(new ImageData(d as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const target = document.createElement('canvas');
  target.width = w;
  target.height = h;
  const ctx = target.getContext('2d', { willReadFrequently: true })!;
  ctx.filter = `blur(${sigma}px)`;
  ctx.drawImage(source, 0, 0);
  source.width = source.height = 0;
  const out = ctx.getImageData(0, 0, w, h).data;
  target.width = target.height = 0;
  if (!hasTranslucency(d)) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

/** One box-blur pass along rows (`horizontal`) or columns, `src` into `dst`
 * — where the canvas can't blur. */
function boxPass(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, horizontal: boolean) {
  const lines = horizontal ? h : w;
  const length = horizontal ? w : h;
  const step = horizontal ? 4 : w * 4;
  const k = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * w * 4 : line * 4;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let i = -r; i <= r; i++) {
      const p = start + (i < 0 ? 0 : i >= length ? length - 1 : i) * step;
      s0 += src[p];
      s1 += src[p + 1];
      s2 += src[p + 2];
      s3 += src[p + 3];
    }
    for (let n = 0; n < length; n++) {
      const p = start + n * step;
      dst[p] = s0 * k;
      dst[p + 1] = s1 * k;
      dst[p + 2] = s2 * k;
      dst[p + 3] = s3 * k;
      const out = start + (n - r < 0 ? 0 : n - r) * step;
      const inn = start + (n + r + 1 >= length ? length - 1 : n + r + 1) * step;
      s0 += src[inn] - src[out];
      s1 += src[inn + 1] - src[out + 1];
      s2 += src[inn + 2] - src[out + 2];
      s3 += src[inn + 3] - src[out + 3];
    }
  }
}

/** A Gaussian blur of about `r` pixels, in place: on the canvas when it can,
 * else three box blurs (the same spread). Colour is weighed by opacity, or a
 * transparent area's hidden colour would bleed into its edges. */
function gaussianish(d: Uint8ClampedArray, w: number, h: number, r: number) {
  if (canvasBlurs()) {
    d.set(blurredOnCanvas(d, w, h, Math.sqrt(r * (r + 1))));
    return;
  }
  const translucent = hasTranslucency(d);
  if (translucent) premultiply(d);
  const tmp = new Uint8ClampedArray(d.length);
  for (let pass = 0; pass < 3; pass++) {
    boxPass(d, tmp, w, h, r, true);
    boxPass(tmp, d, w, h, r, false);
  }
  if (translucent) unpremultiply(d);
}

/** Unsharp masking: each pixel pushed away from its neighbourhood's average. */
function sharpen(d: Uint8ClampedArray, w: number, h: number, r: number, amount: number) {
  let soft: Uint8ClampedArray;
  if (canvasBlurs()) soft = blurredOnCanvas(d, w, h, Math.sqrt((r * (r + 1)) / 3));
  else {
    const tmp = new Uint8ClampedArray(d.length);
    soft = new Uint8ClampedArray(d.length);
    boxPass(d, tmp, w, h, r, true);
    boxPass(tmp, soft, w, h, r, false);
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] + (d[i] - soft[i]) * amount;
    d[i + 1] = d[i + 1] + (d[i + 1] - soft[i + 1]) * amount;
    d[i + 2] = d[i + 2] + (d[i + 2] - soft[i + 2]) * amount;
  }
}

function hasTranslucency(d: Uint8ClampedArray): boolean {
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
  return false;
}

function premultiply(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const k = d[i + 3] / 255;
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  }
}

function unpremultiply(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3];
    if (!alpha) continue;
    const k = 255 / alpha;
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  }
}

/* ------------------------------------------------------------ redactions */

/**
 * Blurs or pixelates each redaction's area of what `ctx` holds — the photo
 * already painted by `paintPhoto`, `frame` mapping page space onto it. Done
 * in the pixels themselves: nothing of what was there is left to recover.
 */
export function applyRedactions(ctx: CanvasRenderingContext2D, page: WorkPage, frame: Frame): void {
  const { width: cw, height: ch } = ctx.canvas;
  // Mapped the way paintPhoto maps the photo.
  const sx = cw / frame.width;
  const sy = ch / frame.height;
  for (const r of redactionsOf(page)) {
    const { ppp } = frame;
    const left = (r.x - frame.x) * sx;
    const top = (frame.y + frame.height - (r.y + r.height)) * sy;
    const x0 = Math.max(0, Math.floor(left));
    const y0 = Math.max(0, Math.floor(top));
    const x1 = Math.min(cw, Math.ceil(left + r.width * sx));
    const y1 = Math.min(ch, Math.ceil(top + r.height * sy));
    if (x1 <= x0 || y1 <= y0) continue;
    const scale = Math.sqrt(Math.max(1, r.width * r.height));
    const s = Math.min(100, Math.max(1, r.strength)) / 100;
    // Inside the area: everything, or only its ellipse.
    const rx = (r.width * sx) / 2;
    const ry = (r.height * sy) / 2;
    const cx = left + rx;
    const cy = top + ry;
    const inside =
      r.shape === 'ellipse' ? (px: number, py: number) => ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / ry) ** 2 <= 1 : () => true;

    if (r.effect === 'pixelate') {
      const block = Math.max(2, Math.round(scale * (0.03 + 0.22 * s) * ppp));
      const w = x1 - x0;
      const h = y1 - y0;
      const region = ctx.getImageData(x0, y0, w, h);
      const d = region.data;
      for (let by = 0; by < h; by += block) {
        for (let bx = 0; bx < w; bx += block) {
          const ex = Math.min(w, bx + block);
          const ey = Math.min(h, by + block);
          let s0 = 0;
          let s1 = 0;
          let s2 = 0;
          let s3 = 0;
          let n = 0;
          for (let y = by; y < ey; y++) {
            for (let x = bx; x < ex; x++) {
              const p = (y * w + x) * 4;
              s0 += d[p];
              s1 += d[p + 1];
              s2 += d[p + 2];
              s3 += d[p + 3];
              n++;
            }
          }
          for (let y = by; y < ey; y++) {
            for (let x = bx; x < ex; x++) {
              if (!inside(x0 + x, y0 + y)) continue;
              const p = (y * w + x) * 4;
              d[p] = s0 / n;
              d[p + 1] = s1 / n;
              d[p + 2] = s2 / n;
              d[p + 3] = s3 / n;
            }
          }
        }
      }
      ctx.putImageData(region, x0, y0);
      continue;
    }

    // A blur reads a margin around the area, so its edge fades into the
    // photo instead of into a hard frame — but writes only inside it.
    const radius = Math.max(1, Math.round(scale * (0.02 + 0.18 * s) * ppp));
    const pad = radius * 3;
    const ax = Math.max(0, x0 - pad);
    const ay = Math.max(0, y0 - pad);
    const aw = Math.min(cw, x1 + pad) - ax;
    const ah = Math.min(ch, y1 + pad) - ay;
    const area = ctx.getImageData(ax, ay, aw, ah);
    const original = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    gaussianish(area.data, aw, ah, radius);
    const out = original.data;
    const src = area.data;
    const w = x1 - x0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!inside(x, y)) continue;
        const p = ((y - y0) * w + (x - x0)) * 4;
        const q = ((y - ay) * aw + (x - ax)) * 4;
        out[p] = src[q];
        out[p + 1] = src[q + 1];
        out[p + 2] = src[q + 2];
        out[p + 3] = src[q + 3];
      }
    }
    ctx.putImageData(original, x0, y0);
  }
}

/* ---------------------------------------------------------- filter tiles */

/** `photo` (already flipped and turned) with each filter applied over the
 * page's own light and colour — the tiles the filter picker shows. */
export function filterTiles(photo: HTMLCanvasElement, page: WorkPage): Record<ImageFilterId, string> {
  const e = imageEditsOf(page);
  const tile = document.createElement('canvas');
  tile.width = photo.width;
  tile.height = photo.height;
  const ctx = tile.getContext('2d', { willReadFrequently: true })!;
  const frame: Frame = { x: 0, y: 0, width: page.width, height: page.height, ppp: photo.width / page.width };
  const out = {} as Record<ImageFilterId, string>;
  for (const filter of FILTER_IDS) {
    // On white, like the page: a see-through logo isn't shown on black.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, tile.width, tile.height);
    ctx.drawImage(photo, 0, 0);
    // Blur and sharpening are left out: at this size they only cost time.
    const edits: ImageEdits = { ...e, filter, filterStrength: filter === e.filter ? e.filterStrength : 100, adjust: { ...e.adjust, blur: 0, sharpness: 0 } };
    if (tonalActive(edits)) tone(ctx, { ...page, crop: null, image: edits }, edits, frame);
    out[filter] = tile.toDataURL('image/jpeg', 0.82);
  }
  tile.width = tile.height = 0;
  return out;
}

/**
 * How far a photo can be made bigger or smaller: down to a pixel on its
 * shorter side; up to 8×, what one image can hold, and WebP's 16383 pixels a
 * side — but never below its own size, so 100% always keeps it as it is.
 */
export function photoScaleLimits(page: WorkPage): { min: number; max: number } {
  const base = displaySize(page);
  const max = Math.min(8, Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)), 16383 / Math.max(base.width, base.height));
  return { min: 1 / Math.min(base.width, base.height), max: Math.max(1, max) };
}

/**
 * `page` with its photo's geometry — flips and straightening — set to
 * `after`'s, the blurred areas moving along with what they cover.
 */
export function withPhotoGeometry(page: WorkPage, after: ImageEdits): WorkPage {
  const before = imageEditsOf(page);
  const moved = before.flipH !== after.flipH || before.flipV !== after.flipV || before.straighten !== after.straighten;
  return {
    ...page,
    image: compactImageEdits(after),
    overlays: moved ? page.overlays.map((o) => (o.kind === 'redact' ? { ...o, ...followPhoto(o, page, before, after) } : o)) : page.overlays,
  };
}

/**
 * `page` mirrored as it's seen (`axis`): what's shown comes out the mirror
 * image of itself. So the photo flips, its straightening turns the other way
 * (a mirror of a turn is the opposite turn), and its crop moves to the other
 * side, framing the same part, mirrored. What's drawn on the photo — text,
 * shapes, strokes — isn't mirrored: it moves with the crop, staying where it
 * was in the frame.
 */
export function flippedPhoto(page: WorkPage, axis: 'h' | 'v'): WorkPage {
  const before = imageEditsOf(page);
  // On a page turned a quarter, left to right as seen is the page's top to bottom.
  const quarter = (((page.rotation % 360) + 360) % 360) % 180 !== 0;
  const across = quarter ? axis === 'v' : axis === 'h';
  const after: ImageEdits = {
    ...before,
    flipH: across ? !before.flipH : before.flipH,
    flipV: across ? before.flipV : !before.flipV,
    straighten: before.straighten ? -before.straighten : 0,
  };
  const c = page.crop;
  const crop = c && (across ? { ...c, x: page.width - c.x - c.width } : { ...c, y: page.height - c.y - c.height });
  const dx = c && crop ? crop.x - c.x : 0;
  const dy = c && crop ? crop.y - c.y : 0;
  const flipped = withPhotoGeometry(page, after);
  return {
    ...flipped,
    crop,
    overlays: flipped.overlays.map((o) => (o.kind === 'redact' || (!dx && !dy) ? o : { ...o, x: o.x + dx, y: o.y + dy })),
  };
}

/** Whether blurring this page's photo falls to the slow box blur (no canvas
 * blur in this browser): the live view then works on fewer pixels. */
export function blursSlowly(page: WorkPage): boolean {
  const a = imageEditsOf(page).adjust;
  return (a.blur > 0 || a.sharpness > 0 || redactionsOf(page).some((r) => r.effect === 'blur')) && !canvasBlurs();
}

/** `e`, or nothing when it's all defaults — a page keeps no edits it doesn't have. */
export function compactImageEdits(e: ImageEdits): ImageEdits | undefined {
  const untouched =
    !e.flipH && !e.flipV && Math.abs(e.straighten) < 0.001 && e.filter === 'none' && !e.invert && Math.abs(e.scale - 1) < 1e-9 && ADJUST_KEYS.every((k) => e.adjust[k] === 0);
  return untouched ? undefined : e;
}
