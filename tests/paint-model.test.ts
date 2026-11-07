import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import { demoState } from "../src/data/demo";
import { uid, type Asset } from "../src/domain/model";
import { emptyBoard } from "../src/domain/migrations";
import { createNode } from "../src/board/operations";
import {
  copyProject,
  db,
  readState,
  replaceAll,
  saveBoard,
  snapshot,
} from "../src/data/db";
import { decodeBackup, encodeBackup } from "../src/data/backup";
import {
  newProduct,
  productReference,
  stockReference,
} from "../src/catalog/catalog";
import type { PaintData } from "../src/paint/usePaintSave";
import { PaintSession, blendLabels } from "../src/paint/core/PaintSession";
import {
  combine,
  combineStrokeRegion,
  hasSelection,
  paintStroke,
  paintStrokeRegion,
  strokeCoverage,
  type SelectionMode,
} from "../src/paint/core/selection";

describe("маска и кисть слоя", () => {
  it("пустое после вычитания выделение не блокирует кисть", () => {
    const selected = new Uint8Array([255, 0, 0]);
    const empty = combine(selected, selected, "subtract");
    expect(hasSelection(empty)).toBe(false);
    expect([
      ...paintStroke(
        new Uint8Array(3),
        new Uint8Array([255, 0, 0]),
        1,
        false,
        empty,
      ),
    ]).toEqual([255, 0, 0]);
    expect([
      ...paintStroke(
        new Uint8Array(3),
        new Uint8Array([255, 0, 0]),
        1,
        false,
        new Uint8Array([0, 255, 0]),
      ),
    ]).toEqual([0, 0, 0]);
  });

  it("обновление области мазка совпадает с полным расчётом, включая ластик и мягкий край", () => {
    const w = 48,
      h = 32;
    const original = Uint8Array.from({ length: w * h }, (_, i) => i % 201);
    const initial = original.slice();
    const selection = Uint8Array.from({ length: w * h }, (_, i) =>
      i % 4 ? 0 : 170,
    );
    const segments = [
      [
        { x: 4, y: 6 },
        { x: 14, y: 8 },
      ],
      [
        { x: 14, y: 8 },
        { x: 29, y: 20 },
      ],
    ] as const;
    for (const erase of [false, true]) {
      const coverage = new Uint8Array(w * h),
        target = original.slice();
      for (const [from, to] of segments) {
        const rect = strokeCoverage(coverage, w, h, from, to, 9, 0.45);
        paintStrokeRegion(
          original,
          target,
          coverage,
          0.6,
          erase,
          selection,
          w,
          rect,
        );
        expect(target).toEqual(
          paintStroke(original, coverage, 0.6, erase, selection),
        );
      }
    }
    expect(original).toEqual(initial);
  });

  it("областной расчёт добавления, вычитания и пересечения равен полной маске", () => {
    const w = 30,
      h = 20;
    const original = Uint8Array.from({ length: w * h }, (_, i) =>
      i % 3 ? 0 : 180,
    );
    const initial = original.slice();
    for (const mode of [
      "replace",
      "add",
      "subtract",
      "intersect",
    ] as SelectionMode[]) {
      const coverage = new Uint8Array(w * h);
      const target =
        mode === "add" || mode === "subtract"
          ? original.slice()
          : new Uint8Array(w * h);
      for (const [from, to] of [
        [
          { x: 3, y: 4 },
          { x: 12, y: 7 },
        ],
        [
          { x: 12, y: 7 },
          { x: 24, y: 13 },
        ],
      ] as const) {
        const rect = strokeCoverage(coverage, w, h, from, to, 6, 0.8);
        combineStrokeRegion(original, coverage, target, mode, w, rect);
        expect(target).toEqual(combine(original, coverage, mode));
      }
    }
    expect(original).toEqual(initial);
  });
});

describe("слои и история", () => {
  it("выключение и undo/redo не изменяют соседнюю маску", () => {
    const session = new PaintSession(2, 1);
    session.change({ ...session.frame, selection: new Uint8Array([255, 0]) });
    session.addLayer("#e5b693");
    const first = session.active!;
    session.change({ ...session.frame, selection: new Uint8Array([0, 255]) });
    session.addLayer("#0077cc");
    const second = session.active!;
    session.patch(second.id, {
      visible: false,
      opacity: 0.4,
      color: "#ff2200",
    });
    expect(session.active?.visible).toBe(false);
    session.undo();
    expect(session.active?.visible).toBe(true);
    session.undo(true);
    expect(session.active?.color).toBe("#ff2200");
    expect(session.frame.layers.find((l) => l.id === first.id)?.mask).toEqual(
      new Uint8Array([255, 0]),
    );
    expect(second.mask).toEqual(new Uint8Array([0, 255]));
    expect(blendLabels["source-over"].label).toBe("Точный HEX");
    expect(blendLabels.color.label).toBe("Светотень");
  });

  it("пустой цвет личного товара не выдаётся за измеренный серый", () => {
    const custom = newProduct();
    custom.colorHex = "";
    expect(productReference(custom).snapshot.colorHex).toBeUndefined();
    const stock = demoState().materials.find((m) => m.code === "70.955");
    expect(stock?.color).toBe("#e5b693");
    expect(stockReference(stock!).snapshot.colorHex).toBe("#e5b693");
  });
});

describe("существующий PaintDocument в IndexedDB", () => {
  beforeEach(async () => {
    await db.open();
    await db.transaction(
      "rw",
      db.states,
      db.assets,
      db.assetIndex,
      async () => {
        await db.states.clear();
        await db.assets.clear();
        await db.assetIndex.clear();
      },
    );
  });

  it("сохраняет новую карточку с исходником до создания превью и переносит её через ZIP и копию проекта", async () => {
    const { s, p } = fixture();
    await replaceAll(s, []);
    const source: Asset = {
      id: uid(),
      projectId: p.id,
      group: "process",
      caption: "Исходное фото",
      order: 0,
      cover: false,
      blob: new Blob(["original"], { type: "image/jpeg" }),
      thumb: new Blob(["thumb"], { type: "image/jpeg" }),
    };
    const paint: PaintData = {
      kind: "paint",
      title: "Вариант окраски",
      document: {
        id: uid(),
        schemaVersion: 2,
        sourceAssetId: source.id,
        previewAssetId: "",
        width: 2,
        height: 1,
        layers: [],
        updatedAt: new Date().toISOString(),
      },
    };
    const board = emptyBoard(p.id);
    board.nodes = [createNode(paint)];
    await saveBoard(board, 0, [source]);
    db.close();
    await db.open();
    expect((await readState()).boards[0].nodes[0].data).toEqual(paint);

    const exported = await snapshot();
    const imported = decodeBackup(
      await encodeBackup(exported.state, exported.assets),
    );
    await replaceAll(imported.state, imported.assets);
    expect((await readState()).boards[0].nodes[0].data).toEqual(paint);
    expect(await (await db.assets.get(source.id))!.blob.text()).toBe(
      "original",
    );

    const copiedProjectId = await copyProject(p.id);
    const copy = (await readState()).boards.find(
      (item) => item.projectId === copiedProjectId,
    )!.nodes[0].data;
    if (copy.kind !== "paint") throw new Error("Нет копии PaintNode");
    expect(copy.document.id).not.toBe(paint.document.id);
    expect(copy.document.previewAssetId).toBe("");
    expect(copy.document.sourceAssetId).not.toBe(source.id);
    expect(
      await (await db.assets.get(copy.document.sourceAssetId))!.blob.text(),
    ).toBe("original");
  });

  it("читает старую версию с независимыми исходником и масками после закрытия базы", async () => {
    const { s, p } = fixture();
    await replaceAll(s, []);
    const asset = (purpose: Asset["purpose"], value: string): Asset => ({
      id: uid(),
      projectId: p.id,
      group: "process",
      caption: value,
      order: 0,
      cover: false,
      purpose,
      blob: new Blob([value], { type: "image/png" }),
      thumb: new Blob([value], { type: "image/png" }),
    });
    const source = asset(undefined, "immutable-original");
    const preview = asset("paint-preview", "preview");
    const firstMask = asset("paint-mask", "mask-one");
    const secondMask = asset("paint-mask", "mask-two");
    const paint: PaintData = {
      kind: "paint",
      title: "Старый вариант",
      document: {
        schemaVersion: 1,
        id: uid(),
        sourceAssetId: source.id,
        previewAssetId: preview.id,
        width: 2,
        height: 1,
        updatedAt: new Date().toISOString(),
        layers: [
          {
            id: uid(),
            name: "Первый",
            maskAssetId: firstMask.id,
            color: "#e5b693",
            opacity: 1,
            visible: true,
            blend: "source-over",
          },
          {
            id: uid(),
            name: "Второй",
            maskAssetId: secondMask.id,
            color: "#0077cc",
            opacity: 0.4,
            visible: false,
            blend: "color",
          },
        ],
      },
    };
    const board = emptyBoard(p.id);
    board.nodes = [createNode(paint)];
    await saveBoard(board, 0, [source, preview, firstMask, secondMask]);
    db.close();
    await db.open();
    const stored = (await readState()).boards[0].nodes[0].data;
    expect(stored).toEqual(paint);
    expect(await (await db.assets.get(source.id))!.blob.text()).toBe(
      "immutable-original",
    );
    expect(await (await db.assets.get(firstMask.id))!.blob.text()).toBe(
      "mask-one",
    );
    expect(await (await db.assets.get(secondMask.id))!.blob.text()).toBe(
      "mask-two",
    );
    const exported = await snapshot();
    const imported = decodeBackup(
      await encodeBackup(exported.state, exported.assets),
    );
    await replaceAll(imported.state, imported.assets);
    const restored = (await readState()).boards[0].nodes[0].data;
    expect(restored).toEqual(paint);
    expect(await (await db.assets.get(source.id))!.blob.text()).toBe(
      "immutable-original",
    );
    expect(await (await db.assets.get(firstMask.id))!.blob.text()).toBe(
      "mask-one",
    );
    expect(await (await db.assets.get(secondMask.id))!.blob.text()).toBe(
      "mask-two",
    );
    const copiedProjectId = await copyProject(p.id);
    const copiedNode = (await readState()).boards.find(
      (b) => b.projectId === copiedProjectId,
    )!.nodes[0].data;
    if (copiedNode.kind !== "paint") throw new Error("Нет копии PaintNode");
    expect(copiedNode.document.id).not.toBe(paint.document.id);
    expect(copiedNode.document.sourceAssetId).not.toBe(source.id);
    expect(copiedNode.document.layers[0].maskAssetId).not.toBe(firstMask.id);
    expect(
      await (await db.assets.get(
        copiedNode.document.layers[0].maskAssetId,
      ))!.blob.text(),
    ).toBe("mask-one");
  });
});
