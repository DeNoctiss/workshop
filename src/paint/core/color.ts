export function normalizeHex(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text))
    return "#" + [...text.slice(1)].map((c) => c + c).join("");
  return null;
}
const linear = Float64Array.from({ length: 256 }, (_, n) =>
  n / 255 <= 0.04045 ? n / 3294.6 : ((n / 255 + 0.055) / 1.055) ** 2.4,
);
export function rgbLab(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  r = linear[r];
  g = linear[g];
  b = linear[b];
  const f = (v: number) =>
    v > 216 / 24389 ? Math.cbrt(v) : ((24389 / 27) * v + 16) / 116;
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = f(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const z = f((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function labPixels(pixels: Uint8ClampedArray) {
  const out = new Float32Array((pixels.length / 4) * 3);
  for (let i = 0; i < pixels.length / 4; i++)
    out.set(rgbLab(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]), i * 3);
  return out;
}
