import { createContext, useContext, memo, type CSSProperties } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import {
  Pencil,
  Image,
  StickyNote,
  CheckSquare,
  Layers,
  Palette,
  Package,
  ExternalLink,
  Maximize2,
} from "lucide-react";
import { useApp } from "../components/context";
import { Photo, Badge, qty } from "../components/ui";
import { units, type AssetMeta } from "../domain/model";
import {
  safeUrl,
  type BoardNode,
  type MaterialReference,
} from "../domain/workspace";
import { stock } from "../domain/engine";
export const BoardActions = createContext<{
  edit: (id: string) => void;
  toggle: (id: string, itemId: string) => void;
  openImage: (a: AssetMeta) => void;
  addStock: (r: MaterialReference) => void;
  resizeStart: () => void;
  resizeEnd: () => void;
}>(null!);
export const nodeLabels = {
  image: "Изображение",
  paint: "Перекраска",
  note: "Заметка",
  checklist: "Чек-лист",
  group: "Группа",
  material: "Материал",
  palette: "Палитра",
  link: "Ссылка",
};
const icons = {
  image: Image,
  paint: Palette,
  note: StickyNote,
  checklist: CheckSquare,
  group: Layers,
  material: Package,
  palette: Palette,
  link: ExternalLink,
};
function MaterialContent({ reference: r }: { reference: MaterialReference }) {
  const { state } = useApp(),
    actions = useContext(BoardActions);
  const materials = r.inventoryMaterialId
    ? state.materials.filter((m) => m.id === r.inventoryMaterialId)
    : state.materials.filter(
        (m) => !!r.productId && m.productId === r.productId && !m.archived,
      );
  return (
    <>
      <div className="board-material-summary">
        {r.snapshot.colorHex && (
          <span
            className="swatch large"
            style={{ background: r.snapshot.colorHex }}
          />
        )}
        <strong>{r.snapshot.label}</strong>
      </div>
      {r.snapshot.sku && <small>Артикул: {r.snapshot.sku}</small>}
      {materials.length ? (
        materials.map((m) => (
          <div className="board-stock" key={m.id}>
            <Badge
              tone={
                stock(state, m.id).available > m.minimum ? "success" : "warning"
              }
            >
              {m.archived
                ? "В архиве"
                : `Доступно: ${qty(stock(state, m.id).available)} ${units[m.unit]}`}
            </Badge>
            <button
              onClick={() =>
                actions.addStock({ ...r, inventoryMaterialId: m.id })
              }
            >
              Открыть материал
            </button>
          </div>
        ))
      ) : (
        <>
          <Badge>Нет на складе</Badge>
          <button className="nodrag" onClick={() => actions.addStock(r)}>
            Добавить в материалы
          </button>
        </>
      )}
      {r.comment && <p className="prewrap">{r.comment}</p>}
    </>
  );
}
export const BoardCard = memo(function BoardCard({
  id,
  data,
  selected,
}: NodeProps<BoardNode>) {
  const { assets } = useApp(),
    actions = useContext(BoardActions),
    Icon = icons[data.kind];
  const asset =
    data.kind === "image"
      ? assets.find((a) => a.id === data.assetId)
      : data.kind === "paint"
        ? assets.find(
            (a) =>
              a.id ===
              (data.document.previewAssetId || data.document.sourceAssetId),
          )
        : undefined;
  return (
    <article
      className={"board-card board-" + data.kind}
      style={
        (data.kind === "note" || data.kind === "group") && data.color
          ? ({ "--card-accent": data.color } as CSSProperties)
          : undefined
      }
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={220}
        minHeight={160}
        onResizeStart={actions.resizeStart}
        onResizeEnd={actions.resizeEnd}
      />
      <div className="board-card-heading">
        <Icon size={17} />
        <strong>{data.title || nodeLabels[data.kind]}</strong>
        <button
          className="icon ghost nodrag"
          aria-label={"Редактировать: " + nodeLabels[data.kind]}
          onClick={() => actions.edit(id)}
        >
          <Pencil size={15} />
        </button>
      </div>
      {data.kind !== "group" && (
        <div className="board-card-body nodrag nowheel">
          {data.kind === "paint" && (
            <>
              <button
                className="board-image-open"
                onClick={() => actions.edit(id)}
              >
                {asset ? (
                  <Photo asset={asset} />
                ) : (
                  <span>Подготовка изображения…</span>
                )}
              </button>
              <button onClick={() => actions.edit(id)}>
                Редактировать окраску
              </button>
              <small>
                {data.document.layers.length} слоёв · оригинал сохранён
              </small>
            </>
          )}
          {data.kind === "image" &&
            (asset ? (
              <>
                <button
                  className="board-image-open"
                  onClick={() => actions.openImage(asset)}
                >
                  <Photo asset={asset} />
                  <span>
                    <Maximize2 size={15} />
                    Открыть оригинал
                  </span>
                </button>
                {asset.cover && <small>Обложка проекта</small>}
              </>
            ) : (
              <p>Изображение не найдено</p>
            ))}
          {data.kind === "note" && (
            <p className="prewrap">
              {data.text || "Двойной клик, чтобы записать идею"}
            </p>
          )}
          {data.kind === "checklist" && (
            <>
              {!data.items.length && (
                <p className="muted">Добавьте пункты через карандаш.</p>
              )}
              {data.items.map((i) => (
                <label className={"check " + (i.done ? "done" : "")} key={i.id}>
                  <input
                    type="checkbox"
                    checked={i.done}
                    onChange={() => actions.toggle(id, i.id)}
                  />
                  <span>{i.text}</span>
                </label>
              ))}
              <small>
                {data.items.filter((i) => i.done).length} / {data.items.length}{" "}
                выполнено
              </small>
            </>
          )}
          {data.kind === "material" && (
            <MaterialContent reference={data.material} />
          )}{" "}
          {data.kind === "palette" && (
            <div className="board-palette-grid">
              {data.colors.map((r, i) => (
                <div key={i}>
                  <span
                    className="palette-swatch"
                    style={{ background: r.snapshot.colorHex ?? "transparent" }}
                  />
                  <span>{r.snapshot.label}</span>
                </div>
              ))}
              {!data.colors.length && (
                <p className="muted">Добавьте цвета и материалы.</p>
              )}
            </div>
          )}
          {data.kind === "link" && safeUrl(data.url) && (
            <a
              href={safeUrl(data.url)!}
              target="_blank"
              rel="noopener noreferrer"
            >
              {data.url}
              <ExternalLink size={15} />
            </a>
          )}
        </div>
      )}
      {data.kind !== "group" && (
        <>
          <Handle type="target" position={Position.Left} />
          <Handle type="source" position={Position.Right} />
        </>
      )}
    </article>
  );
});
