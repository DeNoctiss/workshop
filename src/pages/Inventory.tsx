import { useEffect, useState } from "react";
import { Search, ClipboardCheck, Check } from "lucide-react";
import { useApp } from "../components/context";
import {
  Header,
  Field,
  qty,
  date,
  Modal,
  Badge,
  Empty,
} from "../components/ui";
import { PagedTable } from "../components/Paged";
import { MaterialIdentity } from "../components/StockStatus";
import { categories, units } from "../domain/model";
import { stock } from "../domain/engine";
import { applyStocktake, type StockCount } from "../domain/inventory";
import { mutate } from "../data/db";
type Draft = Record<
  string,
  { text: string; expectedPhysical: number; method: string }
>;
const draftKey = "masterskaya-stocktake-v1";
export function Inventory() {
  const { state, act, busy } = useApp();
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) || "{}");
    } catch {
      return {};
    }
  });
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [filter, setFilter] = useState("all"),
    [editingId, setEditingId] = useState<string | null>(null),
    [review, setReview] = useState(false),
    [comment, setComment] = useState("");
  useEffect(() => {
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
  }, [draft]);
  const all = state.materials.filter((m) => !m.archived);
  const counts: StockCount[] = all
    .filter((m) => draft[m.id]?.text.trim())
    .map((m) => ({
      materialId: m.id,
      physical: Number(draft[m.id].text.replace(",", ".")),
      expectedPhysical: draft[m.id].expectedPhysical,
      method: draft[m.id].method,
    }));
  const differences = counts.filter(
    (c) => Math.abs(c.physical - c.expectedPhysical) > 0.0005,
  );
  const items = all.filter(
    (m) =>
      (!category || m.category === category) &&
      `${m.name} ${m.brand} ${m.code}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "pending"
          ? !draft[m.id]?.text
          : filter === "checked"
            ? !!draft[m.id]?.text
            : differences.some((c) => c.materialId === m.id))),
  );
  const fill = (id: string, text: string, method = "Измерено") =>
    setDraft((old) => ({
      ...old,
      [id]: {
        text,
        method,
        expectedPhysical:
          old[id]?.expectedPhysical ?? stock(state, id).physical,
      },
    }));
  const clear = (id: string) =>
    setDraft((old) => {
      const next = { ...old };
      delete next[id];
      return next;
    });
  return (
    <>
      <Header
        title="Инвентаризация"
        description="Пересчитайте запасы, сравните с учётом и подтвердите расхождения."
      >
        <a className="button" href="#/materials">
          Открыть склад
        </a>
      </Header>
      <section className="stocktake-summary panel">
        <ClipboardCheck size={28} />
        <div>
          <strong>
            Проверено {counts.length} из {all.length}
          </strong>
          <p>
            {differences.length} с расхождениями · Последняя полная сверка:{" "}
            {state.settings.inventoryAt
              ? date(state.settings.inventoryAt)
              : "ещё не проводилась"}
          </p>
        </div>
        <progress value={counts.length} max={all.length || 1} />
        <button
          className="primary"
          disabled={!counts.length || busy}
          onClick={() => setReview(true)}
        >
          Проверить и сохранить
        </button>
      </section>
      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти материал для сверки…"
          />
        </div>
        <select
          aria-label="Категория"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Все категории</option>
          {Object.entries(categories).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="Статус сверки"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="pending">Не проверены</option>
          <option value="checked">Проверены</option>
          <option value="different">С расхождениями</option>
          <option value="all">Все материалы</option>
        </select>
      </div>
      <p className="muted">
        Вводите весь физический остаток, включая зарезервированное. Черновик
        сохраняется в этой вкладке. Изменения склада применятся после
        подтверждения.
      </p>
      {!items.length ? (
        <Empty
          title={
            counts.length === all.length && all.length
              ? "Все материалы проверены"
              : "Нет материалов в этом списке"
          }
        >
          <button onClick={() => setFilter("all")}>Показать все</button>
        </Empty>
      ) : (
        <PagedTable
          className="stocktake-table"
          head={
            <>
              {" "}
              <tr>
                <th>Материал</th>
                <th>По учёту / резерв</th>
                <th>Фактически</th>
                <th>Проверка</th>
              </tr>{" "}
            </>
          }
        >
          {" "}
          {items.map((m) => {
            const v = stock(state, m.id),
              d = draft[m.id],
              value = d?.text ? Number(d.text.replace(",", ".")) : null;
            return (
              <tr key={m.id}>
                <td>
                  <MaterialIdentity material={m} />
                </td>
                <td>
                  <strong>
                    {qty(v.physical)} {units[m.unit]}
                  </strong>
                  <small>Резерв: {qty(v.reserved)}</small>
                </td>
                <td>
                  <input
                    aria-label={"Факт: " + m.name}
                    type="text"
                    inputMode="decimal"
                    onFocus={() => setEditingId(m.id)}
                    onBlur={() => setEditingId(null)}
                    value={d?.text ?? ""}
                    placeholder={units[m.unit]}
                    onChange={(e) => fill(m.id, e.target.value)}
                  />
                  <div className="count-shortcuts">
                    <button onClick={() => fill(m.id, String(v.physical))}>
                      <Check size={14} />
                      Совпадает
                    </button>
                    <button onClick={() => fill(m.id, "0")}>Пусто</button>
                    <button
                      onClick={() =>
                        fill(m.id, String(m.packageQty / 2), "Доля упаковки")
                      }
                    >
                      ½ упаковки
                    </button>
                  </div>
                </td>
                <td>
                  {value !== null ? (
                    <>
                      <Badge
                        tone={
                          !Number.isFinite(value) || value < 0
                            ? "danger"
                            : Math.abs(value - v.physical) < 0.0005
                              ? "success"
                              : "warning"
                        }
                      >
                        {!Number.isFinite(value) || value < 0
                          ? "Проверьте число"
                          : Math.abs(value - v.physical) < 0.0005
                            ? "Совпадает"
                            : `Разница: ${value > v.physical ? "+" : ""}${qty(value - v.physical)} ${units[m.unit]}`}
                      </Badge>
                      {v.physical !== d.expectedPhysical && (
                        <p className="danger-text">
                          Учёт изменился. Пересчитайте.
                        </p>
                      )}
                      <button className="ghost" onClick={() => clear(m.id)}>
                        Сбросить
                      </button>
                    </>
                  ) : (
                    <span className="muted">Не проверен</span>
                  )}
                </td>
              </tr>
            );
          })}{" "}
        </PagedTable>
      )}
      {review && (
        <Modal
          title="Подтверждение сверки"
          wide
          onClose={() => setReview(false)}
        >
          <p>
            Проверено {counts.length} из {all.length}. Расхождения будут
            записаны в историю материалов. Резервы и прошлые производства
            сохранятся.
          </p>
          {counts.length < all.length && (
            <p className="muted">
              Это частичная сверка: дата полной инвентаризации пока не
              изменится.
            </p>
          )}
          <PagedTable
            head={
              <>
                {" "}
                <tr>
                  <th>Материал</th>
                  <th>Было</th>
                  <th>Факт</th>
                  <th>Разница</th>
                </tr>{" "}
              </>
            }
          >
            {" "}
            {counts.map((c) => {
              const m = all.find((m) => m.id === c.materialId)!;
              return (
                <tr key={c.materialId}>
                  <td>
                    <MaterialIdentity material={m} />
                  </td>
                  <td>{qty(c.expectedPhysical)}</td>
                  <td>
                    {qty(c.physical)} {units[m.unit]}
                    {c.physical < stock(state, m.id).reserved && (
                      <small className="danger-text">
                        Ниже резерва — возникнет дефицит
                      </small>
                    )}
                  </td>
                  <td>{qty(c.physical - c.expectedPhysical)}</td>
                </tr>
              );
            })}{" "}
          </PagedTable>
          <Field label="Комментарий к сверке">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <button onClick={() => setReview(false)}>
              Вернуться к подсчёту
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                counts.some(
                  (c) => !Number.isFinite(c.physical) || c.physical < 0,
                )
              }
              onClick={async () => {
                if (
                  await act(
                    () =>
                      mutate((s) => {
                        applyStocktake(s, counts, comment);
                      }),
                    "Сверка сохранена",
                  )
                ) {
                  setDraft({});
                  setReview(false);
                  setComment("");
                  setFilter("all");
                }
              }}
            >
              Подтвердить {counts.length} позиций
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
