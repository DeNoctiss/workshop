import { labPixels } from "./core/color";
import { selectColor, growMask } from "./core/selection";
import { featherMask } from "./mask";
let pixels: Uint8ClampedArray,
  width: number,
  height: number,
  labs: Float32Array;
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      pixels = m.pixels;
      width = m.width;
      height = m.height;
      labs = labPixels(pixels);
      return;
    }
    const mask =
      m.type === "refine"
        ? featherMask(
            growMask(m.mask, width, height, m.grow),
            width,
            height,
            m.feather,
          )
        : selectColor(pixels, width, height, m.point, m.options, labs);
    self.postMessage({ id: m.id, mask }, { transfer: [mask.buffer] });
  } catch (error) {
    self.postMessage({ id: m.id, error: String(error) });
  }
};
