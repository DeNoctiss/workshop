import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { fixture } from "./fixture";
import { uid, type Asset } from "../src/domain/model";
import {
  migrateState,
  emptyBoard,
  serializableNodes,
} from "../src/domain/migrations";
import { validate } from "../src/domain/validation";
import {
  validateProduct,
  validateBoardAssets,
} from "../src/domain/workspaceValidation";
import { saveNote, addRunTask, updateCustomer } from "../src/domain/workflow";
import { safeUrl } from "../src/domain/workspace";
import { start } from "../src/domain/engine";
import {
  db,
  readState,
  replaceAll,
  mutate,
  saveBoard,
  snapshot,
  removeAsset,
  copyProject,
} from "../src/data/db";
import { encodeBackup, decodeBackup } from "../src/data/backup";
import {
  builtinProducts,
  matchesProduct,
  newMaterial,
  newProduct,
  productReference,
} from "../src/catalog/catalog";
import {
  createNode,
  absolutePosition,
  groupNodes,
  ungroupNodes,
  duplicateNodes,
  deleteNodes,
} from "../src/board/operations";

function legacy(s: ReturnType<typeof fixture>["s"]) {
  const { userProducts, projectNotes, runNotes, runTasks, boards, ...old } =
    structuredClone(s);
  return { ...old, schemaVersion: 1 };
}
function photo(projectId: string): Asset {
  return {
    id: uid(),
    projectId,
    group: "main",
    caption: "Референс",
    order: 0,
    cover: false,
    blob: new Blob(["original"], { type: "image/png" }),
    thumb: new Blob(["preview"], { type: "image/webp" }),
  };
}
beforeEach(async () => {
  await db.open();
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    await db.states.clear();
    await db.assets.clear();
    await db.assetIndex.clear();
  });
});

describe("совместимость и миграция", () => {
  it("переносит заметки и фото без изменения журнала и снимков", () => {
    const { s, p, printer } = fixture();
    p.notes = "Старое описание";
    start(s, p.id, 1, printer.id);
    const old = legacy(s),
      a = photo(p.id);
    const next = migrateState(old, [a]);
    validate(next);
    validateBoardAssets(next, [a]);
    expect(next.movements).toEqual(old.movements);
    expect(next.runs).toEqual(old.runs);
    expect(next.projects).toEqual(old.projects);
    expect(next.projectNotes[0].text).toBe(p.notes);
    expect(
      next.boards[0].nodes.filter((n) => n.data.kind === "image"),
    ).toHaveLength(1);
    expect(migrateState(next, [a])).toEqual(next);
    expect(old.schemaVersion).toBe(1);
  });
  it("обновляет настоящую Dexie v1 до v3 и сохраняет оригинал", async () => {
    const { s, p } = fixture();
    p.notes = "Заметка v1";
    const a = photo(p.id);
    db.close();
    await Dexie.delete("masterskaya-v1");
    const old = new Dexie("masterskaya-v1");
    old.version(1).stores({ states: "key", assets: "id,projectId" });
    await old.table("states").put({ ...legacy(s), key: "main" });
    await old.table("assets").put(a);
    old.close();
    await db.open();
    const next = await readState();
    expect(next.schemaVersion).toBe(3);
    expect(next.projectNotes).toHaveLength(1);
    expect(await db.assetIndex.count()).toBe(1);
    expect(await (await db.assets.get(a.id))!.blob.text()).toBe("original");
    db.close();
    await db.open();
    expect((await readState()).boards).toEqual(next.boards);
  });
  it("читает старый ZIP и отклоняет неизвестную схему", () => {
    const { s, p } = fixture();
    p.notes = "Сохранённая заметка";
    const zip = (state: unknown) =>
      zipSync({
        "manifest.json": strToU8(
          JSON.stringify({ format: "masterskaya", version: 1, images: 0 }),
        ),
        "data.json": strToU8(JSON.stringify({ state, assets: [] })),
      });
    expect(decodeBackup(zip(legacy(s))).state.projectNotes).toHaveLength(1);
    expect(() =>
      decodeBackup(zip({ ...legacy(s), schemaVersion: 9 })),
    ).toThrow();
  });
});
describe("задачи, заметки, каталог", () => {
  it("изолирует данные запуска от другого запуска, склада и цены", () => {
    const { s, p, printer } = fixture();
    const a = start(s, p.id, 1, printer.id);
    const before = structuredClone({
      movements: s.movements,
      recipe: a.recipe,
      lines: a.lines,
      cost: a.cost,
    });
    const second = { ...structuredClone(a), id: uid() };
    s.runs.push(second);
    updateCustomer(s, a.id, {
      name: " А ",
      chatUrl: "https://example.com/chat",
      requests: "Матовый лак",
    });
    saveNote(s, "run", a.id, "Проверить цвет", undefined, "customer_reported");
    addRunTask(s, a.id, "Тестовый выкрас", s.runNotes[0].id);
    saveNote(s, "project", p.id, "Общая заметка");
    expect(second.customer).toBeUndefined();
    expect(s.runTasks.every((t) => t.runId === a.id)).toBe(true);
    expect(s.runNotes.every((n) => n.runId === a.id)).toBe(true);
    expect({
      movements: s.movements,
      recipe: a.recipe,
      lines: a.lines,
      cost: a.cost,
    }).toEqual(before);
  });
  it("отклоняет пустые заметки, задачи и опасные ссылки", () => {
    const { s } = fixture();
    expect(() => saveNote(s, "project", "missing", " ")).toThrow();
    expect(() => addRunTask(s, "missing", " ")).toThrow();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://user:password@example.com")).toBeNull();
    expect(safeUrl("https://example.com/chat")).toBe(
      "https://example.com/chat",
    );
  });
  it("не связывает задачу с заметкой другого производства", () => {
    const { s, p, printer } = fixture();
    const run = start(s, p.id, 1, printer.id);
    saveNote(s, "run", run.id, "Пожелание");
    const n = s.runNotes[0];
    addRunTask(s, run.id, "Задача", n.id);
    validate(s);
    n.runId = uid();
    expect(() => validate(s)).toThrow();
  });
  it("проверяет весь встроенный каталог, уникальность и стартовые категории", () => {
    expect(builtinProducts.length).toBeGreaterThanOrEqual(81);
    expect(new Set(builtinProducts.map((p) => p.id)).size).toBe(
      builtinProducts.length,
    );
    const categories = new Set(builtinProducts.map((p) => p.category));
    for (const category of [
      "paint",
      "filament",
      "resin",
      "primer",
      "varnish",
    ] as const)
      expect(categories.has(category)).toBe(true);
    builtinProducts.forEach((p) => {
      validateProduct(p);
      expect(p.urls.length).toBeGreaterThan(0);
      expect(p.license).not.toBe("");
    });
  });
  it("ищет артикул с точкой или без и сочетание слов", () => {
    const p = builtinProducts.find((p) => p.sku === "70.602")!;
    expect(matchesProduct(p, "70602")).toBe(true);
    expect(matchesProduct(p, "Vallejo 70.602")).toBe(true);
    expect(matchesProduct(p, "красный 70602")).toBe(false);
  });
  it("сохраняет снимок и не выдумывает цену, цвет и упаковку", () => {
    const p = newProduct();
    p.name = "Свой лак";
    p.category = "varnish";
    p.properties = { kind: "varnish", transparent: true };
    validateProduct(p);
    const m = newMaterial(p),
      ref = productReference(p);
    expect(m.packageQty).toBe(0);
    expect(m.packageCost).toBe(0);
    expect(m.colorEnabled).toBe(false);
    p.name = "Переименован";
    expect(m.productSnapshot!.name).toBe("Свой лак");
    expect(ref.snapshot.label).toBe("Свой лак");
  });
});
describe("доска и файлы", () => {
  it("сохраняет абсолютные координаты при группировке и разгруппировке", () => {
    const b = emptyBoard(uid()),
      a = createNode(
        { kind: "note", title: "A", text: "A" },
        { x: 100, y: 140 },
      ),
      c = createNode(
        { kind: "note", title: "B", text: "B" },
        { x: 500, y: 400 },
      );
    b.nodes = [a, c];
    const grouped = groupNodes(b, [a.id, c.id]);
    for (const n of grouped.nodes.filter((n) => n.data.kind !== "group"))
      expect(absolutePosition(n, grouped.nodes)).toEqual(
        b.nodes.find((x) => x.id === n.id)!.position,
      );
    const restored = ungroupNodes(grouped, [grouped.nodes[0].id]);
    expect(restored.nodes.map((n) => n.position)).toEqual(
      b.nodes.map((n) => n.position),
    );
  });
  it("копирует группу со связями и удаляет только выбранную группу", () => {
    const b = emptyBoard(uid()),
      a = createNode({ kind: "note", title: "A", text: "A" }),
      c = createNode({ kind: "note", title: "B", text: "B" });
    b.nodes = [a, c];
    b.edges = [{ id: uid(), source: a.id, target: c.id }];
    const grouped = groupNodes(b, [a.id, c.id]);
    const copy = duplicateNodes(grouped, [grouped.nodes[0].id]);
    expect(copy.nodes).toHaveLength(6);
    expect(copy.edges).toHaveLength(2);
    expect(new Set(copy.nodes.map((n) => n.id)).size).toBe(6);
    const deleted = deleteNodes(copy, [grouped.nodes[0].id]);
    expect(deleted.nodes).toHaveLength(3);
    expect(deleted.edges).toHaveLength(1);
  });
  it("сериализует размеры, убирая transient-поля React Flow", () => {
    const node = {
      ...createNode({ kind: "note", title: "A", text: "B" }),
      selected: true,
      dragging: true,
      measured: { width: 700, height: 500 },
      style: { width: 420, height: 320 },
    };
    const saved = serializableNodes([node])[0];
    expect(saved.style).toEqual({ width: 420, height: 320 });
    expect(saved).not.toHaveProperty("selected");
    expect(saved).not.toHaveProperty("dragging");
    expect(saved).not.toHaveProperty("measured");
  });
  it("сохраняет доску после изменения склада, но отвергает устаревшую доску", async () => {
    const { s, p } = fixture();
    await replaceAll(s, []);
    const b = emptyBoard(p.id);
    b.nodes = [createNode({ kind: "note", title: "A", text: "B" })];
    await mutate((s) => {
      s.materials[0].notes = "Изменено отдельно";
    });
    const saved = await saveBoard(b, 0);
    await expect(saveBoard(b, 0)).rejects.toThrow("другой вкладке");
    expect((await readState()).boards[0].revision).toBe(saved.revision);
  });
  it("откатывает запись доски с отсутствующим изображением", async () => {
    const { s, p } = fixture();
    await replaceAll(s, []);
    const before = await readState(),
      b = emptyBoard(p.id);
    b.nodes = [
      createNode({ kind: "image", title: "Нет файла", assetId: uid() }),
    ];
    await expect(saveBoard(b, 0)).rejects.toThrow();
    expect(await readState()).toEqual(before);
  });
  it("отклоняет чужое изображение и вторую доску проекта", () => {
    const { s, p } = fixture(),
      a = photo(uid()),
      b = emptyBoard(p.id);
    b.nodes = [
      createNode({ kind: "image", title: "Чужое фото", assetId: a.id }),
    ];
    s.boards = [b];
    expect(() => validateBoardAssets(s, [a])).toThrow();
    s.boards = [emptyBoard(p.id), { ...emptyBoard(p.id), id: uid() }];
    expect(() => validate(s)).toThrow();
  });
  it("переносит новые сущности и бинарные оригиналы через ZIP без дублей", async () => {
    const { s, p, printer } = fixture();
    const run = start(s, p.id, 1, printer.id),
      a = photo(p.id),
      b = emptyBoard(p.id);
    b.nodes = [createNode({ kind: "image", title: "Оригинал", assetId: a.id })];
    s.boards = [b];
    const product = newProduct();
    product.name = "Своя краска";
    s.userProducts = [product];
    saveNote(s, "project", p.id, "Проект");
    saveNote(s, "run", run.id, "Запуск");
    addRunTask(s, run.id, "Сделать");
    updateCustomer(s, run.id, {
      name: "Тест",
      chatUrl: "",
      requests: "Матовый",
    });
    const decoded = decodeBackup(await encodeBackup(s, [a]));
    await replaceAll(decoded.state, decoded.assets);
    await replaceAll(decoded.state, decoded.assets);
    const result = await snapshot();
    expect(result.state.projectNotes).toHaveLength(1);
    expect(result.state.runNotes).toHaveLength(1);
    expect(result.state.runTasks).toHaveLength(1);
    expect(result.state.userProducts).toHaveLength(1);
    expect(result.state.boards).toHaveLength(1);
    expect(result.state.runs[0].customer!.name).toBe("Тест");
    expect(await result.assets[0].blob.text()).toBe("original");
  });
  it("повреждённый импорт не изменяет действующую базу", async () => {
    const { s, p } = fixture();
    saveNote(s, "project", p.id, "Не потерять");
    await replaceAll(s, []);
    const before = await readState();
    expect(() => decodeBackup(new Uint8Array([1, 2, 3]))).toThrow();
    await expect(
      replaceAll({ ...s, boards: [emptyBoard("missing")] }, []),
    ).rejects.toThrow();
    expect(await readState()).toEqual(before);
  });
  it("защищает используемое фото, удаление узла не удаляет Blob", async () => {
    const { s, p } = fixture(),
      a = photo(p.id),
      b = emptyBoard(p.id);
    b.nodes = [createNode({ kind: "image", title: "Фото", assetId: a.id })];
    s.boards = [b];
    await replaceAll(s, [a]);
    await expect(removeAsset(a.id)).rejects.toThrow();
    const saved = (await readState()).boards[0];
    await saveBoard({ ...saved, nodes: [] }, saved.revision);
    expect(await db.assets.get(a.id)).toBeDefined();
    await removeAsset(a.id);
    expect(await db.assets.get(a.id)).toBeUndefined();
  });
  it("копирует проект с независимыми файлами, заметками и доской", async () => {
    const { s, p } = fixture(),
      a = photo(p.id),
      b = emptyBoard(p.id);
    b.nodes = [createNode({ kind: "image", title: "Фото", assetId: a.id })];
    s.boards = [b];
    saveNote(s, "project", p.id, "Заметка");
    await replaceAll(s, [a]);
    const id = await copyProject(p.id),
      result = await snapshot(),
      copy = result.state.boards.find((b) => b.projectId === id)!;
    expect(
      result.state.projectNotes.find((n) => n.projectId === id)!.id,
    ).not.toBe(s.projectNotes[0].id);
    expect(
      copy.nodes[0].data.kind === "image" && copy.nodes[0].data.assetId,
    ).not.toBe(a.id);
    expect(result.assets.filter((a) => a.projectId === id)).toHaveLength(1);
    expect(result.state.runs).toHaveLength(0);
  });
  it("восстановление архива блокирует сохранение старой открытой доски", async () => {
    const { s, p } = fixture();
    s.boards = [emptyBoard(p.id)];
    await replaceAll(s, []);
    const open = (await readState()).boards[0];
    await replaceAll(s, []);
    expect((await readState()).boards[0].revision).toBeGreaterThan(
      open.revision,
    );
    await expect(saveBoard(open, open.revision)).rejects.toThrow(
      "другой вкладке",
    );
  });
});
