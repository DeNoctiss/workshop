import { normalizeHex } from "./core/color";
import type { Point } from "./core/selection";
import { uid, type Asset } from "../domain/model";
import type { PaintLayer } from "../domain/workspace";
export interface WorkingLayer extends Omit<PaintLayer, "maskAssetId"> {
  mask: Uint8Array;
}
export function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
export function maskCanvas(
  mask: Uint8Array,
  w: number,
  h: number,
  color = "#ffffff",
  alpha?: Uint8ClampedArray,
) {
  const normalized = normalizeHex(color);
  if (!normalized) throw new Error("Укажите цвет в формате #RRGGBB");
  color = normalized;
  const c = canvas(w, h),
    ctx = c.getContext("2d")!,
    im = ctx.createImageData(w, h),
    rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let i = 0; i < mask.length; i++) {
    const k = i * 4;
    im.data[k] = rgb[0];
    im.data[k + 1] = rgb[1];
    im.data[k + 2] = rgb[2];
    im.data[k + 3] = alpha
      ? Math.round((mask[i] * alpha[k + 3]) / 255)
      : mask[i];
  }
  ctx.putImageData(im, 0, 0);
  return c;
}
const opaqueBases = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
export function paintComposite(
  base: HTMLCanvasElement,
  layers: WorkingLayer[],
  target = canvas(base.width, base.height),
  cache?: Map<
    string,
    { mask: Uint8Array; color: string; canvas: HTMLCanvasElement }
  >,
) {
  if (cache) {
    const ids = new Set(layers.map((l) => l.id));
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  }
  const ctx = target.getContext("2d")!;
  ctx.save();
  ctx.resetTransform();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, target.width, target.height);
  if (
    !layers.some((l) => l.visible && l.opacity > 0 && l.mask.some((v) => v > 0))
  ) {
    ctx.drawImage(base, 0, 0);
    ctx.restore();
    return target;
  }
  let opaque = opaqueBases.get(base);
  if (!opaque) {
    opaque = canvas(base.width, base.height);
    const im = base
      .getContext("2d")!
      .getImageData(0, 0, base.width, base.height);
    for (let k = 3; k < im.data.length; k += 4) im.data[k] = 255;
    opaque.getContext("2d")!.putImageData(im, 0, 0);
    opaqueBases.set(base, opaque);
  }
  ctx.drawImage(opaque, 0, 0);
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    let entry = cache?.get(layer.id);
    if (!entry || entry.mask !== layer.mask || entry.color !== layer.color) {
      entry = {
        mask: layer.mask,
        color: layer.color,
        canvas: maskCanvas(layer.mask, base.width, base.height, layer.color),
      };
      cache?.set(layer.id, entry);
    }
    ctx.globalCompositeOperation = layer.blend;
    ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
    ctx.drawImage(entry.canvas, 0, 0);
  }
  // Recolour never creates opaque paint outside the original image's alpha.
  ctx.globalCompositeOperation = "destination-in";
  ctx.globalAlpha = 1;
  ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
  return target;
}
export function png(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Не удалось записать изображение")),
      "image/png",
    ),
  );
}
export async function derivedAsset(
  projectId: string,
  source: HTMLCanvasElement,
  purpose: Asset["purpose"],
  caption: string,
): Promise<Asset> {
  const blob = await png(source),
    ratio = Math.min(1, 480 / Math.max(source.width, source.height)),
    thumb = canvas(
      Math.max(1, Math.round(source.width * ratio)),
      Math.max(1, Math.round(source.height * ratio)),
    );
  thumb.getContext("2d")!.drawImage(source, 0, 0, thumb.width, thumb.height);
  return {
    id: uid(),
    projectId,
    group: "process",
    caption,
    order: 0,
    cover: false,
    purpose,
    blob,
    thumb: await png(thumb),
  };
}
export async function loadMask(blob: Blob, w: number, h: number) {
  const image = await createImageBitmap(blob);
  try {
    if (image.width !== w || image.height !== h)
      throw new Error("Размер маски не совпадает с документом");
    const c = canvas(w, h),
      ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    return Uint8Array.from({ length: w * h }, (_, i) => pixels[i * 4 + 3]);
  } finally {
    image.close();
  }
}
export function downloadPng(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".png") ? name : name + ".png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function polygonMask(points: Point[], w: number, h: number) {
  const out = new Uint8Array(w * h);
  if (new Set(points.map((p) => p.x + ":" + p.y)).size < 3) return out;
  const c = canvas(w, h),
    ctx = c.getContext("2d")!;
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill("evenodd");
  const pixels = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < out.length; i++) out[i] = pixels[i * 4 + 3];
  return out;
}
