import {
  canvas,
  loadMask,
  maskCanvas,
  paintComposite,
  png,
  updateMaskCanvasRegion,
  type WorkingLayer,
} from "../src/paint/canvas";
import { stockReference } from "../src/catalog/catalog";
import { demoState } from "../src/data/demo";

const pixel = (source: HTMLCanvasElement, x: number) => [
  ...source.getContext("2d")!.getImageData(x, 0, 1, 1).data,
];
const equal = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${label}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`,
    );
};
const close = (actual: number, expected: number, label: string) => {
  if (Math.abs(actual - expected) > 1)
    throw new Error(`${label}: ${actual} ≠ ${expected}`);
};

/** Run in a real browser with Vite, without touching the user's IndexedDB. */
export async function runPaintBrowserChecks() {
  const source = canvas(4, 1),
    context = source.getContext("2d")!;
  const image = context.createImageData(4, 1);
  image.data.set([
    40, 50, 60, 255, 100, 120, 140, 255, 80, 90, 100, 128, 0, 0, 0, 0,
  ]);
  context.putImageData(image, 0, 0);
  const before = [...context.getImageData(0, 0, 4, 1).data];
  const catalog = demoState().materials.find((item) => item.code === "70.955");
  if (!catalog) throw new Error("Контрольной краски нет в каталоге");
  const hex = stockReference(catalog).snapshot.colorHex;
  equal(hex, "#e5b693", "HEX из каталога");
  const layer: WorkingLayer = {
    id: "test",
    name: "test",
    mask: new Uint8Array([255, 128, 255, 255]),
    color: hex!,
    opacity: 1,
    visible: true,
    blend: "source-over",
  };
  for (const blend of [
    "source-over",
    "color",
    "multiply",
    "soft-light",
  ] as const) {
    const transparent = paintComposite(source, [
      { ...layer, blend, opacity: 0 },
    ]);
    equal(
      [...transparent.getContext("2d")!.getImageData(0, 0, 4, 1).data],
      before,
      `0% ${blend}`,
    );
  }
  const exact = paintComposite(source, [layer]);
  equal(pixel(exact, 0), [229, 182, 147, 255], "полная маска и точный цвет");
  const edge = pixel(exact, 1);
  for (let channel = 0; channel < 3; channel++)
    close(
      edge[channel],
      before[4 + channel] * (127 / 255) +
        [229, 182, 147][channel] * (128 / 255),
      `край ${channel}`,
    );
  close(pixel(exact, 2)[3], 128, "альфа исходника");
  for (let channel = 0; channel < 3; channel++)
    close(
      pixel(exact, 2)[channel],
      [229, 182, 147][channel],
      `цвет при alpha=128, канал ${channel}`,
    );
  equal(pixel(exact, 3)[3], 0, "прозрачный фон");
  const textured = paintComposite(source, [{ ...layer, blend: "color" }]);
  if (JSON.stringify(pixel(textured, 0)) === JSON.stringify(pixel(exact, 0)))
    throw new Error("Светотень не отличается от точной закраски");
  equal(
    [
      ...paintComposite(source, [{ ...layer, visible: false }])
        .getContext("2d")!
        .getImageData(0, 0, 4, 1).data,
    ],
    before,
    "выключенный слой",
  );
  const top = { ...layer, id: "top", color: "#0077cc" };
  equal(
    pixel(paintComposite(source, [layer, top]), 0).slice(0, 3),
    [0, 119, 204],
    "порядок: верхний слой",
  );
  equal(
    pixel(paintComposite(source, [top, layer]), 0).slice(0, 3),
    [229, 182, 147],
    "порядок: нижний слой",
  );
  equal(
    [...context.getImageData(0, 0, 4, 1).data],
    before,
    "исходник не меняется",
  );

  const mask = new Uint8Array([255, 0, 64, 200]);
  const partial = maskCanvas(mask, 4, 1);
  mask[1] = 128;
  updateMaskCanvasRegion(
    partial,
    mask,
    4,
    { left: 1, top: 0, right: 2, bottom: 1 },
    "#ffffff",
  );
  equal(
    [...partial.getContext("2d")!.getImageData(0, 0, 4, 1).data],
    [...maskCanvas(mask, 4, 1).getContext("2d")!.getImageData(0, 0, 4, 1).data],
    "частичное обновление маски",
  );
  equal(
    [...(await loadMask(await png(partial), 4, 1))],
    [...mask],
    "PNG маски после открытия",
  );
  return {
    checks: 11,
    catalogHex: hex,
    exactRgb: pixel(exact, 0).slice(0, 3),
    sourceUnchanged: true,
  };
}
