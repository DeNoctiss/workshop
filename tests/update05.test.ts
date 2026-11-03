import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import { fixture } from "./fixture";
import { uid, now, type Asset } from "../src/domain/model";
import { emptyBoard, migrateState } from "../src/domain/migrations";
import { saveNote } from "../src/domain/workflow";
import { applyStocktake } from "../src/domain/inventory";
import { stock, start, movement } from "../src/domain/engine";
import {
  createNode,
  absolutePosition,
  dropIntoGroups,
  setEdgeDirection,
  deleteSelection,
  duplicateNodes,
} from "../src/board/operations";
import {
  floodMask,
  brushLine,
  featherMask,
  mergeSelection,
} from "../src/paint/mask";
import {
  db,
  replaceAll,
  mutateWithAssets,
  snapshot,
  removeAsset,
  copyProject,
} from "../src/data/db";
import { encodeBackup, decodeBackup } from "../src/data/backup";
import type { PaintDocument } from "../src/domain/workspace";

beforeEach(async () => {
  await db.open();
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    await db.states.clear();
    await db.assets.clear();
    await db.assetIndex.clear();
  });
});
function photo(projectId: string, purpose?: Asset["purpose"]): Asset {
  return {
    id: uid(),
    projectId,
    group: "process",
    caption: "Фото",
    order: 0,
    cover: false,
    purpose,
    blob: new Blob(["original"], { type: "image/png" }),
    thumb: new Blob(["thumb"], { type: "image/png" }),
  };
}
function painting(projectId: string) {
  const source = photo(projectId),
    mask = photo(projectId, "paint-mask"),
    preview = photo(projectId, "paint-preview");
  const doc: PaintDocument = {
    id: uid(),
    sourceAssetId: source.id,
    previewAssetId: preview.id,
    width: 2,
    height: 2,
    updatedAt: now(),
    layers: [
      {
        id: uid(),
        name: "Куртка",
        maskAssetId: mask.id,
        color: "#2468ac",
        opacity: 0.7,
        visible: true,
        blend: "color",
      },
    ],
  };
  return { source, mask, preview, doc };
}
function grouped() {
  const b = emptyBoard(uid()),
    g = createNode({ kind: "group", title: "Этап" }, { x: 100, y: 100 }),
    n = createNode(
      { kind: "note", title: "Краска", text: "" },
      { x: 150, y: 180 },
    );
  b.nodes = [n, g];
  return { b, g, n };
}

describe("Маски перекраски", () => {
  it("не соединяет раздельные области одинакового цвета", () => {
    const p = new Uint8ClampedArray([
      100, 100, 100, 255, 0, 0, 0, 255, 100, 100, 100, 255,
    ]);
    expect([...floodMask(p, 3, 1, 0, 0, 0)]).toEqual([255, 0, 0]);
  });
  it("прозрачность не превращается в окрашенную область", () => {
    const p = new Uint8ClampedArray([10, 10, 10, 0, 10, 10, 10, 255]);
    expect([...floodMask(p, 2, 1, 0, 0, 100)]).toEqual([0, 0]);
    expect([...floodMask(p, 2, 1, 1, 0, 100)]).toEqual([0, 255]);
  });
  it("допуск расширяет выбор соседних оттенков", () => {
    const p = new Uint8ClampedArray([100, 100, 100, 255, 110, 110, 110, 255]);
    expect([...floodMask(p, 2, 1, 0, 0, 5)]).toEqual([255, 0]);
    expect([...floodMask(p, 2, 1, 0, 0, 12)]).toEqual([255, 255]);
  });
  it("быстрое движение кисти не оставляет разрывов", () => {
    const m = new Uint8Array(30 * 10);
    brushLine(m, 30, 10, { x: 2, y: 5 }, { x: 27, y: 5 }, 4);
    expect(
      Array.from({ length: 26 }, (_, i) => m[5 * 30 + i + 2]).every(
        (v) => v === 255,
      ),
    ).toBe(true);
  });
  it("ластик вычитает участок, сохраняя остальные пиксели", () => {
    const m = new Uint8Array(100).fill(255);
    brushLine(m, 10, 10, { x: 5, y: 5 }, { x: 5, y: 5 }, 4, true);
    expect(m[55]).toBe(0);
    expect(m[0]).toBe(255);
  });
  it("растушёвка смягчает границу и не меняет исходную маску", () => {
    const m = new Uint8Array([0, 0, 255, 0, 0]),
      f = featherMask(m, 5, 1, 1);
    expect([...m]).toEqual([0, 0, 255, 0, 0]);
    expect(f[1]).toBeGreaterThan(0);
    expect(f[2]).toBeLessThan(255);
    expect([
      ...mergeSelection(m, new Uint8Array([255, 0, 255, 0, 0]), "subtract"),
    ]).toEqual([0, 0, 0, 0, 0]);
  });
});
describe("Доска: группы и связи", () => {
  it("привязывает карточку к созданной отдельно группе без скачка", () => {
    const { b, g, n } = grouped(),
      next = dropIntoGroups(b, [n.id]),
      child = next.nodes.find((x) => x.id === n.id)!;
    expect(child.parentId).toBe(g.id);
    expect(absolutePosition(child, next.nodes)).toEqual(n.position);
    expect(next.nodes[0].id).toBe(g.id);
  });
  it("отсоединяет вынесенную карточку, сохраняя мировую позицию", () => {
    const { b, n } = grouped();
    const next = dropIntoGroups(b, [n.id]),
      child = next.nodes.find((x) => x.id === n.id)!;
    child.position = { x: 800, y: 50 };
    const world = absolutePosition(child, next.nodes),
      out = dropIntoGroups(next, [n.id]).nodes.find((x) => x.id === n.id)!;
    expect(out.parentId).toBeUndefined();
    expect(out.position).toEqual(world);
  });
  it("движение группы не перепривязывает ребёнка", () => {
    const { b, g, n } = grouped(),
      next = dropIntoGroups(b, [n.id]);
    next.nodes.find((x) => x.id === g.id)!.position.x = 900;
    const child = next.nodes.find((x) => x.id === n.id)!;
    expect(
      dropIntoGroups(next, [g.id, n.id]).nodes.find((x) => x.id === n.id),
    ).toEqual(child);
  });
  it("меняет направление выбранной связи и удаляет только её", () => {
    const { b, g, n } = grouped();
    b.edges = [
      { id: "e1", source: g.id, target: n.id, selected: true },
      { id: "e2", source: n.id, target: g.id },
    ];
    const next = setEdgeDirection(b, ["e1"], "reverse");
    expect(next.edges[0].data?.direction).toBe("reverse");
    expect(b.edges[0].data).toBeUndefined();
    expect(deleteSelection(next).edges.map((e) => e.id)).toEqual(["e2"]);
    expect(deleteSelection(next).nodes).toHaveLength(2);
  });
  it("копирует перекраску с независимыми настройками слоя", () => {
    const b = emptyBoard(uid()),
      { doc } = painting(b.projectId),
      n = createNode({ kind: "paint", title: "Окраска", document: doc });
    b.nodes = [n];
    const next = duplicateNodes(b, [n.id]),
      copy = next.nodes.find((x) => x.id !== n.id)!;
    if (copy.data.kind !== "paint") throw new Error("not paint");
    expect(copy.data.document.id).not.toBe(doc.id);
    copy.data.document.layers[0].color = "#ffffff";
    expect(doc.layers[0].color).toBe("#2468ac");
    expect(copy.data.document.sourceAssetId).toBe(doc.sourceAssetId);
  });
});
describe("Инвентаризация", () => {
  it("сверяет физический остаток без изменения резерва", () => {
    const { s, m, p, printer } = fixture();
    start(s, p.id, 1, printer.id);
    applyStocktake(s, [
      {
        materialId: m.id,
        physical: 250,
        expectedPhysical: 300,
        method: "Взвешено",
      },
    ]);
    expect(stock(s, m.id)).toMatchObject({
      physical: 250,
      reserved: 200,
      available: 50,
    });
  });
  it("не применяет ни одной строки при конфликте остатка", () => {
    const { s, m } = fixture();
    const other = { ...m, id: uid() };
    s.materials.push(other);
    movement(s, other.id, "receipt", 10, "measured");
    const before = structuredClone(s);
    expect(() =>
      applyStocktake(s, [
        {
          materialId: m.id,
          physical: 240,
          expectedPhysical: 300,
          method: "Взвешено",
        },
        {
          materialId: other.id,
          physical: 8,
          expectedPhysical: 9,
          method: "Взвешено",
        },
      ]),
    ).toThrow();
    expect(s).toEqual(before);
  });
  it("частичная сверка не снимает напоминание о полной", () => {
    const { s, m } = fixture();
    s.materials.push({ ...m, id: uid() });
    s.settings.inventoryAt = "2025-01-01";
    expect(
      applyStocktake(s, [
        {
          materialId: m.id,
          physical: 300,
          expectedPhysical: 300,
          method: "Проверено",
        },
      ]).full,
    ).toBe(false);
    expect(s.settings.inventoryAt).toBe("2025-01-01");
  });
  it("полная сверка фиксирует дату и снимает отсрочку", () => {
    const { s, m } = fixture();
    s.settings.snoozeUntil = "2099-01-01";
    expect(
      applyStocktake(s, [
        {
          materialId: m.id,
          physical: 300,
          expectedPhysical: 300,
          method: "Проверено",
        },
      ]).full,
    ).toBe(true);
    expect(s.settings.inventoryAt).toBeTruthy();
    expect(s.settings.snoozeUntil).toBe("");
  });
  it("не допускает отрицательные, NaN и дублированные строки", () => {
    const { s, m } = fixture(),
      c = {
        materialId: m.id,
        physical: 100,
        expectedPhysical: 300,
        method: "Проверено",
      };
    const before = structuredClone(s);
    for (const physical of [-1, NaN, Infinity])
      expect(() => applyStocktake(s, [{ ...c, physical }])).toThrow();
    expect(() => applyStocktake(s, [c, c])).toThrow();
    expect(s).toEqual(before);
  });
});
describe("Вложения и схема 3", () => {
  it("сохраняет заметку только с фото и защищает используемый файл", async () => {
    const { s, p } = fixture();
    await replaceAll(s, []);
    const a = photo(p.id, "note");
    await mutateWithAssets(
      (s) => saveNote(s, "project", p.id, "", undefined, "internal", [a.id]),
      [a],
    );
    const v = await snapshot();
    expect(v.state.projectNotes[0].attachmentIds).toEqual([a.id]);
    await expect(removeAsset(a.id)).rejects.toThrow();
  });
  it("откатывает файл и заметку при ссылке на чужой проект", async () => {
    const { s, p } = fixture();
    await replaceAll(s, []);
    const a = photo(uid(), "note");
    await expect(
      mutateWithAssets(
        (s) =>
          saveNote(s, "project", p.id, "Фото", undefined, "internal", [a.id]),
        [a],
      ),
    ).rejects.toThrow();
    expect((await snapshot()).state.projectNotes).toHaveLength(0);
    expect(await db.assets.count()).toBe(0);
  });
  it("переносит слои и вложения через ZIP и копию проекта", async () => {
    const { s, p } = fixture(),
      { doc, source, mask, preview } = painting(p.id);
    const b = emptyBoard(p.id);
    b.nodes = [createNode({ kind: "paint", title: "Куртка", document: doc })];
    s.boards = [b];
    saveNote(s, "project", p.id, "Фото", undefined, "internal", [source.id]);
    const decoded = decodeBackup(
      await encodeBackup(s, [source, mask, preview]),
    );
    await replaceAll(decoded.state, decoded.assets);
    const id = await copyProject(p.id),
      next = await snapshot(),
      copy = next.state.boards.find((b) => b.projectId === id)!.nodes[0];
    if (copy.data.kind !== "paint") throw new Error("not paint");
    expect(copy.data.document.sourceAssetId).not.toBe(source.id);
    expect(copy.data.document.layers[0].maskAssetId).not.toBe(mask.id);
    expect(
      next.state.projectNotes.find((n) => n.projectId === id)!.attachmentIds,
    ).toEqual([copy.data.document.sourceAssetId]);
    expect(
      await next.assets
        .find((a) => a.id === copy.data.document.layers[0].maskAssetId)!
        .blob.text(),
    ).toBe("original");
  });
  it("поднимает схему 2 без изменения остатков и записей", () => {
    const { s } = fixture();
    const old = { ...structuredClone(s), schemaVersion: 2 };
    const next = migrateState(old, []);
    expect(next.schemaVersion).toBe(3);
    expect(next.movements).toEqual(s.movements);
    expect(old.schemaVersion).toBe(2);
    expect(migrateState(next, [])).toEqual(next);
  });
});
