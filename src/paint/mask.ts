/** 4-connected colour selection. Similar disconnected islands stay untouched. */
export function floodMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return mask;
  const start = y * width + x,
    at = start * 4;
  if (pixels[at + 3] === 0) return mask;
  const r = pixels[at],
    g = pixels[at + 1],
    b = pixels[at + 2],
    limit = 3 * Math.max(0, tolerance) ** 2;
  const seen = new Uint8Array(width * height),
    queue = new Uint32Array(width * height);
  let head = 0,
    tail = 1;
  queue[0] = start;
  seen[start] = 1;
  const visit = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    const k = i * 4;
    if (
      pixels[k + 3] &&
      (pixels[k] - r) ** 2 +
        (pixels[k + 1] - g) ** 2 +
        (pixels[k + 2] - b) ** 2 <=
        limit
    ) {
      queue[tail++] = i;
      mask[i] = 255;
    }
  };
  mask[start] = 255;
  while (head < tail) {
    const i = queue[head++],
      col = i % width;
    if (col > 0) visit(i - 1);
    if (col < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < width * (height - 1)) visit(i + width);
  }
  return mask;
}
export function brushLine(
  mask: Uint8Array,
  width: number,
  height: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  diameter: number,
  erase = false,
) {
  const radius = Math.max(0.5, diameter / 2),
    distance = Math.hypot(to.x - from.x, to.y - from.y),
    steps = Math.max(1, Math.ceil(distance / Math.max(0.5, radius / 3)));
  for (let step = 0; step <= steps; step++) {
    const cx = from.x + ((to.x - from.x) * step) / steps,
      cy = from.y + ((to.y - from.y) * step) / steps;
    for (
      let y = Math.max(0, Math.floor(cy - radius));
      y <= Math.min(height - 1, Math.ceil(cy + radius));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(cx - radius));
        x <= Math.min(width - 1, Math.ceil(cx + radius));
        x++
      ) {
        const coverage = Math.min(
            1,
            Math.max(0, radius + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)),
          ),
          i = y * width + x;
        if (erase)
          mask[i] = Math.min(mask[i], Math.round(255 * (1 - coverage)));
        else mask[i] = Math.max(mask[i], Math.round(255 * coverage));
      }
  }
}
/** Separable box feather, bounded memory and linear time, no image pixels copied. */
export function featherMask(
  input: Uint8Array,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.max(0, Math.round(radius));
  if (!r) return input.slice();
  const temp = new Float32Array(input.length),
    out = new Uint8Array(input.length),
    span = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++)
      sum += input[y * w + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      temp[y * w + x] = sum / span;
      sum +=
        input[y * w + Math.min(w - 1, x + r + 1)] -
        input[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++)
      sum += temp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / span);
      sum +=
        temp[Math.min(h - 1, y + r + 1) * w + x] -
        temp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
export { combine as mergeSelection } from "./core/selection";
