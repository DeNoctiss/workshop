import { describe, it, expect } from "vitest";
import { normalizeHex, rgbLab } from "../src/paint/core/color";
import {
  combine,
  selectColor,
  growMask,
  strokeCoverage,
  combineStrokeRegion,
  paintStroke,
  imagePoint,
  hasSelection,
} from "../src/paint/core/selection";
import { PaintSession } from "../src/paint/core/PaintSession";
import { featherMask } from "../src/paint/mask";
const opts = { tolerance: 0, contiguous: true, diagonal: false };
const rgba = (values: number[]) =>
  new Uint8ClampedArray(values.flatMap((v) => [v, v, v, 255]));
describe("Выделение 2.0", () => {
  it("различает смежную область и весь кадр", () => {
    const p = rgba([50, 0, 50]);
    expect([...selectColor(p, 3, 1, { x: 0, y: 0 }, opts)]).toEqual([
      255, 0, 0,
    ]);
    expect([
      ...selectColor(p, 3, 1, { x: 0, y: 0 }, { ...opts, contiguous: false }),
    ]).toEqual([255, 0, 255]);
  });
  it("учитывает 4 / 8 соседей", () => {
    const p = rgba([50, 0, 0, 50]);
    expect([...selectColor(p, 2, 2, { x: 0, y: 0 }, opts)]).toEqual([
      255, 0, 0, 0,
    ]);
    expect([
      ...selectColor(p, 2, 2, { x: 0, y: 0 }, { ...opts, diagonal: true }),
    ]).toEqual([255, 0, 0, 255]);
  });
  it("не растекается по цепочке похожих оттенков", () => {
    const m = selectColor(
      rgba([100, 105, 110, 115, 120]),
      5,
      1,
      { x: 0, y: 0 },
      { ...opts, tolerance: 3 },
    );
    expect([...m]).toEqual([255, 255, 0, 0, 0]);
  });
  it("не захватывает прозрачный фон", () => {
    const p = rgba([50, 50]);
    p[3] = 0;
    expect([
      ...selectColor(p, 2, 1, { x: 1, y: 0 }, { ...opts, contiguous: false }),
    ]).toEqual([0, 255]);
    expect(hasSelection(selectColor(p, 2, 1, { x: 0, y: 0 }, opts))).toBe(
      false,
    );
  });
  it("клик за изображением создаёт пустую маску", () =>
    expect(
      hasSelection(selectColor(rgba([50]), 1, 1, { x: -1, y: 0 }, opts)),
    ).toBe(false));
  it("применяет одинаковую алгебру мягких масок без мутации", () => {
    const a = new Uint8Array([100, 200, 255]),
      b = new Uint8Array([70, 220, 0]);
    expect([...combine(a, b, "add")]).toEqual([100, 220, 255]);
    expect([...combine(a, b, "subtract")]).toEqual([30, 0, 255]);
    expect([...combine(a, b, "intersect")]).toEqual([70, 200, 0]);
    expect([...a]).toEqual([100, 200, 255]);
    expect(combine(a, b, "replace")).not.toBe(b);
  });
  it("расширяет и сужает тонкую область с учётом края кадра", () => {
    const mask = new Uint8Array(25);
    mask[12] = 255;
    const g = growMask(mask, 5, 5, 1);
    expect([...g].filter((v) => v === 255)).toHaveLength(9);
    expect([...growMask(g, 5, 5, -1)]).toEqual([...mask]);
    expect(hasSelection(growMask(mask, 5, 5, -1))).toBe(false);
    expect([...growMask(new Uint8Array(9).fill(255), 3, 3, -1)]).toEqual([
      0, 0, 0, 0, 255, 0, 0, 0, 0,
    ]);
  });
  it("растушёвка от исходной маски обратима при возврате к 0", () => {
    const m = new Uint8Array([0, 0, 255, 0, 0]);
    expect(featherMask(m, 5, 1, 0)).toEqual(m);
    expect(featherMask(m, 5, 1, 1)).toEqual(featherMask(m, 5, 1, 1));
    expect(m[2]).toBe(255);
  });
  it("сила кисти не зависит от числа событий в одном мазке", () => {
    const cover = new Uint8Array(100),
      p = { x: 5.5, y: 5.5 };
    for (let n = 0; n < 100; n++) strokeCoverage(cover, 10, 10, p, p, 4, 1);
    const once = paintStroke(new Uint8Array(100), cover, 0.5, false, null);
    expect(once[55]).toBe(128);
    expect(paintStroke(once, cover, 0.5, false, null)[55]).toBe(192);
  });
  it("интерполирует быстрый мазок и учитывает выделение у ластика", () => {
    const cover = new Uint8Array(300);
    strokeCoverage(cover, 30, 10, { x: 2, y: 5 }, { x: 27, y: 5 }, 4, 1);
    for (let x = 2; x <= 27; x++) expect(cover[150 + x]).toBe(255);
    const original = new Uint8Array(300).fill(255),
      selected = new Uint8Array(300);
    selected[155] = 255;
    const result = paintStroke(original, cover, 1, true, selected);
    expect(result[155]).toBe(0);
    expect(result[156]).toBe(255);
    expect(original[155]).toBe(255);
  });
  it("кисть добавляет и стирает маску одним шагом истории на мазок", () => {
    const session = new PaintSession(10, 10);
    const added = new Uint8Array(100),
      coverage = new Uint8Array(100);
    const addRect = strokeCoverage(
      coverage,
      10,
      10,
      { x: 3.5, y: 5.5 },
      { x: 6.5, y: 5.5 },
      4,
      1,
    );
    combineStrokeRegion(null, coverage, added, "add", 10, addRect);
    session.change({ ...session.frame, selection: added });
    expect(added[55]).toBe(255);
    expect(added[0]).toBe(0);

    const erased = added.slice(),
      eraseCoverage = new Uint8Array(100);
    const eraseRect = strokeCoverage(
      eraseCoverage,
      10,
      10,
      { x: 5.5, y: 5.5 },
      { x: 5.5, y: 5.5 },
      2,
      1,
    );
    combineStrokeRegion(
      added,
      eraseCoverage,
      erased,
      "subtract",
      10,
      eraseRect,
    );
    session.change({ ...session.frame, selection: erased });
    expect(erased[55]).toBe(0);
    expect(added[55]).toBe(255);
    session.undo();
    expect(session.frame.selection).toEqual(added);
    session.undo();
    expect(session.frame.selection).toBeNull();
    session.undo(true);
    expect(session.frame.selection).toEqual(added);
    session.undo(true);
    expect(session.frame.selection).toEqual(erased);
  });
  it("переводит CSS-координаты в рабочие пиксели при масштабе и DPR", () => {
    expect(
      imagePoint(
        { x: 200, y: 180 },
        { left: 100, top: 80, width: 400, height: 200 },
        800,
        400,
      ),
    ).toEqual({ x: 200, y: 200 });
    expect(
      imagePoint(
        { x: 150, y: 130 },
        { left: 100, top: 80, width: 200, height: 100 },
        800,
        400,
      ),
    ).toEqual({ x: 200, y: 200 });
  });
  it("нормализует HEX и не подставляет серый при ошибке", () => {
    expect(normalizeHex(" #Fa8 ")).toBe("#ffaa88");
    expect(normalizeHex("#00zz00")).toBeNull();
    expect(normalizeHex("")).toBeNull();
    expect(rgbLab(255, 255, 255)[0]).toBeCloseTo(100, 3);
  });
});
describe("История и слои", () => {
  const selected = () => {
    const s = new PaintSession(2, 2);
    s.change({ ...s.frame, selection: new Uint8Array([255, 0, 0, 255]) });
    return s;
  };
  it("выделение не меняет слои до явного применения", () => {
    const s = selected();
    expect(s.frame.layers).toHaveLength(0);
    expect(s.revision).toBe(0);
    s.addLayer("#e5a276");
    expect(s.frame.layers[0].mask).toEqual(new Uint8Array([255, 0, 0, 255]));
    expect(s.frame.selection).toBeNull();
  });
  it("пустое выделение не становится заливкой кадра", () => {
    const s = new PaintSession(2, 2);
    expect(() => s.addLayer("#abcdef")).toThrow();
    s.addLayer("#abcdef", undefined, true);
    expect(hasSelection(s.active!.mask)).toBe(false);
  });
  it("отмена редактирования области сохраняет подтверждённую маску", () => {
    const s = selected();
    s.addLayer("#abcdef");
    const mask = s.active!.mask;
    s.editArea();
    s.change({ ...s.frame, selection: new Uint8Array(4) });
    s.cancelArea();
    expect(s.active!.mask).toBe(mask);
  });
  it("применение области отменяется вместе с состоянием редактирования", () => {
    const s = selected();
    s.addLayer("#abcdef");
    s.editArea();
    s.change({ ...s.frame, selection: new Uint8Array(4) });
    s.applyArea();
    expect(hasSelection(s.active!.mask)).toBe(false);
    s.undo();
    expect(hasSelection(s.active!.mask)).toBe(true);
    expect(s.frame.editing).toBe(s.active!.id);
    s.undo(true);
    expect(hasSelection(s.active!.mask)).toBe(false);
  });
  it("двадцать движений ползунка — одна запись истории", () => {
    const s = selected();
    s.addLayer("#abcdef");
    const count = s.past.length;
    for (let i = 0; i < 20; i++)
      s.patch(s.active!.id, { opacity: i / 20 }, true);
    s.commit();
    expect(s.past).toHaveLength(count + 1);
    s.undo();
    expect(s.active!.opacity).toBe(1);
  });
  it("дубликат не разделяет изменяемую маску и новое действие очищает redo", () => {
    const s = selected();
    s.addLayer("#abcdef");
    const first = s.active!;
    s.duplicate();
    s.active!.mask[0] = 0;
    expect(first.mask[0]).toBe(255);
    s.undo();
    s.patch(s.active!.id, { color: "#ff0000" });
    expect(s.future).toHaveLength(0);
  });
  it("отмена незавершённого мазка не создаёт запись истории", () => {
    const s = selected();
    s.addLayer("#abcdef");
    const frame = s.frame,
      count = s.past.length;
    s.patch(s.active!.id, { mask: new Uint8Array(4) }, true);
    s.cancel();
    expect(s.frame).toBe(frame);
    expect(s.past).toHaveLength(count);
  });
});
