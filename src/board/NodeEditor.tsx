import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, Modal } from "../components/ui";
import { safeUrl, type BoardNode, type BoardData } from "../domain/workspace";
import { uid } from "../domain/model";
import { CatalogPicker } from "../catalog/CatalogPicker";
import { nodeLabels } from "./BoardCard";
export function NodeEditor({
  node,
  onSave,
  onClose,
}: {
  node: BoardNode;
  onSave: (data: BoardData) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<BoardData>(structuredClone(node.data)),
    [picker, setPicker] = useState(false),
    [text, setText] = useState(""),
    [freeLabel, setFreeLabel] = useState(""),
    [freeColor, setFreeColor] = useState("#b18a60");
  const addItem = () => {
    if (data.kind === "checklist" && text.trim()) {
      setData({
        ...data,
        items: [...data.items, { id: uid(), text: text.trim(), done: false }],
      });
      setText("");
    }
  };
  return (
    <Modal title={nodeLabels[data.kind]} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (data.kind === "link" && !safeUrl(data.url)) return;
          onSave(data);
          onClose();
        }}
      >
        <Field label="Заголовок">
          <input
            value={data.title}
            onChange={(e) => setData({ ...data, title: e.target.value })}
          />
        </Field>
        {data.kind === "note" && (
          <Field label="Текст">
            <textarea
              rows={7}
              value={data.text}
              onChange={(e) => setData({ ...data, text: e.target.value })}
            />
          </Field>
        )}
        {(data.kind === "note" || data.kind === "group") && (
          <Field label="Цвет акцента">
            <input
              type="color"
              value={data.color ?? "#bc9257"}
              onChange={(e) => setData({ ...data, color: e.target.value })}
            />
          </Field>
        )}
        {data.kind === "link" && (
          <>
            <Field label="Ссылка (http / https)">
              <input
                required
                type="url"
                value={data.url}
                onChange={(e) => setData({ ...data, url: e.target.value })}
              />
            </Field>
            {data.url && !safeUrl(data.url) && (
              <p className="warning-text">Нужна ссылка http:// или https://</p>
            )}
          </>
        )}
        {data.kind === "checklist" && (
          <>
            <div className="task-add">
              <input
                aria-label="Пункт чек-листа"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addItem();
                  }
                }}
              />
              <button type="button" disabled={!text.trim()} onClick={addItem}>
                <Plus size={16} />
              </button>
            </div>
            {data.items.map((item) => (
              <div className="task-row" key={item.id}>
                <input
                  aria-label="Текст пункта"
                  value={item.text}
                  onChange={(e) =>
                    setData({
                      ...data,
                      items: data.items.map((i) =>
                        i.id === item.id ? { ...i, text: e.target.value } : i,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="icon"
                  aria-label="Удалить пункт"
                  onClick={() =>
                    setData({
                      ...data,
                      items: data.items.filter((i) => i.id !== item.id),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </>
        )}
        {data.kind === "material" && (
          <>
            <p>{data.material.snapshot.label}</p>
            <button type="button" onClick={() => setPicker(true)}>
              Заменить материал
            </button>
            <Field label="Заметка / назначение">
              <textarea
                value={data.material.comment ?? ""}
                onChange={(e) =>
                  setData({
                    ...data,
                    material: { ...data.material, comment: e.target.value },
                  })
                }
              />
            </Field>
          </>
        )}
        {data.kind === "palette" && (
          <>
            <button type="button" onClick={() => setPicker(true)}>
              <Plus size={16} />
              Из каталога / склада
            </button>
            <div className="palette-editor">
              {data.colors.map((r, i) => (
                <div className="task-row" key={i}>
                  <span
                    className="swatch"
                    style={{ background: r.snapshot.colorHex }}
                  />
                  <span>{r.snapshot.label}</span>
                  <button
                    type="button"
                    className="icon"
                    aria-label="Убрать цвет"
                    onClick={() =>
                      setData({
                        ...data,
                        colors: data.colors.filter((_, j) => i !== j),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <details>
              <summary>Свой цвет или смесь</summary>
              <Field label="Подпись">
                <input
                  value={freeLabel}
                  onChange={(e) => setFreeLabel(e.target.value)}
                />
              </Field>
              <input
                aria-label="Свой цвет"
                type="color"
                value={freeColor}
                onChange={(e) => setFreeColor(e.target.value)}
              />
              <button
                type="button"
                disabled={!freeLabel.trim()}
                onClick={() => {
                  setData({
                    ...data,
                    colors: [
                      ...data.colors,
                      {
                        snapshot: {
                          label: freeLabel.trim(),
                          colorHex: freeColor,
                        },
                      },
                    ],
                  });
                  setFreeLabel("");
                }}
              >
                Добавить цвет
              </button>
            </details>
          </>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button
            className="primary"
            disabled={
              (data.kind === "link" && !safeUrl(data.url)) ||
              (data.kind === "checklist" &&
                data.items.some((i) => !i.text.trim()))
            }
          >
            Применить
          </button>
        </div>
      </form>
      {picker && (
        <CatalogPicker
          onClose={() => setPicker(false)}
          onPick={(c) => {
            if (data.kind === "material")
              setData({ ...data, material: c.reference });
            if (data.kind === "palette")
              setData({ ...data, colors: [...data.colors, c.reference] });
            setPicker(false);
          }}
        />
      )}
    </Modal>
  );
}
