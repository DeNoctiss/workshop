import { labPixels } from "./color";
export type Point = { x: number; y: number };
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
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const seed = y * w + x,
    at = seed * 3,
    limit = Math.max(0, options.tolerance) ** 2;
  if (!pixels[seed * 4 + 3]) return out;
  const matches = (i: number) =>
    pixels[i * 4 + 3] > 0 &&
    (labs[i * 3] - labs[at]) ** 2 +
      (labs[i * 3 + 1] - labs[at + 1]) ** 2 +
      (labs[i * 3 + 2] - labs[at + 2]) ** 2 <=
      limit;
  if (!options.contiguous) {
    for (let i = 0; i < out.length; i++) if (matches(i)) out[i] = 255;
    return out;
  }
  const seen = new Uint8Array(w * h),
    queue = new Uint32Array(w * h);
  let head = 0,
    tail = 1;
  queue[0] = seed;
  seen[seed] = 1;
  out[seed] = 255;
  const visit = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    if (matches(i)) {
      out[i] = 255;
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
  return out;
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
}
export function paintStroke(
  original: Uint8Array,
  coverage: Uint8Array,
  opacity: number,
  erase: boolean,
  selection: Uint8Array | null,
) {
  return original.map((v, i) => {
    const a =
      (coverage[i] / 255) *
      Math.max(0, Math.min(1, opacity)) *
      (selection ? selection[i] / 255 : 1);
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
