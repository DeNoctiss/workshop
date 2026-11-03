import { CatalogPicker } from "../catalog/CatalogPicker";
import { MaterialForm } from "./Materials";
import { newMaterial } from "../catalog/catalog";
import { saveNote } from "../domain/workflow";
import type { Material } from "../domain/model";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useApp } from "../components/context";
import { Modal, Field, Num } from "../components/ui";
import {
  uid,
  now,
  units,
  sources,
  type Project,
  type Source,
} from "../domain/model";
import { mutate } from "../data/db";
export function ProjectForm({
  initial,
  onClose,
}: {
  initial: Project;
  onClose: () => void;
}) {
  const { state, act } = useApp();
  const [openedAt] = useState(initial.updatedAt);
  const [p, setP] = useState(structuredClone(initial)),
    [picker, setPicker] = useState<string | null>(null),
    [newStock, setNewStock] = useState<{
      material: Material;
      itemId: string;
    } | null>(null);
  const patch = (part: Partial<Project>) => setP({ ...p, ...part });
  const materialOptions = state.materials.filter((m) => !m.archived);
  const printers = state.printers.filter(
    (x) => x.active && x.technology === p.technology,
  );
  return (
    <Modal
      title={initial.title ? "Рецепт изделия" : "Новое изделие"}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act(
              () =>
                mutate((s) => {
                  const latest = s.projects.find((x) => x.id === p.id);
                  if (latest && latest.updatedAt !== openedAt)
                    throw new Error(
                      "Рецепт изменён в другой вкладке. Откройте форму заново.",
                    );
                  const next = { ...p, updatedAt: now() };
                  const i = s.projects.findIndex((x) => x.id === p.id);
                  if (i < 0) {
                    s.projects.push(next);
                    if (p.notes.trim()) saveNote(s, "project", p.id, p.notes);
                  } else s.projects[i] = next;
                }),
              "Рецепт сохранён",
            )
          ) {
            onClose();
            location.hash = "/projects/" + p.id;
          }
        }}
      >
        <div className="form-grid">
          <Field label="Название">
            <input
              required
              value={p.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          <Field label="Размер / масштаб">
            <input
              value={p.size}
              onChange={(e) => patch({ size: e.target.value })}
            />
          </Field>
          <Field label="Технология">
            <select
              value={p.technology}
              onChange={(e) =>
                patch({
                  technology: e.target.value as "FDM" | "SLA",
                  printerId: "",
                })
              }
            >
              <option>FDM</option>
              <option>SLA</option>
            </select>
          </Field>
          <Field label="Принтер по умолчанию">
            <select
              value={p.printerId}
              onChange={(e) => patch({ printerId: e.target.value })}
            >
              <option value="">Не выбран</option>
              {printers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Описание">
          <textarea
            value={p.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
        <Field label="Теги, через запятую">
          <input
            value={p.tags.join(",")}
            onChange={(e) => patch({ tags: e.target.value.split(",") })}
          />
        </Field>
        <section className="form-section">
          <div className="section-head">
            <h2>Расходные материалы</h2>
            <button
              type="button"
              onClick={() =>
                patch({
                  items: [
                    ...p.items,
                    {
                      id: uid(),
                      materialId: materialOptions[0]?.id || "",
                      qty: 0,
                      scope: "unit",
                      source: "estimated",
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              Материал
            </button>
          </div>
          <p className="muted">
            Вес из слайсера указывайте вместе с поддержками, продувкой AMS и
            отходами. Расход на партию не умножается на экземпляры.
          </p>
          {!p.items.length && <p>Добавьте конкретные материалы со склада.</p>}
          {p.items.map((i, index) => {
            const change = (v: Partial<typeof i>) =>
              patch({
                items: p.items.map((x) => (x.id === i.id ? { ...x, ...v } : x)),
              });
            const m = state.materials.find((x) => x.id === i.materialId);
            return (
              <div className="recipe-row" key={i.id}>
                <Field label="Материал">
                  <button
                    type="button"
                    className="material-picker-button"
                    onClick={() => setPicker(i.id)}
                  >
                    {m ? `${m.brand} ${m.name}` : "Выбрать материал…"}
                  </button>
                </Field>
                <Field label={`Расход, ${m ? units[m.unit] : "ед."}`}>
                  <Num value={i.qty} onChange={(v) => change({ qty: v })} />
                </Field>
                <Field label="Расчёт">
                  <select
                    value={i.scope}
                    onChange={(e) =>
                      change({ scope: e.target.value as "unit" | "batch" })
                    }
                  >
                    <option value="unit">На экземпляр</option>
                    <option value="batch">На всю партию</option>
                  </select>
                </Field>
                <Field label="Источник">
                  <select
                    value={i.source}
                    onChange={(e) =>
                      change({ source: e.target.value as Source })
                    }
                  >
                    {Object.entries(sources)
                      .filter(([k]) => !["plan", "inventory"].includes(k))
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                  </select>
                </Field>
                <button
                  type="button"
                  className="icon danger-text"
                  aria-label={"Удалить материал " + (index + 1)}
                  onClick={() =>
                    patch({ items: p.items.filter((x) => x.id !== i.id) })
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
            );
          })}
        </section>
        <section className="form-section">
          <div className="section-head">
            <h2>Смеси красок</h2>
            <button
              type="button"
              onClick={() =>
                patch({
                  mixes: [
                    ...p.mixes,
                    {
                      id: uid(),
                      name: "Новая смесь",
                      volume: 2,
                      lossPercent: 0,
                      components: [
                        { materialId: "", share: 75 },
                        { materialId: "", share: 25 },
                      ],
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              Смесь
            </button>
          </div>
          <p className="muted">
            Доли нормализуются автоматически. На складе учитываются только
            компоненты — без повторного списания смеси.
          </p>
          {p.mixes.map((m) => {
            const change = (v: Partial<typeof m>) =>
              patch({
                mixes: p.mixes.map((x) => (x.id === m.id ? { ...x, ...v } : x)),
              });
            return (
              <div className="mix-editor" key={m.id}>
                <div className="form-grid three">
                  <Field label="Название">
                    <input
                      required
                      value={m.name}
                      onChange={(e) => change({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Объём на 1 шт., мл">
                    <Num
                      value={m.volume}
                      onChange={(v) => change({ volume: v })}
                    />
                  </Field>
                  <Field label="Потери, %">
                    <Num
                      value={m.lossPercent}
                      onChange={(v) => change({ lossPercent: v })}
                    />
                  </Field>
                </div>
                {m.components.map((c, i) => (
                  <div className="component-row" key={i}>
                    <select
                      aria-label={"Компонент " + (i + 1)}
                      required
                      value={c.materialId}
                      onChange={(e) =>
                        change({
                          components: m.components.map((x, j) =>
                            j === i ? { ...x, materialId: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      <option value="">Выберите краску</option>
                      {materialOptions
                        .filter((x) => x.unit === "ml")
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.brand} {x.code} {x.name}
                          </option>
                        ))}
                    </select>
                    <Num
                      label={"Доля " + (i + 1)}
                      value={c.share}
                      onChange={(v) =>
                        change({
                          components: m.components.map((x, j) =>
                            j === i ? { ...x, share: v } : x,
                          ),
                        })
                      }
                    />
                    <span>долей</span>
                    <button
                      type="button"
                      className="icon"
                      aria-label={"Удалить компонент " + (i + 1)}
                      onClick={() =>
                        change({
                          components: m.components.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <div className="actions">
                  <button
                    type="button"
                    onClick={() =>
                      change({
                        components: [
                          ...m.components,
                          { materialId: "", share: 0 },
                        ],
                      })
                    }
                  >
                    Добавить компонент
                  </button>
                  <button
                    type="button"
                    className="danger-text"
                    onClick={() =>
                      patch({ mixes: p.mixes.filter((x) => x.id !== m.id) })
                    }
                  >
                    Удалить смесь
                  </button>
                </div>
              </div>
            );
          })}
        </section>
        <section className="form-section">
          <h2>Время и дополнительные затраты на 1 шт.</h2>
          <div className="form-grid">
            {(["hours", "laborHours", "laborRate", "extra"] as const).map(
              (k, i) => (
                <Field
                  key={k}
                  label={
                    [
                      "Печать, ч",
                      "Ручная работа, ч",
                      "Ставка работы, ₽ / ч",
                      "Прочие расходы, ₽",
                    ][i]
                  }
                >
                  <Num
                    value={p[k] / (i > 1 ? 100 : 1)}
                    onChange={(v) =>
                      patch({ [k]: i > 1 ? Math.round(v * 100) : v })
                    }
                  />
                </Field>
              ),
            )}
          </div>
          <details>
            <summary>Оценки для других принтеров</summary>
            <p>
              Коэффициент меняет только филамент/смолу. Краски и упаковка не
              масштабируются.
            </p>
            {p.profiles.map((f, i) => (
              <div className="form-grid three" key={i}>
                <Field label="Принтер">
                  <select
                    value={f.printerId}
                    onChange={(e) =>
                      patch({
                        profiles: p.profiles.map((x, j) =>
                          j === i ? { ...x, printerId: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    <option value="">Выберите</option>
                    {printers.map((x) => (
                      <option value={x.id} key={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Часы на экземпляр">
                  <Num
                    value={f.hours}
                    onChange={(v) =>
                      patch({
                        profiles: p.profiles.map((x, j) =>
                          j === i ? { ...x, hours: v } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Коэффициент материала">
                  <Num
                    value={f.factor}
                    onChange={(v) =>
                      patch({
                        profiles: p.profiles.map((x, j) =>
                          j === i ? { ...x, factor: v } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <button
                  type="button"
                  onClick={() =>
                    patch({ profiles: p.profiles.filter((_, j) => j !== i) })
                  }
                >
                  Удалить профиль
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                patch({
                  profiles: [
                    ...p.profiles,
                    {
                      printerId: printers[0]?.id || "",
                      hours: p.hours,
                      factor: 1,
                    },
                  ],
                })
              }
            >
              Добавить профиль
            </button>
          </details>
        </section>
        {!state.projects.some((x) => x.id === p.id) && (
          <Field label="Первая заметка проекта">
            <textarea
              value={p.notes}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </Field>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary">Сохранить рецепт</button>
        </div>
      </form>
      {picker && (
        <CatalogPicker
          onClose={() => setPicker(null)}
          onPick={(c) => {
            const m =
              c.material ??
              state.materials.find(
                (m) => !m.archived && m.productId === c.product?.id,
              );
            if (m)
              patch({
                items: p.items.map((x) =>
                  x.id === picker ? { ...x, materialId: m.id } : x,
                ),
              });
            else
              setNewStock({ material: newMaterial(c.product), itemId: picker });
            setPicker(null);
          }}
        />
      )}
      {newStock && (
        <MaterialForm
          initial={newStock.material}
          onClose={() => setNewStock(null)}
          onSaved={(m) =>
            patch({
              items: p.items.map((x) =>
                x.id === newStock.itemId ? { ...x, materialId: m.id } : x,
              ),
            })
          }
        />
      )}
    </Modal>
  );
}
