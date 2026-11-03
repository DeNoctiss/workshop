import { assetGroups, now, type AssetMeta, type State } from "./model";
import type { ProjectBoard, BoardNode } from "./workspace";
export function emptyBoard(projectId: string): ProjectBoard {
  return {
    id: projectId,
    projectId,
    schemaVersion: 1,
    revision: 0,
    nodes: [],
    edges: [],
    viewport: { x: 40, y: 40, zoom: 1 },
    updatedAt: now(),
    migratedAssetIds: [],
  };
}
/** Pure migration. Keeps warehouse journal, originals and run snapshots unchanged. */
export function migrateState(input: unknown, assets: AssetMeta[] = []): State {
  if (!input || typeof input !== "object")
    throw new Error("Не удалось прочитать базу");
  const raw = input as Record<string, unknown>;
  if (raw.schemaVersion === 3) return structuredClone(input) as State;
  if (raw.schemaVersion === 2)
    return { ...structuredClone(input as State), schemaVersion: 3 };
  if (raw.schemaVersion !== 1) throw new Error("Неподдерживаемая версия базы");
  const s = structuredClone(input) as State;
  s.schemaVersion = 3;
  s.userProducts = [];
  s.projectNotes = [];
  s.runNotes = [];
  s.runTasks = [];
  s.boards = [];
  if (!Array.isArray(s.projects)) throw new Error("В базе нет списка проектов");
  for (const p of s.projects) {
    if (p.notes?.trim())
      s.projectNotes.push({
        id: `legacy-${p.id}`,
        projectId: p.id,
        text: p.notes,
        createdAt: p.updatedAt || now(),
        updatedAt: p.updatedAt || now(),
      });
    const b = emptyBoard(p.id);
    let column = 0;
    for (const [group, title] of Object.entries(assetGroups)) {
      const photos = assets
        .filter((a) => a.projectId === p.id && a.group === group)
        .sort((a, b) => a.order - b.order);
      if (!photos.length) continue;
      const groupId = `group-${group}`;
      b.nodes.push({
        id: groupId,
        type: "workshop",
        position: { x: column++ * 640, y: 0 },
        style: { width: 610, height: 80 + Math.ceil(photos.length / 2) * 300 },
        zIndex: -1,
        data: { kind: "group", title },
      });
      photos.forEach((a, i) => {
        b.nodes.push({
          id: `image-${a.id}`,
          type: "workshop",
          parentId: groupId,
          position: { x: 20 + (i % 2) * 290, y: 60 + Math.floor(i / 2) * 300 },
          style: { width: 270, height: 280 },
          data: { kind: "image", title: a.caption, assetId: a.id },
        });
        b.migratedAssetIds.push(a.id);
      });
    }
    s.boards.push(b);
  }
  return s;
}
export function serializableNodes(nodes: BoardNode[]): BoardNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: "workshop",
    dragHandle: ".board-card-heading",
    position: n.position,
    data: structuredClone(n.data),
    ...(n.parentId ? { parentId: n.parentId } : {}),
    style: {
      width: Number(n.style?.width) || n.measured?.width || 280,
      height: Number(n.style?.height) || n.measured?.height || 260,
    },
    zIndex: n.zIndex ?? (n.data.kind === "group" ? -1 : 0),
  }));
}
