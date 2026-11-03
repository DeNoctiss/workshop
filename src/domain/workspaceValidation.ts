import { categories, units, type State, type AssetMeta } from "./model";
import { safeUrl, type CatalogProduct } from "./workspace";
function ok(yes: unknown, msg: string): asserts yes {
  if (!yes) throw new Error("Проверка данных: " + msg);
}
function text(v: unknown, name: string, required = false) {
  ok(
    typeof v === "string" && v.length <= 100000 && (!required || v.trim()),
    name,
  );
}
function num(v: unknown, name: string, min = -1e7, max = 1e7) {
  ok(typeof v === "number" && Number.isFinite(v) && v >= min && v <= max, name);
}
function list(v: unknown, name: string): asserts v is any[] {
  ok(Array.isArray(v) && v.length <= 50000, name);
}
function ids(v: unknown, name: string): asserts v is any[] {
  list(v, name);
  const seen = new Set();
  for (const x of v) {
    ok(
      x &&
        typeof x === "object" &&
        /^[a-z0-9-]{1,100}$/i.test(x.id) &&
        !seen.has(x.id),
      "ID " + name,
    );
    seen.add(x.id);
  }
}
const hex = (v: unknown) =>
  ok(typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v), "цвет #RRGGBB");
export function validateProduct(p: any): asserts p is CatalogProduct {
  ok(p && typeof p === "object", "товар");
  ok(/^[a-z0-9-]{1,100}$/i.test(p.id), "ID товара");
  ok(["builtin", "user"].includes(p.source), "источник товара");
  ok(Object.hasOwn(categories, p.category), "категория товара");
  text(p.name, "название товара", true);
  for (const k of [
    "brand",
    "series",
    "sku",
    "checkedAt",
    "datasetVersion",
    "license",
  ])
    text(p[k], k);
  list(p.aliases, "названия товара");
  p.aliases.forEach((x: any) => text(x, "название"));
  list(p.urls, "ссылки");
  p.urls.forEach((u: any) => ok(safeUrl(u), "ссылка товара"));
  if (p.colorHex !== undefined) hex(p.colorHex);
  if (p.colorName !== undefined) text(p.colorName, "цвет");
  if (p.discontinued !== undefined)
    ok(typeof p.discontinued === "boolean", "снятие с производства");
  ids(p.packages, "упаковки");
  for (const x of p.packages) {
    text(x.label, "упаковка");
    num(x.qty, "объём", 0.001);
    ok(Object.hasOwn(units, x.unit), "единица");
  }
  ok(p.properties && p.properties.kind === p.category, "свойства категории");
  for (const [k, v] of Object.entries(p.properties)) {
    if (["diameter", "density", "wavelength"].includes(k)) num(v, k, 0.001);
    else if (["nozzleMin", "nozzleMax", "bedMin", "bedMax"].includes(k))
      num(v, k, 0, 500);
    else if (k === "transparent") ok(typeof v === "boolean", k);
    else text(v, k);
  }
}
function ref(r: any, s: State) {
  ok(r?.snapshot, "снимок материала");
  text(r.snapshot.label, "название материала", true);
  if (r.snapshot.colorHex !== undefined) hex(r.snapshot.colorHex);
  if (r.snapshot.sku !== undefined) text(r.snapshot.sku, "артикул");
  if (r.productId !== undefined) text(r.productId, "товар", true);
  if (r.inventoryMaterialId)
    ok(
      s.materials.some((m) => m.id === r.inventoryMaterialId),
      "ссылка на склад",
    );
  if (r.comment !== undefined) text(r.comment, "комментарий");
}
export function validateWorkspace(s: State) {
  for (const [k, v] of Object.entries({
    userProducts: s.userProducts,
    projectNotes: s.projectNotes,
    runNotes: s.runNotes,
    runTasks: s.runTasks,
    boards: s.boards,
  }))
    ids(v, k);
  s.userProducts.forEach((p) => {
    validateProduct(p);
    ok(p.source === "user", "личный товар");
  });
  for (const m of s.materials) {
    if (m.productSnapshot) validateProduct(m.productSnapshot);
    if (m.productId) text(m.productId, "товар материала", true);
  }
  for (const n of [...s.projectNotes, ...s.runNotes]) {
    text(n.text, "текст заметки");
    if (n.attachmentIds !== undefined) {
      list(n.attachmentIds, "вложения");
      ok(
        n.attachmentIds.length <= 20 &&
          new Set(n.attachmentIds).size === n.attachmentIds.length,
        "не более 20 уникальных вложений",
      );
      n.attachmentIds.forEach((x) => text(x, "ID вложения", true));
    }
    ok(n.text.trim() || n.attachmentIds?.length, "пустая заметка");
    text(n.createdAt, "дата", true);
    text(n.updatedAt, "дата изменения", true);
    if ("projectId" in n)
      ok(
        s.projects.some((p) => p.id === n.projectId),
        "проект заметки",
      );
    else {
      ok(
        s.runs.some((r) => r.id === n.runId),
        "производство заметки",
      );
      ok(
        ["internal", "customer_reported"].includes(n.source),
        "источник заметки",
      );
    }
  }
  for (const t of s.runTasks) {
    ok(
      s.runs.some((r) => r.id === t.runId),
      "производство задачи",
    );
    text(t.text, "текст задачи", true);
    num(t.order, "порядок", 0);
    ok(typeof t.done === "boolean", "готовность");
    text(t.createdAt, "дата");
    text(t.updatedAt, "дата");
    if (t.sourceNoteId)
      ok(
        s.runNotes.some((n) => n.id === t.sourceNoteId && n.runId === t.runId),
        "источник задачи",
      );
  }
  for (const r of s.runs)
    if (r.customer) {
      text(r.customer.name, "заказчик");
      text(r.customer.requests, "пожелания");
      text(r.customer.chatUrl, "чат");
      if (r.customer.chatUrl)
        ok(
          safeUrl(r.customer.chatUrl),
          "ссылка чата должна начинаться с http:// или https://",
        );
    }
  const projects = new Set();
  for (const b of s.boards) {
    ok(b.schemaVersion === 1, "версия доски");
    ok(
      s.projects.some((p) => p.id === b.projectId) &&
        !projects.has(b.projectId),
      "одна доска на проект",
    );
    projects.add(b.projectId);
    num(b.revision, "ревизия", 0);
    text(b.updatedAt, "дата доски");
    ok(b.viewport, "область доски");
    num(b.viewport.x, "сдвиг");
    num(b.viewport.y, "сдвиг");
    num(b.viewport.zoom, "масштаб", 0.05, 5);
    list(b.migratedAssetIds, "перенесённые фото");
    b.migratedAssetIds.forEach((x) => text(x, "ID фото"));
    ids(b.nodes, "карточки");
    ids(b.edges, "связи");
    for (const n of b.nodes) {
      ok(n.type === "workshop" && n.position && n.data, "карточка");
      num(n.position.x, "координата");
      num(n.position.y, "координата");
      if (n.style) {
        if (n.style.width !== undefined)
          num(n.style.width, "ширина", 100, 100000);
        if (n.style.height !== undefined)
          num(n.style.height, "высота", 60, 100000);
      }
      if (n.zIndex !== undefined) num(n.zIndex, "слой");
      if (n.parentId)
        ok(
          n.parentId !== n.id &&
            b.nodes.some(
              (p) =>
                p.id === n.parentId && p.data.kind === "group" && !p.parentId,
            ),
          "родитель карточки",
        );
      const d = n.data;
      text(d.title, "заголовок");
      switch (d.kind) {
        case "paint": {
          const p = d.document;
          ok(p, "документ перекраски");
          ok(
            p.schemaVersion === undefined || [1, 2].includes(p.schemaVersion),
            "версия документа перекраски",
          );
          text(p.id, "ID перекраски", true);
          text(p.sourceAssetId, "оригинал", true);
          text(p.previewAssetId, "превью");
          num(p.width, "ширина изображения", 1, 2048);
          num(p.height, "высота изображения", 1, 2048);
          ids(p.layers, "слои перекраски");
          ok(p.layers.length <= 20, "не более 20 слоёв");
          for (const layer of p.layers) {
            text(layer.name, "имя слоя", true);
            text(layer.maskAssetId, "маска", true);
            hex(layer.color);
            num(layer.opacity, "прозрачность", 0, 1);
            ok(typeof layer.visible === "boolean", "видимость слоя");
            ok(
              ["color", "multiply", "soft-light", "source-over"].includes(
                layer.blend,
              ),
              "режим наложения",
            );
            if (layer.material) ref(layer.material, s);
          }
          break;
        }
        case "image":
          text(d.assetId, "фото", true);
          break;
        case "note":
          text(d.text, "заметка");
          if (d.color) hex(d.color);
          break;
        case "group":
          if (d.color) hex(d.color);
          ok(!n.parentId, "вложенные группы не поддерживаются");
          break;
        case "checklist":
          ids(d.items, "чек-лист");
          d.items.forEach((i) => {
            text(i.text, "пункт", true);
            ok(typeof i.done === "boolean", "готовность пункта");
          });
          break;
        case "material":
          ref(d.material, s);
          break;
        case "palette":
          list(d.colors, "палитра");
          d.colors.forEach((r) => ref(r, s));
          break;
        case "link":
          ok(safeUrl(d.url), "ссылка карточки");
          break;
        default:
          throw new Error("Проверка данных: неизвестный тип карточки");
      }
    }
    for (const e of b.edges)
      ok(
        b.nodes.some((n) => n.id === e.source) &&
          b.nodes.some((n) => n.id === e.target),
        "связь карточек",
      );
  }
}
export function referencedAssetIds(s: State): Set<string> {
  const ids = new Set<string>();
  for (const n of [...s.projectNotes, ...s.runNotes])
    n.attachmentIds?.forEach((id) => ids.add(id));
  for (const b of s.boards)
    for (const n of b.nodes) {
      if (n.data.kind === "image") ids.add(n.data.assetId);
      if (n.data.kind === "paint") {
        ids.add(n.data.document.sourceAssetId);
        if (n.data.document.previewAssetId)
          ids.add(n.data.document.previewAssetId);
        n.data.document.layers.forEach((l) => ids.add(l.maskAssetId));
      }
    }
  return ids;
}
export function validateBoardAssets(s: State, assets: AssetMeta[]) {
  const requireAsset = (
    id: string,
    projectId: string,
    purpose?: AssetMeta["purpose"],
  ) => {
    ok(
      assets.some(
        (a) =>
          a.id === id &&
          a.projectId === projectId &&
          (!purpose || a.purpose === purpose),
      ),
      "отсутствует изображение или неверный проект: " + id,
    );
  };
  for (const n of [...s.projectNotes, ...s.runNotes]) {
    const projectId =
      "projectId" in n
        ? n.projectId
        : s.runs.find((r) => r.id === n.runId)!.projectId;
    n.attachmentIds?.forEach((id) => requireAsset(id, projectId));
  }
  for (const b of s.boards)
    for (const n of b.nodes) {
      if (n.data.kind === "image") requireAsset(n.data.assetId, b.projectId);
      if (n.data.kind === "paint") {
        const d = n.data.document;
        requireAsset(d.sourceAssetId, b.projectId);
        if (d.previewAssetId)
          requireAsset(d.previewAssetId, b.projectId, "paint-preview");
        d.layers.forEach((l) =>
          requireAsset(l.maskAssetId, b.projectId, "paint-mask"),
        );
      }
    }
}
