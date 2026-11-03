import Dexie, { type Table } from "dexie";
import {
  emptyState,
  now,
  uid,
  type State,
  type Asset,
  type AssetMeta,
} from "../domain/model";
import { validate, validateAssets } from "../domain/validation";
import { migrateState, serializableNodes } from "../domain/migrations";
import {
  referencedAssetIds,
  validateBoardAssets,
} from "../domain/workspaceValidation";
import type { ProjectBoard } from "../domain/workspace";
export const assetMeta = ({ blob: _b, thumb: _t, ...rest }: Asset): AssetMeta =>
  rest;
class WorkshopDB extends Dexie {
  states!: Table<State & { key: string }, string>;
  assets!: Table<Asset, string>;
  assetIndex!: Table<AssetMeta, string>;
  constructor() {
    super("masterskaya-v1");
    this.version(1).stores({ states: "key", assets: "id,projectId" });
    this.version(2)
      .stores({
        states: "key",
        assets: "id,projectId",
        assetIndex: "id,projectId",
      })
      .upgrade(async (tx) => {
        const assets = (await tx.table("assets").toArray()) as Asset[];
        const meta = assets.map(assetMeta);
        await tx.table("assetIndex").bulkPut(meta);
        const old = await tx.table("states").get("main");
        if (old) {
          const next = migrateState(old, meta);
          validate(next);
          validateBoardAssets(next, meta);
          await tx.table("states").put({ ...next, key: "main" });
        }
      });
    this.version(3)
      .stores({
        states: "key",
        assets: "id,projectId",
        assetIndex: "id,projectId",
      })
      .upgrade(async (tx) => {
        const old = await tx.table("states").get("main");
        if (old) {
          const next = migrateState(old);
          validate(next);
          await tx.table("states").put({ ...next, key: "main" });
        }
      });
  }
}
export const db = new WorkshopDB();
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("masterskaya-updates")
    : null;
function announce() {
  channel?.postMessage("changed");
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("workshop-change"));
}
channel?.addEventListener("message", () => {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("workshop-change"));
});
export async function readState(): Promise<State> {
  const value = await db.states.get("main");
  if (!value) return emptyState();
  const { key, ...state } = value;
  return state;
}
async function putState(s: State) {
  s.revision++;
  s.settings.changes++;
  validate(s);
  await db.states.put({ ...s, key: "main" });
}
export async function mutate(
  fn: (s: State) => void,
  expectedRevision?: number,
) {
  await db.transaction("rw", db.states, async () => {
    const s = await readState();
    if (expectedRevision !== undefined && s.revision !== expectedRevision)
      throw new Error(
        "Данные изменились в другой вкладке. Откройте форму заново.",
      );
    fn(s);
    await putState(s);
  });
  announce();
}
export async function replaceAll(s: State, assets: Asset[]) {
  validate(s);
  validateAssets(s, assets);
  validateBoardAssets(s, assets);
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    const old = await readState(),
      next = structuredClone(s);
    next.revision = old.revision + 1;
    next.boards.forEach((b) => {
      b.revision =
        Math.max(
          b.revision,
          old.boards.find((x) => x.projectId === b.projectId)?.revision ?? -1,
        ) + 1;
    });
    await db.assets.clear();
    await db.assetIndex.clear();
    await db.assets.bulkPut(assets);
    await db.assetIndex.bulkPut(assets.map(assetMeta));
    await db.states.put({ ...next, key: "main" });
  });
  announce();
}
export async function saveAssets(assets: Asset[]) {
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    const s = await readState();
    validateAssets(s, assets);
    await db.assets.bulkPut(assets);
    await db.assetIndex.bulkPut(assets.map(assetMeta));
    validateBoardAssets(s, await db.assetIndex.toArray());
    await putState(s);
  });
  announce();
}
export async function removeAsset(id: string) {
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    const s = await readState(),
      a = await db.assetIndex.get(id);
    if (a?.cover || referencedAssetIds(s).has(id))
      throw new Error(
        "Фото используется на доске, в заметке, в перекраске или как обложка. Сначала уберите эти ссылки.",
      );
    await db.assets.delete(id);
    await db.assetIndex.delete(id);
    await putState(s);
  });
  announce();
}
export async function updateAssetMeta(
  id: string,
  patch: Partial<Pick<AssetMeta, "cover" | "caption" | "group" | "order">>,
) {
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    const a = await db.assets.get(id);
    if (!a) throw new Error("Изображение не найдено");
    const s = await readState();
    if (patch.cover) {
      for (const other of await db.assets
        .where("projectId")
        .equals(a.projectId)
        .toArray()) {
        if (other.cover && other.id !== id) {
          other.cover = false;
          await db.assets.put(other);
          await db.assetIndex.put(assetMeta(other));
        }
      }
    }
    const next = { ...a, ...patch };
    validateAssets(s, [next]);
    await db.assets.put(next);
    await db.assetIndex.put(assetMeta(next));
    await putState(s);
  });
  announce();
}
export async function saveBoard(
  board: ProjectBoard,
  expectedRevision: number,
  assets: Asset[] = [],
) {
  let saved!: ProjectBoard;
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    const s = await readState(),
      old = s.boards.find((b) => b.projectId === board.projectId);
    if ((old?.revision ?? 0) !== expectedRevision)
      throw new Error(
        "Доска изменена в другой вкладке. Скачайте черновик, затем загрузите сохранённую версию.",
      );
    saved = {
      ...structuredClone(board),
      nodes: serializableNodes(board.nodes),
      revision: expectedRevision + 1,
      updatedAt: now(),
    };
    const i = s.boards.findIndex((b) => b.projectId === board.projectId);
    if (i < 0) s.boards.push(saved);
    else s.boards[i] = saved;
    validate(s);
    validateAssets(s, assets);
    await db.assets.bulkPut(assets);
    await db.assetIndex.bulkPut(assets.map(assetMeta));
    validateBoardAssets(s, await db.assetIndex.toArray());
    await putState(s);
  });
  announce();
  return saved;
}
export async function copyProject(projectId: string) {
  let id = "";
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    const s = await readState(),
      p = s.projects.find((p) => p.id === projectId);
    if (!p) throw new Error("Проект не найден");
    id = uid();
    s.projects.push({
      ...structuredClone(p),
      id,
      title: p.title + " — копия",
      updatedAt: now(),
      archived: false,
    });
    const assets = await db.assets
        .where("projectId")
        .equals(projectId)
        .toArray(),
      ids = new Map(assets.map((a) => [a.id, uid()])),
      copies = assets.map((a) => ({ ...a, id: ids.get(a.id)!, projectId: id }));
    const b = s.boards.find((b) => b.projectId === projectId);
    if (b) {
      const copy = structuredClone(b);
      copy.id = id;
      copy.projectId = id;
      copy.revision = 0;
      copy.updatedAt = now();
      copy.migratedAssetIds = copy.migratedAssetIds
        .map((x) => ids.get(x))
        .filter((x): x is string => !!x);
      copy.nodes.forEach((n) => {
        if (n.data.kind === "image") n.data.assetId = ids.get(n.data.assetId)!;
        if (n.data.kind === "paint") {
          const d = n.data.document;
          d.id = uid();
          d.sourceAssetId = ids.get(d.sourceAssetId)!;
          if (d.previewAssetId) d.previewAssetId = ids.get(d.previewAssetId)!;
          d.layers.forEach((l) => {
            l.maskAssetId = ids.get(l.maskAssetId)!;
          });
        }
      });
      s.boards.push(copy);
    }
    s.projectNotes.push(
      ...s.projectNotes
        .filter((n) => n.projectId === projectId)
        .map((n) => ({
          ...structuredClone(n),
          attachmentIds: n.attachmentIds?.map((a) => ids.get(a)!),
          id: uid(),
          projectId: id,
        })),
    );
    validateAssets(s, copies);
    await db.assets.bulkPut(copies);
    await db.assetIndex.bulkPut(copies.map(assetMeta));
    validateBoardAssets(s, await db.assetIndex.toArray());
    await putState(s);
  });
  announce();
  return id;
}
export async function snapshot() {
  return db.transaction("r", db.states, db.assets, async () => ({
    state: await readState(),
    assets: await db.assets.toArray(),
  }));
}
export function errorText(e: unknown) {
  return e instanceof Error
    ? e.name === "QuotaExceededError"
      ? "Хранилище заполнено. Экспортируйте ZIP, затем удалите ненужные фотографии."
      : e.message
    : "Не удалось выполнить действие";
}

export async function mutateWithAssets(
  fn: (s: State) => void,
  assets: Asset[],
) {
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    const s = await readState();
    fn(s);
    validateAssets(s, assets);
    await db.assets.bulkPut(assets);
    await db.assetIndex.bulkPut(assets.map(assetMeta));
    validateBoardAssets(s, await db.assetIndex.toArray());
    await putState(s);
  });
  announce();
}
