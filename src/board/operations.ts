import { uid } from "../domain/model";
import type { BoardData, BoardNode, ProjectBoard } from "../domain/workspace";
export function createNode(
  data: BoardData,
  position = { x: 100, y: 100 },
): BoardNode {
  return {
    id: uid(),
    type: "workshop",
    dragHandle: ".board-card-heading",
    position,
    data,
    style: {
      width: data.kind === "group" ? 580 : 280,
      height: data.kind === "group" ? 420 : data.kind === "paint" ? 360 : 260,
    },
    zIndex: data.kind === "group" ? -1 : 0,
  };
}
export function absolutePosition(n: BoardNode, nodes: BoardNode[]) {
  const p = nodes.find((x) => x.id === n.parentId);
  return {
    x: n.position.x + (p?.position.x ?? 0),
    y: n.position.y + (p?.position.y ?? 0),
  };
}
export function groupNodes(b: ProjectBoard, ids: string[]): ProjectBoard {
  const chosen = b.nodes.filter(
    (n) => ids.includes(n.id) && n.data.kind !== "group",
  );
  if (!chosen.length) return b;
  const pos = chosen.map((n) => absolutePosition(n, b.nodes));
  const x = Math.min(...pos.map((p) => p.x)) - 24,
    y = Math.min(...pos.map((p) => p.y)) - 60;
  const g = createNode({ kind: "group", title: "Группа" }, { x, y });
  g.style = {
    width:
      Math.max(
        ...chosen.map((n, i) => pos[i].x + Number(n.style?.width ?? 280)),
      ) +
      24 -
      x,
    height:
      Math.max(
        ...chosen.map((n, i) => pos[i].y + Number(n.style?.height ?? 260)),
      ) +
      24 -
      y,
  };
  return {
    ...b,
    nodes: [
      g,
      ...b.nodes.map((n) => {
        const i = chosen.findIndex((a) => a.id === n.id);
        return i < 0
          ? n
          : {
              ...n,
              parentId: g.id,
              position: { x: pos[i].x - x, y: pos[i].y - y },
              selected: false,
            };
      }),
    ],
  };
}
export function ungroupNodes(b: ProjectBoard, ids: string[]): ProjectBoard {
  return {
    ...b,
    edges: b.edges.filter(
      (e) => !ids.includes(e.source) && !ids.includes(e.target),
    ),
    nodes: b.nodes
      .filter((n) => !ids.includes(n.id))
      .map((n) => {
        if (!n.parentId || !ids.includes(n.parentId)) return n;
        const copy = { ...n, position: absolutePosition(n, b.nodes) };
        delete copy.parentId;
        return copy;
      }),
  };
}
export function duplicateNodes(
  b: ProjectBoard,
  selection: string[],
): ProjectBoard {
  const chosen = b.nodes.filter(
    (n) =>
      selection.includes(n.id) ||
      (!!n.parentId && selection.includes(n.parentId)),
  );
  const ids = new Map(chosen.map((n) => [n.id, uid()]));
  const copies = chosen.map((n) => {
    const copy = structuredClone(n);
    copy.id = ids.get(n.id)!;
    if (copy.data.kind === "paint") copy.data.document.id = uid();
    copy.selected = true;
    if (n.parentId && ids.has(n.parentId)) copy.parentId = ids.get(n.parentId);
    else {
      copy.position = absolutePosition(n, b.nodes);
      delete copy.parentId;
      copy.position.x += 40;
      copy.position.y += 40;
    }
    return copy;
  });
  return {
    ...b,
    nodes: [
      ...b.nodes.map((n) => ({ ...n, selected: false })),
      ...copies.filter((n) => !n.parentId),
      ...copies.filter((n) => n.parentId),
    ],
    edges: [
      ...b.edges,
      ...b.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({
          ...e,
          id: uid(),
          source: ids.get(e.source)!,
          target: ids.get(e.target)!,
        })),
    ],
  };
}
export function deleteNodes(
  b: ProjectBoard,
  selection: string[],
): ProjectBoard {
  const ids = new Set(
    b.nodes
      .filter(
        (n) =>
          selection.includes(n.id) ||
          (!!n.parentId && selection.includes(n.parentId)),
      )
      .map((n) => n.id),
  );
  return {
    ...b,
    nodes: b.nodes.filter((n) => !ids.has(n.id)),
    edges: b.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
  };
}

/** A card enters a group when its centre is dropped in the group's body. */
export function dropIntoGroups(
  b: ProjectBoard,
  draggedIds: string[],
): ProjectBoard {
  const dragging = new Set(draggedIds);
  const nodes = b.nodes.map((n) => {
    if (
      !dragging.has(n.id) ||
      n.data.kind === "group" ||
      (n.parentId && dragging.has(n.parentId))
    )
      return n;
    const world = absolutePosition(n, b.nodes);
    const cx = world.x + Number(n.style?.width ?? n.measured?.width ?? 280) / 2;
    const cy =
      world.y + Number(n.style?.height ?? n.measured?.height ?? 260) / 2;
    const groups = b.nodes.filter(
      (g) =>
        g.data.kind === "group" &&
        cx >= g.position.x &&
        cx <= g.position.x + Number(g.style?.width ?? 580) &&
        cy >= g.position.y + 44 &&
        cy <= g.position.y + Number(g.style?.height ?? 420),
    );
    // Prefer smallest containing group where several overlap; nesting is not supported.
    groups.sort(
      (a, b) =>
        Number(a.style?.width) * Number(a.style?.height) -
        Number(b.style?.width) * Number(b.style?.height),
    );
    const parent = groups[0];
    if (n.parentId === parent?.id) return n;
    const next = {
      ...n,
      position: {
        x: world.x - (parent?.position.x ?? 0),
        y: world.y - (parent?.position.y ?? 0),
      },
    };
    if (parent) next.parentId = parent.id;
    else delete next.parentId;
    return next;
  });
  return {
    ...b,
    nodes: [
      ...nodes.filter((n) => !n.parentId),
      ...nodes.filter((n) => !!n.parentId),
    ],
  };
}
export type EdgeDirection = "forward" | "reverse" | "both" | "none";
export function setEdgeDirection(
  b: ProjectBoard,
  ids: string[],
  direction: EdgeDirection,
): ProjectBoard {
  return {
    ...b,
    edges: b.edges.map((e) =>
      ids.includes(e.id) ? { ...e, data: { ...e.data, direction } } : e,
    ),
  };
}
export function deleteSelection(b: ProjectBoard): ProjectBoard {
  const next = deleteNodes(
    b,
    b.nodes.filter((n) => n.selected).map((n) => n.id),
  );
  return { ...next, edges: next.edges.filter((e) => !e.selected) };
}
