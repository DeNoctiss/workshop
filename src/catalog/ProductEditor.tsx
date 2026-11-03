import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useApp } from "../components/context";
import { Field, Modal, Num } from "../components/ui";
import {
  categories,
  units,
  uid,
  now,
  type Category,
  type Unit,
} from "../domain/model";
import type { CatalogProduct, ProductProperties } from "../domain/workspace";
import { mutate } from "../data/db";
import { newProduct, propertyFields, defaultUnit } from "./catalog";
export function ProductEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial?: CatalogProduct;
  onClose: () => void;
  onSaved?: (p: CatalogProduct) => void;
}) {
  const { state, act, busy } = useApp();
  const [p, setP] = useState(() => structuredClone(initial ?? newProduct())),
    [revision] = useState(state.revision);
  const patch = (part: Partial<CatalogProduct>) => setP({ ...p, ...part });
  return (
    <Modal
      title={initial ? "Редактировать свой товар" : "Создать свой товар"}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const next = { ...p, name: p.name.trim(), updatedAt: now() };
          if (
            await act(
              () =>
                mutate((s) => {
                  const i = s.userProducts.findIndex((x) => x.id === p.id);
                  if (i < 0) s.userProducts.push(next);
                  else s.userProducts[i] = next;
                }, revision),
              "Товар сохранён в личный каталог",
            )
          ) {
            onSaved?.(next);
            onClose();
          }
        }}
      >
        <p className="muted">
          Товар сохраняется независимо от склада. Цену и остаток задайте при
          покупке.
        </p>
        <div className="form-grid">
          <Field label="Название">
            <input
              required
              value={p.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="Категория">
            <select
              value={p.category}
              onChange={(e) => {
                const c = e.target.value as Category;
                patch({
                  category: c,
                  properties: { kind: c } as ProductProperties,
                });
              }}
            >
              {Object.entries(categories).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {(["brand", "series", "sku", "colorName"] as const).map((k, i) => (
            <Field
              key={k}
              label={
                [
                  "Бренд (необязательно)",
                  "Линейка",
                  "Артикул / SKU",
                  "Название цвета",
                ][i]
              }
            >
              <input
                value={p[k] ?? ""}
                onChange={(e) => patch({ [k]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <Field label="Другие названия для поиска, через запятую">
          <input
            value={p.aliases.join(",")}
            onChange={(e) => patch({ aliases: e.target.value.split(",") })}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={p.colorHex !== undefined}
            onChange={(e) =>
              patch({ colorHex: e.target.checked ? "#78857b" : undefined })
            }
          />
          Указать примерный цвет
        </label>
        {p.colorHex !== undefined && (
          <div className="color-editor">
            <input
              aria-label="Выбор цвета"
              type="color"
              value={
                /^#[0-9a-f]{6}$/i.test(p.colorHex) ? p.colorHex : "#78857b"
              }
              onChange={(e) => patch({ colorHex: e.target.value })}
            />
            <Field label="HEX (ориентир)">
              <input
                pattern="#[0-9a-fA-F]{6}"
                value={p.colorHex}
                onChange={(e) => patch({ colorHex: e.target.value })}
              />
            </Field>
          </div>
        )}
        <details className="form-section" open>
          <summary>Свойства — неизвестные можно оставить пустыми</summary>
          <div className="form-grid">
            {propertyFields[p.category].map((f) => (
              <Field key={f.key} label={f.label}>
                <input
                  type={f.numeric ? "number" : "text"}
                  min={0}
                  step="any"
                  value={String(
                    (p.properties as unknown as Record<string, unknown>)[
                      f.key
                    ] ?? "",
                  )}
                  onChange={(e) => {
                    const props = { ...p.properties } as Record<
                      string,
                      unknown
                    >;
                    if (!e.target.value) delete props[f.key];
                    else
                      props[f.key] = f.numeric
                        ? Number(e.target.value)
                        : e.target.value;
                    patch({ properties: props as ProductProperties });
                  }}
                />
              </Field>
            ))}
          </div>
        </details>
        <section className="form-section">
          <div className="section-head">
            <h3>Варианты упаковки</h3>
            <button
              type="button"
              onClick={() =>
                patch({
                  packages: [
                    ...p.packages,
                    {
                      id: uid(),
                      label: "",
                      qty: 1,
                      unit: defaultUnit(p.category),
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              Упаковка
            </button>
          </div>
          {p.packages.map((pack) => (
            <div className="package-row" key={pack.id}>
              <Field label="Подпись">
                <input
                  value={pack.label}
                  onChange={(e) =>
                    patch({
                      packages: p.packages.map((x) =>
                        x.id === pack.id ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="Количество">
                <Num
                  min={0.001}
                  value={pack.qty}
                  onChange={(qty) =>
                    patch({
                      packages: p.packages.map((x) =>
                        x.id === pack.id ? { ...x, qty } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="Единица">
                <select
                  value={pack.unit}
                  onChange={(e) =>
                    patch({
                      packages: p.packages.map((x) =>
                        x.id === pack.id
                          ? { ...x, unit: e.target.value as Unit }
                          : x,
                      ),
                    })
                  }
                >
                  {Object.entries(units).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="icon"
                aria-label="Удалить упаковку"
                onClick={() =>
                  patch({
                    packages: p.packages.filter((x) => x.id !== pack.id),
                  })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </section>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy || !p.name.trim()}>
            Сохранить товар
          </button>
        </div>
      </form>
    </Modal>
  );
}
