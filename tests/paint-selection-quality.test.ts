import { describe, expect, it } from "vitest";
import { labPixels } from "../src/paint/core/color";
import {
  combine,
  growMask,
  imagePoint,
  likelyBackgroundSelection,
  selectColor,
  selectColorProtected,
  selectionCoverage,
  type WandOptions,
} from "../src/paint/core/selection";
import { featherMask } from "../src/paint/mask";

const options: WandOptions = {
  tolerance: 12,
  contiguous: true,
  diagonal: false,
};
const gray = (values: number[], alpha?: number[]) =>
  new Uint8ClampedArray(
    values.flatMap((value, i) => [value, value, value, alpha?.[i] ?? 255]),
  );
const iou = (mask: Uint8Array, expected: Uint8Array) => {
  let intersection = 0,
    union = 0;
  for (let i = 0; i < mask.length; i++) {
    const selected = mask[i] >= 128,
      truth = expected[i] >= 128;
    if (selected && truth) intersection++;
    if (selected || truth) union++;
  }
  return union ? intersection / union : 1;
};

describe("матрица палочки F1–F21", () => {
  it("F1: однотонная область отделена от контрастного фона, IoU ≥ 0.95", () => {
    const w = 6,
      h = 6,
      values = new Array(w * h).fill(20),
      truth = new Uint8Array(w * h);
    for (let y = 2; y <= 3; y++)
      for (let x = 2; x <= 3; x++) {
        values[y * w + x] = 200;
        truth[y * w + x] = 255;
      }
    const result = selectColor(gray(values), w, h, { x: 2, y: 2 }, options);
    expect(iou(result, truth)).toBeGreaterThanOrEqual(0.95);
    expect(selectionCoverage(result, w, h).border).toBe(0);
  });

  it("F2: одинаковые оттенки фона отделяются заданным лассо, IoU ≥ 0.95", () => {
    const w = 7,
      h = 7,
      pixels = gray(new Array(w * h).fill(130));
    const roi = new Uint8Array(w * h);
    for (let y = 2; y <= 4; y++) roi.fill(255, y * w + 2, y * w + 5);
    const seed = { x: 3, y: 3 };
    const baseline = selectColor(pixels, w, h, seed, options);
    const bounded = selectColor(pixels, w, h, seed, {
      ...options,
      limitMask: roi,
    });
    expect(selectionCoverage(baseline, w, h).count).toBe(49);
    expect(iou(bounded, roi)).toBeGreaterThanOrEqual(0.95);
    expect(selectionCoverage(bounded, w, h).border).toBe(0);
  });

  it("F3: антиалиасинг даёт только один мягкий внешний край, не цепочку", () => {
    const pixels = gray([100, 104, 108, 118, 140]);
    const hard = selectColor(
      pixels,
      5,
      1,
      { x: 0, y: 0 },
      { ...options, tolerance: 2 },
    );
    const soft = selectColor(
      pixels,
      5,
      1,
      { x: 0, y: 0 },
      { ...options, tolerance: 2, edgeSoftness: 3 },
    );
    expect(soft[0]).toBe(255);
    expect(soft[1]).toBe(255);
    expect(soft[2]).toBeGreaterThan(0);
    expect(soft[2]).toBeLessThan(255);
    expect(soft[3]).toBe(0);
    expect(soft[4]).toBe(0);
    expect(hard[2]).toBe(0);
  });

  it("F4: мягкий край лассо сохраняется и за его пределы маска не выходит", () => {
    const roi = new Uint8Array([255, 128, 0]);
    const result = selectColor(
      gray([120, 120, 120]),
      3,
      1,
      { x: 0, y: 0 },
      { ...options, limitMask: roi, edgeSoftness: 3 },
    );
    expect(result).toEqual(roi);
    expect(
      selectColor(
        gray([120, 120, 120]),
        3,
        1,
        { x: 2, y: 0 },
        { ...options, limitMask: roi },
      ),
    ).toEqual(new Uint8Array(3));
  });

  it("F5: глобальный режим находит островки, ROI ограничивает даже его", () => {
    const pixels = gray([100, 0, 100, 0, 100]);
    const global = { ...options, tolerance: 0, contiguous: false };
    expect([...selectColor(pixels, 5, 1, { x: 0, y: 0 }, global)]).toEqual([
      255, 0, 255, 0, 255,
    ]);
    expect([
      ...selectColor(
        pixels,
        5,
        1,
        { x: 0, y: 0 },
        { ...global, limitMask: new Uint8Array([255, 0, 0, 0, 0]) },
      ),
    ]).toEqual([255, 0, 0, 0, 0]);
  });

  it("F6: прозрачный проход не соединяет области; 8-связность контролируется явно", () => {
    const transparent = gray([100, 100, 100], [255, 0, 255]);
    expect([
      ...selectColor(transparent, 3, 1, { x: 0, y: 0 }, options),
    ]).toEqual([255, 0, 0]);
    const diagonal = gray([100, 0, 0, 100]);
    expect([
      ...selectColor(
        diagonal,
        2,
        2,
        { x: 0, y: 0 },
        { ...options, tolerance: 0 },
      ),
    ]).toEqual([255, 0, 0, 0]);
    expect([
      ...selectColor(
        diagonal,
        2,
        2,
        { x: 0, y: 0 },
        { ...options, tolerance: 0, diagonal: true },
      ),
    ]).toEqual([255, 0, 0, 255]);
  });

  it("F7: предупреждение о захвате рамки не подменяет явное решение", () => {
    const w = 20,
      h = 20,
      full = new Uint8Array(w * h).fill(255),
      small = new Uint8Array(w * h);
    small.fill(255, 9 * w + 9, 9 * w + 12);
    expect(
      likelyBackgroundSelection(full, w, h, { x: 10, y: 10 })?.fraction,
    ).toBe(1);
    expect(likelyBackgroundSelection(small, w, h, { x: 10, y: 10 })).toBeNull();
    expect(likelyBackgroundSelection(full, w, h, { x: 0, y: 10 })).toBeNull();
  });

  it("F8: неверный размер ROI отклонён, исходные массивы не меняются", () => {
    const pixels = gray([100, 100, 100]),
      roi = new Uint8Array([255, 0, 255]);
    const result = selectColor(
      pixels,
      3,
      1,
      { x: 0, y: 0 },
      { ...options, limitMask: roi },
    );
    expect(result).toEqual(new Uint8Array([255, 0, 0]));
    expect(
      selectColor(
        pixels,
        3,
        1,
        { x: 0, y: 0 },
        { ...options, contiguous: false, limitMask: roi },
      ),
    ).toEqual(roi);
    expect(roi).toEqual(new Uint8Array([255, 0, 255]));
    expect(() =>
      selectColor(
        pixels,
        3,
        1,
        { x: 0, y: 0 },
        { ...options, limitMask: new Uint8Array(2) },
      ),
    ).toThrow(/Размер/);
  });

  it("F9: grow/shrink и feather работают поверх маски, сохраняя оригинал", () => {
    const mask = new Uint8Array(25);
    mask[12] = 255;
    const grown = growMask(mask, 5, 5, 1),
      softened = featherMask(grown, 5, 5, 1);
    expect(selectionCoverage(grown, 5, 5).count).toBe(9);
    expect(softened.some((v) => v > 0 && v < 255)).toBe(true);
    expect(mask[12]).toBe(255);
    expect(mask.filter((v) => v > 0)).toHaveLength(1);
  });

  it("F10: координата не меняется при CSS-zoom, pan и DPR", () => {
    const point = { x: 480, y: 360 };
    expect(
      imagePoint(
        point,
        { left: 80, top: 60, width: 800, height: 600 },
        800,
        600,
      ),
    ).toEqual({ x: 400, y: 300 });
    expect(
      imagePoint(
        point,
        { left: 280, top: 210, width: 400, height: 300 },
        800,
        600,
      ),
    ).toEqual({ x: 400, y: 300 });
    const roi = new Uint8Array([255, 255, 0]);
    expect([
      ...combine(roi, new Uint8Array([0, 255, 255]), "intersect"),
    ]).toEqual([0, 255, 0]);
  });

  it("F11: градиент сравнивается с точкой клика, а не растекается по цепочке", () => {
    const pixels = gray([100, 105, 110, 115, 120]);
    const result = selectColor(
      pixels,
      5,
      1,
      { x: 0, y: 0 },
      { ...options, tolerance: 3 },
    );
    expect([...result]).toEqual([255, 255, 0, 0, 0]);
  });

  it("F12: крупная маска с ROI вычисляется детерминированно без рекурсии", () => {
    const w = 1024,
      h = 1024,
      roi = new Uint8Array(w * h);
    for (let y = 200; y < 800; y++) roi.fill(255, y * w + 200, y * w + 800);
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 120;
      pixels[i + 3] = 255;
    }
    const labs = labPixels(pixels);
    const bounded = { ...options, tolerance: 0, limitMask: roi };
    const first = selectColor(pixels, w, h, { x: 500, y: 500 }, bounded, labs);
    const second = selectColor(pixels, w, h, { x: 500, y: 500 }, bounded, labs);
    expect(first).toEqual(second);
    expect(selectionCoverage(first, w, h).count).toBe(600 * 600);
    expect(first[50 * w + 50]).toBe(0);
  });

  it("F13: пересечение масок и ограниченный обход остаются разными действиями", () => {
    const pixels = gray([120, 120, 120, 120, 120]);
    const roi = new Uint8Array([255, 0, 0, 0, 255]);
    const whole = selectColor(pixels, 5, 1, { x: 0, y: 0 }, options);
    const intersection = combine(roi, whole, "intersect");
    const bounded = selectColor(
      pixels,
      5,
      1,
      { x: 0, y: 0 },
      { ...options, limitMask: roi },
    );
    expect([...intersection]).toEqual([255, 0, 0, 0, 255]);
    expect([...bounded]).toEqual([255, 0, 0, 0, 0]);
  });

  it("F14: защита сохраняет локальный объект и останавливает выход к краю", () => {
    const w = 11,
      h = 11,
      values = new Array(w * h).fill(100),
      truth = new Uint8Array(w * h);
    for (let y = 4; y <= 6; y++)
      for (let x = 4; x <= 6; x++) {
        values[y * w + x] = 120;
        truth[y * w + x] = 255;
      }
    const pixels = gray(values),
      seed = { x: 5, y: 5 };
    const result = selectColorProtected(pixels, w, h, seed, {
      ...options,
      tolerance: 30,
      protectFrame: true,
    });
    expect(result.limited).toBe(true);
    expect(result.seedOnly).toBe(false);
    expect(result.effectiveTolerance).toBeLessThan(30);
    expect(result.mask).toEqual(truth);
    expect(selectionCoverage(result.mask, w, h).border).toBe(0);
  });

  it("F15: если исходный и фон неразличимы, защита оставляет точку клика", () => {
    const w = 11,
      h = 11,
      pixels = gray(new Array(w * h).fill(120));
    const seed = { x: 5, y: 5 };
    const guarded = selectColorProtected(pixels, w, h, seed, {
      ...options,
      protectFrame: true,
    });
    expect(guarded.limited).toBe(true);
    expect(guarded.seedOnly).toBe(true);
    expect(selectionCoverage(guarded.mask, w, h).count).toBe(1);
    expect(guarded.mask[seed.y * w + seed.x]).toBe(255);
    const explicit = selectColorProtected(pixels, w, h, seed, {
      ...options,
      protectFrame: false,
    });
    expect(explicit.limited).toBe(false);
    expect(explicit.seedOnly).toBe(false);
    expect(selectionCoverage(explicit.mask, w, h).count).toBe(w * h);
  });

  it("F16: защита не подменяет глобальный режим и заданную границу лассо", () => {
    const w = 11,
      h = 11,
      pixels = gray(new Array(w * h).fill(120));
    const seed = { x: 5, y: 5 },
      roi = new Uint8Array(w * h);
    roi[seed.y * w + seed.x] = 255;
    const global = selectColorProtected(pixels, w, h, seed, {
      ...options,
      contiguous: false,
      protectFrame: true,
    });
    const bounded = selectColorProtected(pixels, w, h, seed, {
      ...options,
      protectFrame: true,
      limitMask: roi,
    });
    expect(global.limited).toBe(false);
    expect(selectionCoverage(global.mask, w, h).count).toBe(w * h);
    expect(bounded.limited).toBe(false);
    expect(bounded.mask).toEqual(roi);
  });

  it("F17: мягкий край не возвращает пиксели на рамке кадра", () => {
    const w = 11,
      h = 11,
      values = new Array(w * h).fill(120);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1)
          values[y * w + x] = 124;
    const result = selectColorProtected(
      gray(values),
      w,
      h,
      { x: 5, y: 5 },
      {
        ...options,
        tolerance: 0,
        edgeSoftness: 10,
        protectFrame: true,
      },
    );
    expect(result.limited).toBe(false);
    expect(selectionCoverage(result.mask, w, h).border).toBe(0);
    expect(result.mask.slice(0, w)).toEqual(new Uint8Array(w));
    expect(result.mask.slice((h - 1) * w)).toEqual(new Uint8Array(w));
    for (let y = 0; y < h; y++) {
      expect(result.mask[y * w]).toBe(0);
      expect(result.mask[y * w + w - 1]).toBe(0);
    }
    expect(result.mask[5 * w + 5]).toBe(255);
  });

  it("F18: намеренный клик у края кадра не ограничивается защитой", () => {
    const w = 11,
      h = 11;
    const result = selectColorProtected(
      gray(new Array(w * h).fill(120)),
      w,
      h,
      { x: 0, y: 0 },
      { ...options, protectFrame: true },
    );
    expect(result.limited).toBe(false);
    expect(selectionCoverage(result.mask, w, h).count).toBe(w * h);
  });

  it("F19: защита использует дробный допуск, когда целый теряет нужную область", () => {
    const w = 11,
      h = 11,
      labs = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        labs[(y * w + x) * 3] =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1.8 : 1.5;
    labs[(5 * w + 5) * 3] = 0;
    const result = selectColorProtected(
      gray(new Array(w * h).fill(120)),
      w,
      h,
      { x: 5, y: 5 },
      { ...options, tolerance: 2, protectFrame: true },
      labs,
    );
    expect(result.effectiveTolerance).toBeGreaterThan(1.5);
    expect(result.effectiveTolerance).toBeLessThan(1.8);
    expect(selectionCoverage(result.mask, w, h).count).toBe(9 * 9);
    expect(selectionCoverage(result.mask, w, h).border).toBe(0);
  });

  it("F20: образец 3×3 устойчив к одиночному шумному пикселю в точке клика", () => {
    const w = 7,
      h = 7,
      values = new Array(w * h).fill(100);
    values[3 * w + 3] = 200;
    const pixels = gray(values),
      point = { x: 3, y: 3 };
    const exact = selectColor(pixels, w, h, point, {
      ...options,
      tolerance: 0,
    });
    const median = selectColor(pixels, w, h, point, {
      ...options,
      tolerance: 0,
      sampleRadius: 1,
    });
    expect(selectionCoverage(exact, w, h).count).toBe(1);
    expect(selectionCoverage(median, w, h).count).toBe(w * h);
  });

  it("F21: точечный образец остаётся доступным для тонкой детали", () => {
    const w = 7,
      h = 7,
      values = new Array(w * h).fill(100);
    values[3 * w + 3] = 200;
    const pixels = gray(values),
      point = { x: 3, y: 3 };
    const exact = selectColor(pixels, w, h, point, {
      ...options,
      tolerance: 0,
      sampleRadius: 0,
    });
    expect(exact[3 * w + 3]).toBe(255);
    expect(exact[3 * w + 2]).toBe(0);
  });
});
