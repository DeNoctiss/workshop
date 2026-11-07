import { labPixels } from "./color";
export type Point = { x: number; y: number };
export type MaskRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type SelectionMode = "replace" | "add" | "subtract" | "intersect";
export const hasSelection = (mask: Uint8Array | null) =>
  !!mask?.some((v) => v > 0);
export function combine(
  a: Uint8Array | null,
  b: Uint8Array,
  mode: SelectionMode,
): Uint8Array {
  if (mode === "replace") return b.slice();
  return b.map((v, i) =>
    mode === "add"
      ? Math.max(a?.[i] ?? 0, v)
      : mode === "subtract"
        ? Math.max(0, (a?.[i] ?? 0) - v)
        : Math.min(a?.[i] ?? 0, v),
  );
}
export interface WandOptions {
  tolerance: number;
  contiguous: boolean;
  diagonal: boolean;
  /** For interior clicks, lower tolerance before the region can reach the frame. */
  protectFrame?: boolean;
  /** Existing lasso/selection can bound the search without changing stored masks. */
  limitMask?: Uint8Array;
  /** ΔE range just outside the hard boundary; 0 preserves the old binary mask. */
  edgeSoftness?: number;
  /** Median Lab sample from a 3×3 neighborhood; 0 uses the exact clicked pixel. */
  sampleRadius?: 0 | 1;
}
function reachesFrame(mask: Uint8Array, w: number, h: number) {
  for (let x = 0; x < w; x++) if (mask[x] || mask[(h - 1) * w + x]) return true;
  for (let y = 1; y < h - 1; y++)
    if (mask[y * w] || mask[y * w + w - 1]) return true;
  return false;
}
function clearFrame(mask: Uint8Array, w: number, h: number) {
  for (let x = 0; x < w; x++) {
    mask[x] = 0;
    mask[(h - 1) * w + x] = 0;
  }
  for (let y = 1; y < h - 1; y++) {
    mask[y * w] = 0;
    mask[y * w + w - 1] = 0;
  }
}
export function selectColorProtected(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  point: Point,
  options: WandOptions,
  labs: Float32Array = labPixels(pixels),
) {
  const margin = Math.max(4, Math.min(w, h) * 0.04);
  const eligible =
    options.protectFrame &&
    options.contiguous &&
    !options.limitMask &&
    point.x >= margin &&
    point.y >= margin &&
    point.x < w - margin &&
    point.y < h - margin;
  if (!eligible)
    return {
      mask: selectColor(pixels, w, h, point, options, labs),
      effectiveTolerance: options.tolerance,
      limited: false,
      seedOnly: false,
    };
  const hard = { ...options, edgeSoftness: 0 };
  const requested = selectColor(pixels, w, h, point, hard, labs);
  if (!reachesFrame(requested, w, h)) {
    const mask = options.edgeSoftness
      ? selectColor(pixels, w, h, point, options, labs)
      : requested;
    if (options.edgeSoftness) clearFrame(mask, w, h);
    return {
      mask,
      effectiveTolerance: options.tolerance,
      limited: false,
      seedOnly: false,
    };
  }
  const atZero = selectColor(
    pixels,
    w,
    h,
    point,
    { ...hard, tolerance: 0 },
    labs,
  );
  const seedOnly = reachesFrame(atZero, w, h);
  let low = 0,
    high = Math.max(0, options.tolerance);
  if (!seedOnly)
    for (let attempt = 0; attempt < 12 && high - low > 0.1; attempt++) {
      const middle = (low + high) / 2;
      const candidate = selectColor(
        pixels,
        w,
        h,
        point,
        { ...hard, tolerance: middle },
        labs,
      );
      if (reachesFrame(candidate, w, h)) high = middle;
      else low = middle;
    }
  // Round down to a readable tenth without ever crossing the unsafe threshold.
  const effectiveTolerance = Math.floor(low * 10 + 1e-8) / 10;
  const mask = seedOnly
    ? new Uint8Array(w * h)
    : selectColor(
        pixels,
        w,
        h,
        point,
        { ...options, tolerance: effectiveTolerance },
        labs,
      );
  if (seedOnly) {
    const x = Math.floor(point.x),
      y = Math.floor(point.y);
    if (x >= 0 && y >= 0 && x < w && y < h)
      mask[y * w + x] = pixels[(y * w + x) * 4 + 3] ? 255 : 0;
  }
  // A soft one-pixel edge must not reintroduce a frame-connected result.
  clearFrame(mask, w, h);
  return { mask, effectiveTolerance, limited: true, seedOnly };
}
export function selectionCoverage(mask: Uint8Array, w: number, h: number) {
  let count = 0,
    border = 0;
  for (let y = 0, row = 0; y < h; y++, row += w)
    for (let x = 0; x < w; x++)
      if (mask[row + x] >= 128) {
        count++;
        if (x === 0 || x === w - 1 || y === 0 || y === h - 1) border++;
      }
  return { count, border, fraction: count / (w * h) };
}
/** Conservative warning, not a semantic claim that the subject is known. */
export function likelyBackgroundSelection(
  mask: Uint8Array,
  w: number,
  h: number,
  point: Point,
) {
  const margin = Math.max(4, Math.min(w, h) * 0.04);
  if (
    point.x < margin ||
    point.y < margin ||
    point.x >= w - margin ||
    point.y >= h - margin
  )
    return null;
  const coverage = selectionCoverage(mask, w, h);
  return coverage.fraction > 0.5 && coverage.border > (2 * w + 2 * h - 4) * 0.4
    ? coverage
    : null;
}
export function selectColor(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  point: Point,
  options: WandOptions,
  labs: Float32Array = labPixels(pixels),
) {
  const out = new Uint8Array(w * h),
    x = Math.floor(point.x),
    y = Math.floor(point.y);
  const roi = options.limitMask;
  if (roi && roi.length !== out.length)
    throw new Error("Размер ограничивающей маски не совпадает с изображением");
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const seed = y * w + x,
    at = seed * 3,
    limit = Math.max(0, options.tolerance) ** 2;
  if (!pixels[seed * 4 + 3] || (roi && !roi[seed])) return out;
  const seedLab = [labs[at], labs[at + 1], labs[at + 2]];
  if (options.sampleRadius === 1) {
    const samples = [[], [], []] as number[][];
    for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
      for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
        const i = yy * w + xx;
        if (!pixels[i * 4 + 3] || (roi && !roi[i])) continue;
        for (let channel = 0; channel < 3; channel++)
          samples[channel].push(labs[i * 3 + channel]);
      }
    for (let channel = 0; channel < 3; channel++) {
      const values = samples[channel].sort((a, b) => a - b);
      if (values.length)
        seedLab[channel] = values[Math.floor(values.length / 2)];
    }
  }
  const matches = (i: number) =>
    pixels[i * 4 + 3] > 0 &&
    (!roi || roi[i] > 0) &&
    (labs[i * 3] - seedLab[0]) ** 2 +
      (labs[i * 3 + 1] - seedLab[1]) ** 2 +
      (labs[i * 3 + 2] - seedLab[2]) ** 2 <=
      limit;
  const soften = () => {
    const range = Math.min(10, Math.max(0, options.edgeSoftness ?? 0));
    if (!range) return out;
    const soft = out.slice(),
      maxDistance = Math.max(0, options.tolerance) + range;
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (
          out[i] ||
          !pixels[i * 4 + 3] ||
          (roi && !roi[i]) ||
          !(
            (col > 0 && out[i - 1]) ||
            (col < w - 1 && out[i + 1]) ||
            (row > 0 && out[i - w]) ||
            (row < h - 1 && out[i + w])
          )
        )
          continue;
        const k = i * 3,
          distance = Math.hypot(
            labs[k] - seedLab[0],
            labs[k + 1] - seedLab[1],
            labs[k + 2] - seedLab[2],
          );
        if (distance < maxDistance)
          soft[i] = Math.min(
            254,
            roi?.[i] ?? 255,
            Math.round((255 * (maxDistance - distance)) / range),
          );
      }
    return soft;
  };
  if (!options.contiguous) {
    for (let i = 0; i < out.length; i++)
      if (matches(i)) out[i] = roi?.[i] ?? 255;
    return soften();
  }
  const seen = new Uint8Array(w * h),
    queue = new Uint32Array(w * h);
  let head = 0,
    tail = 1;
  queue[0] = seed;
  seen[seed] = 1;
  out[seed] = roi?.[seed] ?? 255;
  const visit = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    if (matches(i)) {
      out[i] = roi?.[i] ?? 255;
      queue[tail++] = i;
    }
  };
  while (head < tail) {
    const i = queue[head++],
      col = i % w,
      row = Math.floor(i / w);
    if (col > 0) visit(i - 1);
    if (col < w - 1) visit(i + 1);
    if (row > 0) visit(i - w);
    if (row < h - 1) visit(i + w);
    if (options.diagonal) {
      if (col > 0 && row > 0) visit(i - w - 1);
      if (col < w - 1 && row > 0) visit(i - w + 1);
      if (col > 0 && row < h - 1) visit(i + w - 1);
      if (col < w - 1 && row < h - 1) visit(i + w + 1);
    }
  }
  return soften();
}
/** Separable sliding max/min; outside the image is always unselected. */
export function growMask(
  input: Uint8Array,
  w: number,
  h: number,
  amount: number,
): Uint8Array {
  const r = Math.min(40, Math.abs(Math.round(amount)));
  if (!r) return input.slice();
  const expand = amount > 0,
    temp = new Uint8Array(input.length),
    out = new Uint8Array(input.length);
  const pass = (
    src: Uint8Array,
    dst: Uint8Array,
    length: number,
    lines: number,
    vertical: boolean,
  ) => {
    const deque = new Int32Array(length + 2 * r + 1),
      values = new Uint8Array(length + 2 * r + 1);
    for (let line = 0; line < lines; line++) {
      let front = 0,
        back = 0;
      for (let pos = -r; pos < length + r; pos++) {
        const value =
          pos < 0 || pos >= length
            ? 0
            : src[vertical ? pos * w + line : line * w + pos];
        while (
          back > front &&
          (expand ? values[back - 1] <= value : values[back - 1] >= value)
        )
          back--;
        deque[back] = pos;
        values[back++] = value;
        while (back > front && deque[front] < pos - 2 * r) front++;
        const center = pos - r;
        if (center >= 0)
          dst[vertical ? center * w + line : line * w + center] = values[front];
      }
    }
  };
  pass(input, temp, w, h, false);
  pass(temp, out, h, w, true);
  return out;
}
export function outlineMask(mask: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++)
    if (
      mask[i] >= 128 &&
      (i % w === 0 ||
        i % w === w - 1 ||
        i < w ||
        i >= w * (h - 1) ||
        mask[i - 1] < 128 ||
        mask[i + 1] < 128 ||
        mask[i - w] < 128 ||
        mask[i + w] < 128)
    )
      out[i] = 255;
  return out;
}
/** Coverage accumulates with max within ONE stroke, so event frequency never darkens it. */
export function strokeCoverage(
  mask: Uint8Array,
  w: number,
  h: number,
  from: Point,
  to: Point,
  diameter: number,
  hardness: number,
) {
  const r = Math.max(0.5, diameter / 2),
    inner = r * Math.max(0, Math.min(1, hardness)),
    rect: MaskRect = {
      left: Math.max(0, Math.floor(Math.min(from.x, to.x) - r - 1)),
      top: Math.max(0, Math.floor(Math.min(from.y, to.y) - r - 1)),
      right: Math.min(w, Math.ceil(Math.max(from.x, to.x) + r) + 1),
      bottom: Math.min(h, Math.ceil(Math.max(from.y, to.y) + r) + 1),
    },
    steps = Math.max(
      1,
      Math.ceil(
        Math.hypot(to.x - from.x, to.y - from.y) / Math.max(0.5, r / 4),
      ),
    );
  for (let s = 0; s <= steps; s++) {
    const cx = from.x + ((to.x - from.x) * s) / steps,
      cy = from.y + ((to.y - from.y) * s) / steps;
    for (
      let y = Math.max(0, Math.floor(cy - r - 1));
      y <= Math.min(h - 1, Math.ceil(cy + r));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(cx - r - 1));
        x <= Math.min(w - 1, Math.ceil(cx + r));
        x++
      ) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy),
          edge = Math.max(0, Math.min(1, r + 0.5 - d)),
          soft =
            d <= inner
              ? 1
              : Math.max(0, (r + 0.5 - d) / Math.max(0.5, r + 0.5 - inner)),
          i = y * w + x;
        mask[i] = Math.max(mask[i], Math.round(255 * edge * soft));
      }
  }
  return rect;
}
/** Update only pixels touched by the latest segment; previous segments remain in target. */
export function combineStrokeRegion(
  original: Uint8Array | null,
  coverage: Uint8Array,
  target: Uint8Array,
  mode: SelectionMode,
  width: number,
  rect: MaskRect,
) {
  for (let y = rect.top; y < rect.bottom; y++)
    for (let x = rect.left; x < rect.right; x++) {
      const i = y * width + x,
        a = original?.[i] ?? 0,
        b = coverage[i];
      target[i] =
        mode === "replace"
          ? b
          : mode === "add"
            ? Math.max(a, b)
            : mode === "subtract"
              ? Math.max(0, a - b)
              : Math.min(a, b);
    }
}
/** A layer brush uses null for no active selection, including an all-zero mask. */
export function paintStrokeRegion(
  original: Uint8Array,
  target: Uint8Array,
  coverage: Uint8Array,
  opacity: number,
  erase: boolean,
  selection: Uint8Array | null,
  width: number,
  rect: MaskRect,
) {
  const strength = Math.max(0, Math.min(1, opacity));
  for (let y = rect.top; y < rect.bottom; y++)
    for (let x = rect.left; x < rect.right; x++) {
      const i = y * width + x,
        v = original[i],
        a =
          (coverage[i] / 255) * strength * (selection ? selection[i] / 255 : 1);
      target[i] = Math.round(erase ? v * (1 - a) : v + (255 - v) * a);
    }
}
export function paintStroke(
  original: Uint8Array,
  coverage: Uint8Array,
  opacity: number,
  erase: boolean,
  selection: Uint8Array | null,
) {
  const constraint = hasSelection(selection) ? selection : null;
  return original.map((v, i) => {
    const a =
      (coverage[i] / 255) *
      Math.max(0, Math.min(1, opacity)) *
      (constraint ? constraint[i] / 255 : 1);
    return Math.round(erase ? v * (1 - a) : v + (255 - v) * a);
  });
}
export function imagePoint(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  w: number,
  h: number,
): Point {
  return {
    x: ((client.x - rect.left) * w) / rect.width,
    y: ((client.y - rect.top) * h) / rect.height,
  };
}
