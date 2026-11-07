import { PagedTable } from "../components/Paged";
import { CatalogPicker } from "../catalog/CatalogPicker";
import { newMaterial } from "../catalog/catalog";
import { useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  History,
  Archive,
  PackagePlus,
  Check,
} from "lucide-react";
import { useApp } from "../components/context";
import {
  Header,
  Field,
  Num,
  Modal,
  Badge,
  Empty,
  money,
  qty,
  date,
} from "../components/ui";
import {
  categories,
  units,
  uid,
  now,
  sources,
  type Material,
  type Category,
  type Unit,
} from "../domain/model";
import { stockHealth, stock, movement, reconcile } from "../domain/engine";
import { mutate } from "../data/db";
import { MaterialKind, StockWarnings } from "../components/StockStatus";
export function Materials({
  inventory = false,
  initialRisk = "",
}: {
  inventory?: boolean;
  initialRisk?: string;
}) {
  const { state: s, act, confirm } = useApp();
  const [picker, setPicker] = useState(false),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [risk, setRisk] = useState(initialRisk),
    [archived, setArchived] = useState(false),
    [sort, setSort] = useState("name"),
    [edit, setEdit] = useState<Material | null>(null),
    [op, setOp] = useState<{
      m: Material;
      type: "receipt" | "inventory" | "history";
    } | null>(null);
  const [amount, setAmount] = useState(0),
    [note, setNote] = useState(""),
    [method, setMethod] = useState("Оценка");
  const items = s.materials
    .filter(
      (m) =>
        m.archived === archived &&
        (!category || m.category === category) &&
        `${m.name} ${m.brand} ${m.series} ${m.code} ${m.colorEnabled !== false ? m.color : ""}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!risk ||
          (risk === "deficit"
            ? stock(s, m.id).available < 0
            : risk === "minimum"
              ? stockHealth(s, m).belowMinimum
              : risk === "low"
                ? stockHealth(s, m).level !== "healthy"
                : stockHealth(s, m).level === risk)),
    )
    .sort((a, b) =>
      sort === "stock"
        ? stock(s, a.id).available - stock(s, b.id).available
        : a.name.localeCompare(b.name),
    );
  const open = (m: Material, type: "receipt" | "inventory" | "history") => {
    setOp({ m, type });
    setAmount(type === "receipt" ? m.packageQty : stock(s, m.id).physical);
    setNote("");
  };
  const materialActions = (m: Material) => (
    <div className="actions material-actions">
      {inventory ? (
        <button onClick={() => open(m, "inventory")}>Сверить</button>
      ) : (
        <>
          <button
            className="icon"
            title="Пополнить"
            aria-label={"Пополнить " + m.name}
            onClick={() => open(m, "receipt")}
          >
            <PackagePlus size={17} />
          </button>
          <button
            className="icon"
            title="Редактировать"
            aria-label={"Редактировать " + m.name}
            onClick={() => setEdit(structuredClone(m))}
          >
            <Pencil size={17} />
          </button>
        </>
      )}
      <button
        className="icon"
        title="История"
        aria-label={"История " + m.name}
        onClick={() => open(m, "history")}
      >
        <History size={17} />
      </button>
      <button
        className="icon"
        title={m.archived ? "Вернуть из архива" : "Архивировать"}
        aria-label={"Архив " + m.name}
        onClick={() =>
          confirm(
            m.archived ? "Вернуть материал?" : "В архив?",
            "История и рецепты сохранятся. Архивный материал недоступен для новых запусков.",
            () =>
              mutate((d) => {
                if (stock(d, m.id).reserved > 0)
                  throw new Error("Сначала завершите активные производства");
                d.materials.find((x) => x.id === m.id)!.archived = !m.archived;
              }),
          )
        }
      >
        <Archive size={17} />
      </button>
    </div>
  );
  return (
    <>
      <Header
        title={inventory ? "Инвентаризация" : "Материалы"}
        description={
          inventory
            ? "Сверьте реальные запасы. История прошлых производств останется прежней."
            : "Единый склад: физический остаток, резерв и доступное количество."
        }
      >
        {!inventory && (
          <a className="button" href="#/shopping">
            Что докупить
          </a>
        )}
        {inventory ? (
          <button
            className="primary"
            onClick={() =>
              confirm(
                "Завершить сверку?",
                "Отсчёт напоминания начнётся заново. Убедитесь, что проверили нужные материалы.",
                () =>
                  mutate((d) => {
                    d.settings.inventoryAt = now();
                    d.settings.inventoryCompleted = d.runs.filter(
                      (r) => r.stage === "completed",
                    ).length;
                    d.settings.snoozeUntil = "";
                  }),
              )
            }
          >
            <Check size={18} />
            Завершить сверку
          </button>
        ) : (
          <div className="actions">
            <button
              onClick={() => setEdit({ ...newMaterial(), packageQty: 1000 })}
            >
              Вручную
            </button>
            <button className="primary" onClick={() => setPicker(true)}>
              <Plus size={18} />
              Из каталога
            </button>
          </div>
        )}
      </Header>
      {!inventory && <StockWarnings />}
      {inventory && (
        <div className="info-strip">
          Для красок можно указать долю флакона. Значения в мл остаются
          приблизительными.
        </div>
      )}
      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <input
            placeholder="Материал, бренд, код или цвет…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Категория"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Все категории</option>
          {Object.entries(categories).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <select
          aria-label="Остатки"
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
        >
          <option value="">Все остатки</option>
          <option value="low">Все низкие остатки</option>
          <option value="warning">Скоро закончатся</option>
          <option value="critical">Пора пополнить</option>
          <option value="healthy">В норме</option>
          <option value="minimum">Достигнут порог пополнения</option>
          <option value="deficit">Дефицит резерва</option>
        </select>
        <select
          aria-label="Сортировка"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="name">По названию</option>
          <option value="stock">По доступному остатку</option>
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Архив
        </label>
      </div>
      {!items.length ? (
        <Empty
          title={
            s.materials.length
              ? "Нет материалов по выбранным фильтрам"
              : "Материалов пока нет"
          }
        >
          <p>
            {s.materials.length
              ? "Измените категорию или фильтр остатков."
              : "Добавьте свои катушки, краски и расходники."}
          </p>
        </Empty>
      ) : (
        <div className="materials-list">
          <PagedTable
            className="materials-table"
            head={
              <>
                <tr>
                  <th>Материал</th>
                  <th>Цвет</th>
                  <th>На складе</th>
                  <th>Резерв</th>
                  <th>Доступно</th>
                  <th>Порог пополнения</th>
                  <th>Статус</th>
                  <th>{inventory ? "Последняя сверка" : "Цена / ед."}</th>
                  <th>Действия</th>
                </tr>
              </>
            }
          >
            {items.map((m) => {
              const v = stockHealth(s, m);
              return (
                <tr key={m.id}>
                  <td>
                    <div className="material-name">
                      <MaterialKind category={m.category} />
                      <div>
                        <strong>{m.name}</strong>
                        <small>
                          {[m.brand, m.series, m.code]
                            .filter(Boolean)
                            .join(" · ")}{" "}
                        </small>
                      </div>
                    </div>
                    <div className="material-mobile">
                      <dl className="material-mobile-stats">
                        <div>
                          <dt>На складе</dt>
                          <dd>
                            {qty(v.physical)} {units[m.unit]}
                          </dd>
                        </div>
                        <div>
                          <dt>Резерв</dt>
                          <dd>
                            {qty(v.reserved)} {units[m.unit]}
                          </dd>
                        </div>
                        <div>
                          <dt>Доступно</dt>
                          <dd>
                            <strong>
                              {qty(v.available)} {units[m.unit]}
                            </strong>
                          </dd>
                        </div>
                        <div>
                          <dt>Порог</dt>
                          <dd>
                            {qty(m.minimum)} {units[m.unit]}
                          </dd>
                        </div>
                      </dl>
                      <details>
                        <summary>Статус, цена и действия</summary>
                        <div className="material-mobile-extra">
                          <div>
                            <span>Статус</span>
                            <Badge
                              tone={
                                v.level === "critical"
                                  ? "danger"
                                  : v.level === "warning"
                                    ? "warning"
                                    : "success"
                              }
                            >
                              {v.available < 0
                                ? "Дефицит резерва"
                                : v.level === "critical"
                                  ? "Пополнить"
                                  : v.level === "warning"
                                    ? "Скоро закончится"
                                    : "В норме"}
                            </Badge>
                          </div>
                          <div>
                            <span>
                              {inventory ? "Последняя сверка" : "Цена / ед."}
                            </span>
                            <strong>
                              {inventory
                                ? m.checkedAt
                                  ? date(m.checkedAt)
                                  : "Не сверяли"
                                : money(m.packageCost / m.packageQty)}
                            </strong>
                          </div>
                          {m.colorEnabled !== false && m.color && (
                            <div>
                              <span>Цвет</span>
                              <span>{m.color}</span>
                            </div>
                          )}
                          {materialActions(m)}
                        </div>
                      </details>
                    </div>
                  </td>
                  <td className="material-color">
                    {m.colorEnabled !== false && m.color ? (
                      <span
                        className="swatch"
                        style={{ background: m.color }}
                        title={m.color}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {qty(v.physical)} {units[m.unit]}
                    {m.unit === "ml" && <small>примерно</small>}
                  </td>
                  <td>{qty(v.reserved)}</td>
                  <td>
                    <strong>{qty(v.available)}</strong>
                  </td>
                  <td>{qty(m.minimum)}</td>
                  <td>
                    <Badge
                      tone={
                        v.level === "critical"
                          ? "danger"
                          : v.level === "warning"
                            ? "warning"
                            : "success"
                      }
                    >
                      {v.available < 0
                        ? "Дефицит резерва"
                        : v.level === "critical"
                          ? "Пополнить"
                          : v.level === "warning"
                            ? "Скоро закончится"
                            : "В норме"}
                    </Badge>
                    <div
                      className={"stock-meter " + v.level}
                      role="meter"
                      aria-label="Доступный запас относительно упаковки"
                      aria-valuenow={Math.min(100, v.percent)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuetext={Math.round(v.percent) + "% упаковки"}
                    >
                      <i style={{ width: Math.min(100, v.percent) + "%" }} />
                    </div>
                    <small>{Math.round(v.percent)}% упаковки</small>
                  </td>
                  <td>
                    {inventory
                      ? m.checkedAt
                        ? date(m.checkedAt)
                        : "Не сверяли"
                      : money(m.packageCost / m.packageQty)}
                  </td>
                  <td>{materialActions(m)}</td>
                </tr>
              );
            })}
          </PagedTable>
        </div>
      )}
      {picker && (
        <CatalogPicker
          onClose={() => setPicker(false)}
          onPick={(c) => {
            setPicker(false);
            setEdit(c.material ?? newMaterial(c.product));
          }}
        />
      )}
      {edit && <MaterialForm initial={edit} onClose={() => setEdit(null)} />}
      {op && (
        <Modal
          title={`${op.type === "receipt" ? "Пополнение" : op.type === "history" ? "История" : "Сверка"} · ${op.m.name}`}
          onClose={() => setOp(null)}
          wide={op.type === "history"}
        >
          {op.type === "history" ? (
            <PagedTable
              head={
                <>
                  <tr>
                    <th>Дата</th>
                    <th>Операция</th>
                    <th>Количество</th>
                    <th>Источник</th>
                    <th>Примечание</th>
                  </tr>
                </>
              }
            >
              {s.movements
                .filter((m) => m.materialId === op.m.id)
                .slice()
                .reverse()
                .map((m) => (
                  <tr key={m.id}>
                    <td>{date(m.at)}</td>
                    <td>
                      {
                        {
                          receipt: "Приход",
                          reserve: "Резерв",
                          release: "Снятие резерва",
                          consume: "Расход",
                          waste: "Брак",
                          adjustment: "Корректировка",
                        }[m.kind]
                      }
                    </td>
                    <td>
                      {qty(m.qty)} {units[op.m.unit]}
                    </td>
                    <td>{sources[m.source]}</td>
                    <td>{m.note}</td>
                  </tr>
                ))}
            </PagedTable>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await act(
                    () =>
                      mutate((d) =>
                        op.type === "receipt"
                          ? movement(
                              d,
                              op.m.id,
                              "receipt",
                              amount,
                              "measured",
                              note,
                            )
                          : reconcile(d, op.m.id, amount, method, note),
                      ),
                    "Остаток сохранён",
                  )
                )
                  setOp(null);
              }}
            >
              <Field
                label={`${op.type === "receipt" ? "Добавить" : "Физический остаток"}, ${units[op.m.unit]}`}
              >
                <Num value={amount} onChange={setAmount} />
              </Field>
              {op.type === "inventory" && (
                <>
                  <div className="chips">
                    {[
                      [1, "Полная"],
                      [0.75, "¾"],
                      [0.5, "½"],
                      [0.25, "¼"],
                      [0.05, "Почти пустая"],
                      [0, "Пустая"],
                    ].map(([v, n]) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          setAmount(op.m.packageQty * Number(v));
                          setMethod("Доля упаковки");
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <Field label="Метод">
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      <option>Оценка</option>
                      <option>Измерено</option>
                      <option>Доля упаковки</option>
                    </select>
                  </Field>
                  {amount < stock(s, op.m.id).reserved && (
                    <p className="warning-text">
                      Остаток меньше резерва. Дефицит будет показан в складе;
                      новые запуски будут ограничены.
                    </p>
                  )}
                </>
              )}
              <Field label="Комментарий">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <div className="modal-actions">
                <button type="button" onClick={() => setOp(null)}>
                  Отмена
                </button>
                <button className="primary">
                  {op.type === "inventory" &&
                  amount === stock(s, op.m.id).physical
                    ? "Остаток подтверждён"
                    : "Сохранить"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
export function MaterialForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Material;
  onClose: () => void;
  onSaved?: (m: Material) => void;
}) {
  const { state, act } = useApp(),
    [m, setM] = useState(initial),
    [balance, setBalance] = useState(0);
  const existing = state.materials.some((x) => x.id === m.id);
  const [openedRecord] = useState(() =>
    state.materials.some((x) => x.id === initial.id)
      ? JSON.stringify(initial)
      : null,
  );
  const patch = (x: Partial<Material>) => setM({ ...m, ...x });
  return (
    <Modal
      title={existing ? "Редактирование материала" : "Новый материал"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act(
              () =>
                mutate((d) => {
                  const i = d.materials.findIndex((x) => x.id === m.id);
                  if (
                    openedRecord !== null &&
                    (i < 0 || JSON.stringify(d.materials[i]) !== openedRecord)
                  )
                    throw new Error(
                      "Материал изменён в другой вкладке. Откройте форму заново.",
                    );
                  if (i >= 0) {
                    if (
                      d.materials[i].unit !== m.unit &&
                      d.movements.some((x) => x.materialId === m.id)
                    )
                      throw new Error(
                        "Нельзя менять единицу материала с историей. Создайте отдельную позицию.",
                      );
                    d.materials[i] = m;
                  } else {
                    d.materials.push(m);
                    movement(
                      d,
                      m.id,
                      "receipt",
                      balance,
                      "estimated",
                      "Начальный остаток",
                    );
                  }
                }),
              "Материал сохранён",
            )
          ) {
            onSaved?.(m);
            onClose();
          }
        }}
      >
        {m.productSnapshot && (
          <div className="catalog-origin">
            <strong>
              Из каталога: {m.productSnapshot.brand} · {m.productSnapshot.name}
            </strong>
            <p>
              Поля можно изменить для своей упаковки. Цена и остаток вводятся
              вручную.
            </p>
            {!existing && m.productSnapshot.packages.length > 0 && (
              <Field label="Упаковка из каталога">
                <select
                  value={m.packageId ?? ""}
                  onChange={(e) => {
                    const pack = m.productSnapshot!.packages.find(
                      (p) => p.id === e.target.value,
                    );
                    patch({
                      packageId: pack?.id,
                      ...(pack
                        ? { packageQty: pack.qty, unit: pack.unit }
                        : {}),
                    });
                  }}
                >
                  {m.productSnapshot.packages.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.label || p.qty + " " + units[p.unit]}
                    </option>
                  ))}
                  <option value="">Своя упаковка</option>
                </select>
              </Field>
            )}
          </div>
        )}
        <Field label="Название">
          <input
            required
            value={m.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Категория">
            <select
              value={m.category}
              onChange={(e) => {
                const c = e.target.value as Category;
                patch({
                  category: c,
                  ...(!existing
                    ? {
                        colorEnabled: ![
                          "abrasive",
                          "glue",
                          "varnish",
                          "packaging",
                          "other",
                        ].includes(c),
                      }
                    : {}),
                  unit:
                    c === "filament"
                      ? "g"
                      : ["paint", "primer", "varnish"].includes(c)
                        ? "ml"
                        : m.unit,
                });
              }}
            >
              {Object.entries(categories).map(([v, n]) => (
                <option value={v} key={v}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Единица">
            <select
              value={m.unit}
              onChange={(e) => patch({ unit: e.target.value as Unit })}
            >
              {Object.entries(units).map(([v, n]) => (
                <option value={v} key={v}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          {(["brand", "series", "code"] as const).map((key, i) => (
            <Field key={key} label={["Бренд", "Серия", "Код"][i]}>
              <input
                value={m[key]}
                onChange={(e) => patch({ [key]: e.target.value })}
              />
            </Field>
          ))}
          <div className="material-color-field">
            <label className="check">
              <input
                type="checkbox"
                role="switch"
                checked={m.colorEnabled !== false}
                onChange={(e) =>
                  patch({
                    colorEnabled: e.currentTarget.checked,
                    color:
                      e.currentTarget.checked && !m.color ? "#607d8b" : m.color,
                  })
                }
              />
              Цвет материала
            </label>
            {m.colorEnabled !== false ? (
              <div className="color-input-wrap">
                <input
                  aria-label="Цвет материала"
                  type="color"
                  value={m.color}
                  onChange={(e) => patch({ color: e.target.value })}
                />
              </div>
            ) : (
              <small className="muted">
                Материал будет показан без цветового кружка.
              </small>
            )}
          </div>
          <Field label="Объём упаковки">
            <Num
              value={m.packageQty}
              min={0.001}
              onChange={(v) => patch({ packageQty: v })}
            />
          </Field>
          <Field label="Цена упаковки, ₽">
            <Num
              value={m.packageCost / 100}
              onChange={(v) => patch({ packageCost: Math.round(v * 100) })}
            />
          </Field>
          <Field
            label="Пора пополнить при остатке"
            hint="Красный статус — доступно не больше этого значения."
            help="Доступно = остаток минус резервы. Жёлтый порог — половина упаковки, но не менее минимума + 10% упаковки. Для 20 мл и минимума 3 мл: жёлтый до 10 мл, красный до 3 мл."
          >
            <Num value={m.minimum} onChange={(v) => patch({ minimum: v })} />
          </Field>
          {!existing && (
            <Field label="Начальный остаток">
              <Num value={balance} onChange={setBalance} />
            </Field>
          )}
        </div>
        <Field label="Примечание">
          <textarea
            value={m.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </Field>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}
