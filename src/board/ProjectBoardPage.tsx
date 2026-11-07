import { useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  MarkerType,
  useReactFlow,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  ImagePlus,
  StickyNote,
  CheckSquare,
  Layers,
  Package,
  Palette,
  Link,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  Group,
  Ungroup,
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Search,
  Plus,
  ListTree,
} from "lucide-react";
import { useApp } from "../components/context";
import { Empty, Modal, Photo, Field } from "../components/ui";
import { Paged } from "../components/Paged";
import { now, uid, type AssetMeta, type Material } from "../domain/model";
import type {
  BoardData,
  BoardNode,
  MaterialReference,
} from "../domain/workspace";
import { db, updateAssetMeta, removeAsset } from "../data/db";
import { prepareImage } from "../data/images";
import { BoardCard, BoardActions, nodeLabels } from "./BoardCard";
import { PaintEditor } from "../paint/PaintEditor";
import { NodeEditor } from "./NodeEditor";
import {
  createNode,
  duplicateNodes,
  deleteSelection,
  dropIntoGroups,
  setEdgeDirection,
  type EdgeDirection,
  groupNodes,
  ungroupNodes,
  absolutePosition,
  findFreePosition,
} from "./operations";
import { CatalogPicker } from "../catalog/CatalogPicker";
import { newMaterial, findProduct, defaultUnit } from "../catalog/catalog";
import { MaterialForm } from "../pages/Materials";
import { useBoardDocument } from "./useBoardDocument";
const nodeTypes = { workshop: BoardCard };
export default function ProjectBoardPage({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <BoardCanvas projectId={projectId} />
    </ReactFlowProvider>
  );
}
function BoardCanvas({ projectId }: { projectId: string }) {
  const { state, assets, act, confirm, busy } = useApp(),
    project = state.projects.find((p) => p.id === projectId),
    flow = useReactFlow<BoardNode>(),
    root = useRef<HTMLDivElement>(null),
    doc = useBoardDocument(projectId),
    { graph, current, change } = doc;
  // Restore the camera when a clean document receives another tab's newer board.
  useEffect(() => {
    void flow.setViewport(current.current.viewport);
  }, [graph.revision, flow, current]);
  const [newPaint, setNewPaint] = useState(false);
  const [editing, setEditing] = useState<string | null>(null),
    [switchWarning, setSwitchWarning] = useState(false),
    [pendingNode, setPendingNode] = useState<BoardNode | null>(null),
    [overviewQuery, setOverviewQuery] = useState(""),
    [picker, setPicker] = useState(false),
    [filesOpen, setFilesOpen] = useState(false),
    [full, setFull] = useState<AssetMeta | null>(null),
    [material, setMaterial] = useState<{
      draft: Material;
      ref: MaterialReference;
      nodeId: string;
    } | null>(null),
    [free, setFree] = useState(false),
    [freeName, setFreeName] = useState(""),
    [freeColor, setFreeColor] = useState("#9b7562");
  const selected = graph.nodes.filter((n) => n.selected).map((n) => n.id),
    boardLocked =
      !!editing &&
      graph.nodes.some((n) => n.id === editing && n.data.kind === "paint"),
    groups = graph.nodes
      .filter((n) => n.selected && n.data.kind === "group")
      .map((n) => n.id);
  const visibleNodes = graph.nodes.filter((n) => {
    const data = n.data;
    const extra =
      data.kind === "note"
        ? data.text
        : data.kind === "material"
          ? data.material.snapshot.label
          : data.kind === "palette"
            ? data.colors.map((c) => c.snapshot.label).join(" ")
            : "";
    return `${data.title} ${extra}`
      .toLocaleLowerCase("ru")
      .includes(overviewQuery.trim().toLocaleLowerCase("ru"));
  });
  const openEditor = (id: string) => {
    if (editing && editing !== id) {
      setSwitchWarning(true);
      return;
    }
    setEditing(id);
    const node = current.current.nodes.find((n) => n.id === id);
    if (
      node?.data.kind === "paint" &&
      !window.matchMedia("(max-width: 760px)").matches
    )
      requestAnimationFrame(
        () => void flow.fitView({ nodes: [node], padding: 0.18, maxZoom: 1 }),
      );
  };
  const paintFromImage = (assetId: string) => {
    if (editing || newPaint) {
      setSwitchWarning(true);
      return;
    }
    void act(async () => {
      const asset = await db.assets.get(assetId);
      if (!asset || asset.projectId !== projectId)
        throw new Error("Исходное фото проекта не найдено");
      const image = await createImageBitmap(asset.blob);
      const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      image.close();
      const id = insert({
        kind: "paint",
        title: "Вариант окраски",
        document: {
          id: uid(),
          schemaVersion: 2,
          sourceAssetId: assetId,
          previewAssetId: "",
          width,
          height,
          layers: [],
          updatedAt: now(),
        },
      });
      if (!(await doc.flush()))
        throw new Error("Не удалось сохранить новую карточку перекраски");
      openEditor(id);
    }, "Вариант окраски создан");
  };
  const center = (width = 280, height = 260) => {
    const r = root.current?.getBoundingClientRect();
    const point = flow.screenToFlowPosition({
      x: (r?.left ?? 0) + (r?.width ?? 800) / 2,
      y: (r?.top ?? 0) + (r?.height ?? 600) / 2,
    });
    return { x: point.x - width / 2, y: point.y - height / 2 };
  };
  const freePosition = (data: BoardData, nodes = current.current.nodes) => {
    const node = createNode(data);
    const width = Number(node.style?.width) || 280;
    const height = Number(node.style?.height) || 260;
    return findFreePosition(nodes, center(width, height), { width, height });
  };
  const reveal = (node: BoardNode) => {
    requestAnimationFrame(() => {
      const r = root.current?.getBoundingClientRect();
      if (!r) return;
      const width = Number(node.style?.width) || 280;
      const height = Number(node.style?.height) || 260;
      const topLeft = flow.flowToScreenPosition(node.position);
      const bottomRight = flow.flowToScreenPosition({
        x: node.position.x + width,
        y: node.position.y + height,
      });
      if (
        topLeft.x < r.left + 24 ||
        topLeft.y < r.top + 24 ||
        bottomRight.x > r.right - 24 ||
        bottomRight.y > r.bottom - 24
      )
        void flow.setCenter(
          node.position.x + width / 2,
          node.position.y + height / 2,
          {
            zoom: flow.getZoom(),
          },
        );
    });
  };
  const insert = (data: BoardData, position?: { x: number; y: number }) => {
    const node = createNode(data, position ?? freePosition(data));
    change({
      ...current.current,
      nodes: [
        ...current.current.nodes.map((n) => ({ ...n, selected: false })),
        { ...node, selected: true },
      ],
    });
    reveal(node);
    return node.id;
  };
  const simple = (
    kind: "note" | "checklist" | "group" | "palette" | "link",
    position?: { x: number; y: number },
  ) => {
    const data: BoardData =
      kind === "note"
        ? { kind, title: "Заметка", text: "" }
        : kind === "checklist"
          ? { kind, title: "Чек-лист", items: [] }
          : kind === "palette"
            ? { kind, title: "Палитра", colors: [] }
            : kind === "link"
              ? { kind, title: "Ссылка", url: "" }
              : { kind, title: "Группа" };
    if (kind === "group") insert(data, position);
    else setPendingNode(createNode(data, position ?? freePosition(data)));
  };
  const locate = (id: string) => {
    const node = current.current.nodes.find((n) => n.id === id);
    if (!node) return;
    change(
      {
        ...current.current,
        nodes: current.current.nodes.map((n) => ({
          ...n,
          selected: n.id === id,
        })),
      },
      false,
      false,
    );
    const position = absolutePosition(node, current.current.nodes);
    void flow.setCenter(
      position.x + (Number(node.style?.width) || 280) / 2,
      position.y + (Number(node.style?.height) || 260) / 2,
      { zoom: Math.max(flow.getZoom(), 0.65) },
    );
    root.current?.focus();
  };
  const removeSelected = () => {
    const ids = current.current.nodes
      .filter((n) => n.selected)
      .map((n) => n.id);
    const edgeCount = current.current.edges.filter((e) => e.selected).length;
    if (!ids.length && !edgeCount) return;
    confirm(
      "Удалить выбранные элементы?",
      "Содержимое выбранных групп тоже уйдёт с доски. Файлы сохранятся; действие можно отменить.",
      async () => {
        change(deleteSelection(current.current));
      },
    );
  };
  async function upload(files: File[], position?: { x: number; y: number }) {
    if (!files.length) return;
    await act(async () => {
      const prepared = await Promise.all(
        files.map((f, i) =>
          prepareImage(f, projectId, "main", assets.length + i),
        ),
      );
      doc.addAssets(prepared);
      const nodes = current.current.nodes.map((node) => ({
        ...node,
        selected: false,
      }));
      const additions = prepared.map((a, i) => {
        const data: BoardData = {
          kind: "image",
          title: a.caption,
          assetId: a.id,
        };
        const node = createNode(
          data,
          position
            ? {
                x: position.x + (i % 3) * 310,
                y: position.y + Math.floor(i / 3) * 290,
              }
            : freePosition(data, nodes),
        );
        nodes.push({ ...node, selected: i === prepared.length - 1 });
        return node;
      });
      change({
        ...current.current,
        nodes,
      });
      reveal(additions[additions.length - 1]);
      if (!(await doc.flush()))
        throw new Error(
          "Изображения пока не сохранены. Повторите сохранение доски.",
        );
    }, "Изображения добавлены на доску");
  }
  const addStock = (ref: MaterialReference, nodeId: string) => {
    const existing = state.materials.find(
        (m) => m.id === ref.inventoryMaterialId,
      ),
      product = findProduct(state, ref.productId),
      draft = existing ? structuredClone(existing) : newMaterial(product);
    if (!product && !existing) {
      draft.name = ref.snapshot.label;
      draft.category = ref.snapshot.category ?? "paint";
      draft.unit = defaultUnit(draft.category);
      draft.color = ref.snapshot.colorHex ?? "";
      draft.colorEnabled = !!ref.snapshot.colorHex;
    }
    setMaterial({ draft, ref, nodeId });
  };
  const nodeChanges = (changes: NodeChange<BoardNode>[]) => {
    const editingPaint =
      current.current.nodes.find((n) => n.id === editing)?.data.kind ===
      "paint";
    const relevant = changes.filter(
      (c) => !(editingPaint && c.type === "dimensions" && c.id === editing),
    );
    if (!relevant.length) return;
    const significant = relevant.some(
      (c) =>
        (c.type === "position" && !!c.position) ||
        (c.type === "dimensions" && !!c.setAttributes),
    );
    const next = applyNodeChanges(relevant, current.current.nodes).map((n) => {
      const resize = relevant.find(
        (c) => c.type === "dimensions" && c.id === n.id && c.setAttributes,
      );
      return resize?.type === "dimensions" && resize.dimensions
        ? {
            ...n,
            style: {
              ...n.style,
              width: resize.dimensions.width,
              height: resize.dimensions.height,
            },
          }
        : n;
    });
    change({ ...current.current, nodes: next }, false, significant);
  };
  const undo = (redo = false) => {
    doc.undo(redo);
    void flow.setViewport(current.current.viewport);
  };
  if (!project) return <Empty title="Проект не найден" />;
  const editNode = pendingNode ?? graph.nodes.find((n) => n.id === editing);
  return (
    <div className="board-page">
      <div className="board-page-header">
        <button
          onClick={async () => {
            if (await doc.flush()) location.hash = "/projects/" + projectId;
          }}
        >
          <ArrowLeft size={17} />К проекту
        </button>
        <div>
          <h1>{project.title}</h1>
          <span>Доска проекта</span>
        </div>
        <span
          role="status"
          className={"save-status " + (doc.error ? "error" : "")}
        >
          {boardLocked ? "Доска: " + doc.status : doc.status}
        </span>
        <button onClick={() => setFilesOpen(true)}>
          <FolderOpen size={17} />
          Файлы проекта
        </button>
      </div>
      {switchWarning && (
        <div className="board-error" role="alert">
          <span>Сначала сохраните или отмените открытую перекраску.</span>
          <button onClick={() => setSwitchWarning(false)}>Понятно</button>
        </div>
      )}
      {doc.error && (
        <div className="board-error" role="alert">
          <p>{doc.error}</p>
          <div className="actions">
            <button onClick={() => void doc.flush()}>
              Повторить сохранение
            </button>
            <button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(doc.draft(), null, 2)], {
                    type: "application/json",
                  }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "board-draft-" + projectId + ".json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
              }}
            >
              Скачать черновик JSON
            </button>
            <button
              onClick={() =>
                confirm(
                  "Загрузить сохранённую доску?",
                  "Несохранённые изменения будут заменены. Сначала скачайте черновик.",
                  async () => {
                    const b = await doc.reload();
                    void flow.setViewport(b.viewport);
                  },
                )
              }
            >
              Загрузить из базы
            </button>
          </div>
        </div>
      )}
      <div className="board-toolbar">
        <label className="button board-add-primary">
          <ImagePlus size={17} />
          Фото
          <input
            className="file-input"
            disabled={busy}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void upload(files);
            }}
          />
        </label>
        <button
          className="board-add-primary"
          draggable
          disabled={busy}
          onDragStart={(e) =>
            e.dataTransfer.setData("application/workshop-node", "note")
          }
          onClick={() => simple("note")}
        >
          <StickyNote size={17} />
          Заметка
        </button>
        <button
          className="board-add-primary"
          disabled={busy || !!editing}
          title={editing ? "Завершите открытое редактирование" : undefined}
          onClick={() => setNewPaint(true)}
        >
          <Palette size={17} />
          Перекраска
        </button>
        <details className="board-popover board-add-menu">
          <summary className="button">
            <Plus size={17} />
            Ещё карточки
          </summary>
          <div
            className="board-popover-content"
            onClick={(e) => {
              if ((e.target as Element).closest("button"))
                e.currentTarget.parentElement?.removeAttribute("open");
            }}
          >
            <small>Текст и структура</small>
            {(
              [
                ["checklist", "Чек-лист", CheckSquare],
                ["group", "Группа", Layers],
                ["link", "Ссылка", Link],
              ] as const
            ).map(([kind, label, Icon]) => (
              <button
                key={kind}
                draggable
                disabled={busy}
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/workshop-node", kind)
                }
                onClick={() => simple(kind)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
            <small>Материалы и цвета · без расхода</small>
            <button disabled={busy} onClick={() => setPicker(true)}>
              <Package size={17} />
              Материал
            </button>
            <button
              draggable
              disabled={busy}
              onDragStart={(e) =>
                e.dataTransfer.setData("application/workshop-node", "palette")
              }
              onClick={() => simple("palette")}
            >
              <Palette size={17} />
              Палитра
            </button>
            <button disabled={busy} onClick={() => setFree(true)}>
              <Palette size={17} />
              Цветовой образец
            </button>
          </div>
        </details>
        <details className="board-popover board-overview">
          <summary className="button">
            <ListTree size={17} />
            Карточки <span>{graph.nodes.length}</span>
          </summary>
          <div className="board-popover-content board-overview-content">
            <label className="search">
              <Search size={17} />
              <input
                aria-label="Найти карточку на доске"
                placeholder="Название или текст…"
                value={overviewQuery}
                onChange={(e) => setOverviewQuery(e.target.value)}
              />
            </label>
            <div className="board-overview-results">
              {visibleNodes.slice(0, 50).map((node) => {
                const detail =
                  node.data.kind === "note"
                    ? node.data.text
                    : node.data.kind === "material"
                      ? node.data.material.snapshot.label
                      : node.data.kind === "palette"
                        ? node.data.colors
                            .map((c) => c.snapshot.label)
                            .join(", ")
                        : "";
                return (
                  <button
                    key={node.id}
                    onClick={(e) => {
                      locate(node.id);
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    }}
                  >
                    <span>{node.data.title || nodeLabels[node.data.kind]}</span>
                    <small>
                      {nodeLabels[node.data.kind]}
                      {detail ? " · " + detail : ""}
                    </small>
                  </button>
                );
              })}
              {!visibleNodes.length && (
                <p className="muted">Карточки не найдены.</p>
              )}
              {visibleNodes.length > 50 && (
                <p className="muted">
                  Уточните поиск, чтобы увидеть остальные.
                </p>
              )}
            </div>
          </div>
        </details>
        <span className="toolbar-divider" />
        <div className="board-history-actions">
          <button
            className="icon"
            title="Отменить · Ctrl+Z"
            aria-label="Отменить действие доски"
            disabled={!doc.canUndo || boardLocked}
            onClick={() => undo()}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon"
            title="Повторить · Ctrl+Shift+Z"
            aria-label="Повторить действие доски"
            disabled={!doc.canRedo || boardLocked}
            onClick={() => undo(true)}
          >
            <Redo2 size={17} />
          </button>
        </div>
      </div>
      {!!selected.length && (
        <div className="board-selection">
          <div className="board-selection-info">
            <strong>
              {selected.length === 1
                ? graph.nodes.find((n) => n.id === selected[0])?.data.title ||
                  "Карточка"
                : `Выбрано карточек: ${selected.length}`}
            </strong>
            <small>
              Тяните за заголовок; края выбранной карточки меняют размер.
            </small>
          </div>
          {selected.length === 1 && (
            <button onClick={() => openEditor(selected[0])}>
              Редактировать
            </button>
          )}
          <button
            onClick={() =>
              void flow.fitView({
                nodes: graph.nodes.filter((n) => selected.includes(n.id)),
                padding: 0.3,
                maxZoom: 1.25,
              })
            }
          >
            Вписать выбранное
          </button>
          <button
            onClick={() => change(duplicateNodes(current.current, selected))}
            disabled={boardLocked}
          >
            <Copy size={16} />
            Копия
          </button>
          <button
            onClick={() => change(groupNodes(current.current, selected))}
            disabled={boardLocked || selected.length === groups.length}
          >
            <Group size={16} />В группу
          </button>
          {!!groups.length && (
            <button
              onClick={() => change(ungroupNodes(current.current, groups))}
              disabled={boardLocked}
            >
              <Ungroup size={16} />
              Разгруппировать
            </button>
          )}
          <button
            aria-label="На передний план"
            title="На передний план"
            disabled={boardLocked}
            onClick={() => {
              const top =
                Math.max(0, ...graph.nodes.map((n) => n.zIndex ?? 0)) + 1;
              change({
                ...current.current,
                nodes: current.current.nodes.map((n) =>
                  selected.includes(n.id) && n.data.kind !== "group"
                    ? { ...n, zIndex: top }
                    : n,
                ),
              });
            }}
          >
            <ArrowUp size={16} />
          </button>
          <button
            aria-label="На задний план"
            title="На задний план"
            disabled={boardLocked}
            onClick={() =>
              change({
                ...current.current,
                nodes: current.current.nodes.map((n) =>
                  selected.includes(n.id) && n.data.kind !== "group"
                    ? { ...n, zIndex: 0 }
                    : n,
                ),
              })
            }
          >
            <ArrowDown size={16} />
          </button>
          <button
            className="danger-text"
            disabled={boardLocked}
            onClick={removeSelected}
          >
            <Trash2 size={16} />
            Удалить
          </button>
        </div>
      )}
      {graph.edges.some((e) => e.selected) && (
        <div className="board-selection edge-selection">
          <strong>
            Связей выбрано: {graph.edges.filter((e) => e.selected).length}
          </strong>
          <label>
            Направление{" "}
            <select
              aria-label="Направление связи"
              value={String(
                graph.edges.find((e) => e.selected)?.data?.direction ??
                  "forward",
              )}
              onChange={(e) =>
                change(
                  setEdgeDirection(
                    current.current,
                    current.current.edges
                      .filter((e) => e.selected)
                      .map((e) => e.id),
                    e.target.value as EdgeDirection,
                  ),
                )
              }
            >
              <option value="forward">От начала к концу →</option>
              <option value="reverse">К началу ←</option>
              <option value="both">В обе стороны ↔</option>
              <option value="none">Без стрелки</option>
            </select>
          </label>
          <button
            className="danger-text"
            onClick={() =>
              change({
                ...current.current,
                edges: current.current.edges.filter((e) => !e.selected),
              })
            }
          >
            <Trash2 size={16} />
            Удалить связь
          </button>
        </div>
      )}
      <div
        className="board-canvas"
        ref={root}
        tabIndex={0}
        onKeyDown={(e) => {
          if (boardLocked) return;
          const target = e.target as Element;
          if (target.closest("input,textarea,select,dialog,[contenteditable]"))
            return;
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            undo(e.shiftKey);
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
            e.preventDefault();
            if (selected.length)
              change(duplicateNodes(current.current, selected));
          }
          if (e.key === "Delete" || e.key === "Backspace") {
            if (target.closest("button,a,summary")) return;
            e.preventDefault();
            removeSelected();
          }
        }}
      >
        <BoardActions.Provider
          value={{
            edit: openEditor,
            paintFromImage,
            editingPaintId:
              editNode?.data.kind === "paint" ? editNode.id : null,
            openImage: setFull,
            addStock,
            resizeStart: doc.checkpoint,
            resizeEnd: () => {},
            toggle: (id, itemId) =>
              change({
                ...current.current,
                nodes: current.current.nodes.map((n) =>
                  n.id === id && n.data.kind === "checklist"
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          items: n.data.items.map((i) =>
                            i.id === itemId ? { ...i, done: !i.done } : i,
                          ),
                        },
                      }
                    : n,
                ),
              }),
          }}
        >
          <ReactFlow<BoardNode>
            nodes={graph.nodes.map((n) => ({
              ...n,
              dragHandle: ".board-card-heading",
              style:
                editing === n.id &&
                n.data.kind === "paint" &&
                !window.matchMedia("(max-width: 760px)").matches
                  ? {
                      ...n.style,
                      width: Math.max(Number(n.style?.width) || 0, 460),
                      height: Math.max(Number(n.style?.height) || 0, 540),
                    }
                  : n.style,
            }))}
            edges={graph.edges.map((e) => {
              const direction = e.data?.direction ?? "forward";
              const marker = {
                type: MarkerType.ArrowClosed,
                width: 22,
                height: 22,
              };
              return {
                ...e,
                interactionWidth: 28,
                markerStart:
                  direction === "reverse" || direction === "both"
                    ? marker
                    : undefined,
                markerEnd:
                  direction === "forward" || direction === "both"
                    ? marker
                    : undefined,
              };
            })}
            nodeTypes={nodeTypes}
            onNodesChange={nodeChanges}
            onEdgesChange={(changes) =>
              change(
                {
                  ...current.current,
                  edges: applyEdgeChanges(changes, current.current.edges),
                },
                false,
                changes.some((c) => c.type !== "select"),
              )
            }
            onNodeDragStart={doc.checkpoint}
            onNodeDragStop={(_, n, nodes) =>
              change(
                dropIntoGroups(
                  current.current,
                  nodes.length ? nodes.map((n) => n.id) : [n.id],
                ),
                false,
              )
            }
            onNodeDoubleClick={(_, n) => openEditor(n.id)}
            onConnect={(c) =>
              change({
                ...current.current,
                edges: addEdge(
                  {
                    ...c,
                    id: uid(),
                    type: "smoothstep",
                    data: { direction: "forward" },
                  },
                  current.current.edges,
                ),
              })
            }
            defaultViewport={graph.viewport}
            onMoveEnd={(_, viewport) => {
              if (
                JSON.stringify(viewport) !==
                JSON.stringify(current.current.viewport)
              )
                change({ ...current.current, viewport }, false);
            }}
            minZoom={0.15}
            maxZoom={2.5}
            ariaLabelConfig={{
              "controls.ariaLabel": "Управление доской",
              "controls.zoomIn.ariaLabel": "Увеличить масштаб доски",
              "controls.zoomOut.ariaLabel": "Уменьшить масштаб доски",
              "controls.fitView.ariaLabel": "Вписать все карточки",
              "controls.interactive.ariaLabel":
                "Переключить редактирование доски",
              "minimap.ariaLabel": "Обзор доски",
              "handle.ariaLabel": "Точка связи карточки",
            }}
            deleteKeyCode={null}
            multiSelectionKeyCode="Shift"
            colorMode={state.settings.theme}
            onlyRenderVisibleElements
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const point = flow.screenToFlowPosition({
                x: e.clientX,
                y: e.clientY,
              });
              if (e.dataTransfer.files.length)
                void upload(Array.from(e.dataTransfer.files), point);
              else {
                const kind = e.dataTransfer.getData(
                  "application/workshop-node",
                );
                if (
                  ["note", "checklist", "group", "palette", "link"].includes(
                    kind,
                  )
                )
                  simple(kind as "note", point);
              }
            }}
          >
            <Background
              color={state.settings.theme === "dark" ? "#444c58" : "#d5dbe6"}
              gap={24}
            />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) =>
                n.data.kind === "group" ? "#adb8c8" : "#7a9bd0"
              }
            />
          </ReactFlow>
        </BoardActions.Provider>
        {!graph.nodes.length && (
          <div className="board-empty">
            <Layers size={32} />
            <h2>Соберите образ проекта</h2>
            <p>
              Перетащите фото или добавьте заметку, палитру и материалы из
              панели выше.
            </p>
          </div>
        )}
      </div>
      <p className="board-help">
        Тяните за заголовок; края меняют размер. Shift — несколько карточек.
        Колесо над полотном и фото — масштаб, внутри длинной карточки —
        прокрутка. Пустое место — перемещение. Двойной клик — редактирование.
        Перенесите центр карточки в группу для привязки; вынесите наружу для
        отсоединения. Клик по линии — направление и удаление связи.
      </p>
      {(newPaint || editNode?.data.kind === "paint") && (
        <PaintEditor
          key={editNode?.id ?? "new-paint"}
          projectId={projectId}
          initial={editNode?.data.kind === "paint" ? editNode.data : undefined}
          inlineHostId={
            editNode?.data.kind === "paint"
              ? "paint-inline-" + editNode.id
              : undefined
          }
          onClose={() => {
            setNewPaint(false);
            setEditing(null);
            setSwitchWarning(false);
          }}
          onSave={async (data, prepared) => {
            doc.addAssets(prepared);
            const existing = current.current.nodes.find(
              (n) =>
                n.id === editNode?.id ||
                (n.data.kind === "paint" &&
                  n.data.document.id === data.document.id),
            );
            if (existing)
              change({
                ...current.current,
                nodes: current.current.nodes.map((n) =>
                  n.id === existing.id ? { ...n, data } : n,
                ),
              });
            else insert(data);
            if (!(await doc.flush()))
              throw new Error(
                "Не удалось сохранить вариант. Изменения остаются в открытой доске: повторите сохранение. Если другая вкладка меняла доску, закройте редактор и проверьте сообщение о конфликте.",
              );
            return true;
          }}
        />
      )}
      {editNode && editNode.data.kind !== "paint" && (
        <NodeEditor
          key={editNode.id}
          node={editNode}
          onClose={() => {
            setEditing(null);
            setPendingNode(null);
          }}
          onSave={(data) => {
            if (pendingNode) insert(data, pendingNode.position);
            else
              change({
                ...current.current,
                nodes: current.current.nodes.map((n) =>
                  n.id === editNode.id ? { ...n, data } : n,
                ),
              });
          }}
        />
      )}
      {picker && (
        <CatalogPicker
          onClose={() => setPicker(false)}
          onPick={(c) => {
            insert({
              kind: "material",
              title: "Материал",
              material: c.reference,
            });
            setPicker(false);
          }}
        />
      )}
      {material && (
        <MaterialForm
          initial={material.draft}
          onClose={() => setMaterial(null)}
          onSaved={(m) => {
            const { ref, nodeId } = material;
            change({
              ...current.current,
              nodes: current.current.nodes.map((n) =>
                n.id === nodeId && n.data.kind === "material"
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        material: { ...ref, inventoryMaterialId: m.id },
                      },
                    }
                  : n,
              ),
            });
          }}
        />
      )}
      {free && (
        <Modal title="Своя смесь / материал" onClose={() => setFree(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              insert({
                kind: "material",
                title: "Своя смесь",
                material: {
                  snapshot: { label: freeName.trim(), colorHex: freeColor },
                },
              });
              setFree(false);
              setFreeName("");
            }}
          >
            <Field label="Название или пожелание">
              <input
                required
                value={freeName}
                onChange={(e) => setFreeName(e.target.value)}
              />
            </Field>
            <Field label="Примерный цвет">
              <input
                type="color"
                value={freeColor}
                onChange={(e) => setFreeColor(e.target.value)}
              />
            </Field>
            <div className="modal-actions">
              <button className="primary" disabled={!freeName.trim()}>
                Добавить карточку
              </button>
            </div>
          </form>
        </Modal>
      )}
      {full && (
        <Modal title={full.caption} onClose={() => setFull(null)} wide>
          <div className="full-photo">
            <Photo asset={full} full />
          </div>
          <button
            onClick={() =>
              void act(
                () => updateAssetMeta(full.id, { cover: true }),
                "Обложка обновлена",
              )
            }
          >
            Сделать обложкой проекта
          </button>
        </Modal>
      )}
      {filesOpen && (
        <Modal
          title="Файлы этого проекта"
          onClose={() => setFilesOpen(false)}
          wide
        >
          <p className="muted">
            После удаления карточки файл остаётся здесь. Используемые фото
            защищены от удаления.
          </p>
          <Paged className="photo-grid">
            {assets
              .filter(
                (a) =>
                  a.projectId === projectId && !a.purpose?.startsWith("paint-"),
              )
              .map((a) => (
                <article className="photo-card" key={a.id}>
                  <button className="photo-open" onClick={() => setFull(a)}>
                    <Photo asset={a} />
                  </button>
                  <strong>{a.caption}</strong>
                  <div className="actions">
                    <button
                      onClick={() => {
                        insert({
                          kind: "image",
                          title: a.caption,
                          assetId: a.id,
                        });
                        setFilesOpen(false);
                      }}
                    >
                      На доску
                    </button>
                    <button
                      onClick={() =>
                        void act(
                          () => updateAssetMeta(a.id, { cover: !a.cover }),
                          "Обложка обновлена",
                        )
                      }
                    >
                      {a.cover ? "Убрать обложку" : "Обложка"}
                    </button>
                    <button
                      className="icon danger-text"
                      aria-label="Удалить файл"
                      onClick={() =>
                        confirm(
                          "Удалить файл?",
                          "Нужна резервная копия для восстановления. Используемые файлы защищены.",
                          () => removeAsset(a.id),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
          </Paged>
        </Modal>
      )}
    </div>
  );
}
