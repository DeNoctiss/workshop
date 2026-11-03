import { useState } from "react";
import {
  ShoppingCart,
  Plus,
  Copy,
  Download,
  Printer,
  Trash2,
  PackagePlus,
} from "lucide-react";
import { useApp } from "../components/context";
import { Header, Field, Num, Modal, Empty, money, qty } from "../components/ui";
import { Paged } from "../components/Paged";
import { MaterialKind } from "../components/StockStatus";
import {
  categories,
  closed,
  units,
  uid,
  now,
  type Unit,
  type Category,
} from "../domain/model";
import { mutate } from "../data/db";
import { defaultPurchaseConfig, type PurchaseItem } from "./model";
import { ensureShopping, generatePurchases, receivePurchase } from "./engine";
import { downloadCsv, printPurchases, purchaseText } from "./export";
import "./shopping.css";
function PurchaseDetails({
  item,
  onSave,
  onTarget,
}: {
  item: PurchaseItem;
  onSave: (patch: Partial<PurchaseItem>) => Promise<boolean>;
  onTarget: (target: number) => void;
}) {
  const [note, setNote] = useState(item.note),
    [amount, setAmount] = useState(item.quantity),
    [target, setTarget] = useState(item.target),
    [pack, setPack] = useState(
      item.packageQty === undefined ? "" : String(item.packageQty),
    );
  const packNumber = pack.trim() ? Number(pack.replace(",", ".")) : undefined;
  const validPack =
    packNumber === undefined || (Number.isFinite(packNumber) && packNumber > 0);
  return (
    <details className="purchase-detail">
      <summary>Расчёт и правки</summary>
      {!item.manual && (
        <>
          <dl>
            <div>
              <dt>На складе</dt>
              <dd>
                {qty(item.physical)} {units[item.unit]}
              </dd>
            </div>
            <div>
              <dt>Резерв</dt>
              <dd>{qty(item.reserved)}</dd>
            </div>
            <div>
              <dt>Доступно</dt>
              <dd>{qty(item.physical - item.reserved)}</dd>
            </div>
            <div>
              <dt>Доп. расход</dt>
              <dd>{qty(item.demand)}</dd>
            </div>
            <div>
              <dt>Целевой запас</dt>
              <dd>{qty(item.target)}</dd>
            </div>
          </dl>
          <p className="muted">
            Нехватка = max(0, дополнительный расход + целевой запас − доступно).
            Зарезервированный объём повторно в расход не включён.
          </p>
        </>
      )}
      {item.manual && (
        <p className="muted">
          Количество этой позиции задано вручную и не пересчитывается по
          рецептам.
        </p>
      )}
      <ul>
        {item.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave({
            quantity: amount,
            override: amount,
            note,
            packageQty: packNumber,
            packageOverride: packNumber,
          });
        }}
        className="purchase-edit"
      >
        <Field label={"Купить, " + units[item.unit]}>
          <Num value={amount} min={item.shortage} onChange={setAmount} />
        </Field>
        <Field label={"В упаковке, " + units[item.unit] + " · необязательно"}>
          <input
            inputMode="decimal"
            value={pack}
            onChange={(e) => setPack(e.target.value)}
            placeholder="Неизвестно"
          />
        </Field>
        <Field label="Заметка">
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button
          disabled={
            !Number.isFinite(amount) || amount < item.shortage || !validPack
          }
        >
          Сохранить правки
        </button>
      </form>
      {!item.manual && item.materialId && (
        <div className="purchase-target">
          <Field label={"До какого запаса пополнить, " + units[item.unit]}>
            <Num value={target} min={0} onChange={setTarget} />
          </Field>
          <button
            disabled={!Number.isFinite(target)}
            onClick={() => onTarget(target)}
          >
            Задать цель
          </button>
          <span className="muted">
            Учитывается при включённом пополнении. После изменения пересчитайте
            список.
          </span>
        </div>
      )}
    </details>
  );
}
export default function ShoppingPage() {
  const { state: s, act, busy, confirm } = useApp();
  const [config, setConfig] = useState(() =>
    structuredClone(
      s.shopping?.config ?? {
        ...defaultPurchaseConfig(),
        runIds: s.runs.filter((r) => !closed(r)).map((r) => r.id),
      },
    ),
  );
  const [dirty, setDirty] = useState(false),
    [manual, setManual] = useState(false),
    [receipt, setReceipt] = useState<PurchaseItem | null>(null),
    [amount, setAmount] = useState(0),
    [cost, setCost] = useState(""),
    [copy, setCopy] = useState<string | null>(null);
  const [name, setName] = useState(""),
    [unit, setUnit] = useState<Unit>("pcs"),
    [category, setCategory] = useState<Category>("other"),
    [materialId, setMaterialId] = useState(""),
    [manualQty, setManualQty] = useState(1);
  const items = s.shopping?.items ?? [],
    pending = items.filter((i) => !i.receiptMovementId),
    received = items.filter((i) => i.receiptMovementId),
    activeRuns = s.runs.filter((r) => !closed(r)),
    projects = s.projects.filter((p) => !p.archived);
  const configure = (patch: Partial<typeof config>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
  };
  const update = (id: string, patch: Partial<PurchaseItem>) =>
    act(
      () =>
        mutate((d) => {
          const row = ensureShopping(d).items.find((i) => i.id === id);
          if (!row) throw Error("Позиция не найдена");
          Object.assign(row, patch);
        }),
      "Список обновлён",
    );
  const calculate = async () => {
    if (
      await act(
        () =>
          mutate((d) => {
            d.shopping = generatePurchases(d, config, d.shopping?.items);
          }),
        "Список закупок пересчитан",
      )
    )
      setDirty(false);
  };
  const total = pending.reduce((n, i) => n + (i.price ?? 0) * i.quantity, 0),
    unknown = pending.some((i) => i.price === undefined && i.quantity > 0);
  return (
    <>
      <Header
        title="Закупки"
        description="Что нужно для новых партий и пополнения склада."
      >
        <button disabled={busy} onClick={() => setManual(true)}>
          <Plus size={17} /> Ручная позиция
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void calculate()}
        >
          <ShoppingCart size={17} />
          {items.length ? "Пересчитать" : "Сформировать список"}
        </button>
      </Header>
      <details className="panel purchase-sources" open={!items.length}>
        <summary>
          Источники расчёта{" "}
          {dirty && <span className="badge warn">Есть изменения</span>}
        </summary>
        <div className="purchase-source-body">
          <div className="purchase-options">
            <label>
              <input
                type="checkbox"
                checked={config.lowStock}
                onChange={(e) => configure({ lowStock: e.target.checked })}
              />{" "}
              Пополнить материалы на пороге или ниже
            </label>
            <label>
              <input
                type="checkbox"
                checked={config.keepTarget}
                onChange={(e) => configure({ keepTarget: e.target.checked })}
              />{" "}
              Оставить целевой запас после выбранных работ
            </label>
          </div>
          <div className="purchase-source-columns">
            <section>
              <h3>Активные производства</h3>
              <p className="muted">
                Резервы всех работ учитываются всегда. Здесь добавляется только
                незарезервированная часть выбранных запусков.
              </p>
              {activeRuns.length ? (
                <Paged>
                  {activeRuns.map((r) => (
                    <label key={r.id} className="purchase-run">
                      <input
                        type="checkbox"
                        checked={config.runIds.includes(r.id)}
                        onChange={(e) =>
                          configure({
                            runIds: e.target.checked
                              ? [...config.runIds, r.id]
                              : config.runIds.filter((id) => id !== r.id),
                          })
                        }
                      />
                      <span>
                        {r.title} · {r.count} шт.
                      </span>
                    </label>
                  ))}
                </Paged>
              ) : (
                <p className="muted">Активных производств пока нет.</p>
              )}
            </section>
            <section>
              <h3>Будущие партии</h3>
              <p className="muted">
                В расчёт попадут только выбранные здесь проекты. Один запуск и
                отдельные запуски могут расходовать разный объём материалов.
              </p>
              <div className="purchase-plans">
                {config.projects.map((p) => (
                  <div key={p.id} className="purchase-plan">
                    <select
                      aria-label="Проект партии"
                      value={p.projectId}
                      onChange={(e) =>
                        configure({
                          projects: config.projects.map((x) =>
                            x.id === p.id
                              ? { ...x, projectId: e.target.value }
                              : x,
                          ),
                        })
                      }
                    >
                      {projects.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                    </select>
                    <Field label="Изделий">
                      <Num
                        value={p.count}
                        min={1}
                        step={1}
                        onChange={(v) =>
                          configure({
                            projects: config.projects.map((x) =>
                              x.id === p.id ? { ...x, count: v } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <select
                      aria-label="Режим запусков"
                      value={p.separate ? "separate" : "batch"}
                      onChange={(e) =>
                        configure({
                          projects: config.projects.map((x) =>
                            x.id === p.id
                              ? {
                                  ...x,
                                  separate: e.target.value === "separate",
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      <option value="batch">Один запуск</option>
                      <option value="separate">Отдельные запуски</option>
                    </select>
                    <button
                      aria-label="Убрать будущую партию"
                      onClick={() =>
                        configure({
                          projects: config.projects.filter(
                            (x) => x.id !== p.id,
                          ),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                    <label className="purchase-additional">
                      <input
                        type="checkbox"
                        checked={p.additional}
                        onChange={(e) =>
                          configure({
                            projects: config.projects.map((x) =>
                              x.id === p.id
                                ? { ...x, additional: e.target.checked }
                                : x,
                            ),
                          })
                        }
                      />{" "}
                      Дополнительная партия сверх уже запущенных
                    </label>
                  </div>
                ))}
              </div>
              <button
                disabled={
                  !projects.some(
                    (p) => !config.projects.some((x) => x.projectId === p.id),
                  )
                }
                onClick={() => {
                  const p = projects.find(
                    (p) => !config.projects.some((x) => x.projectId === p.id),
                  );
                  if (p)
                    configure({
                      projects: [
                        ...config.projects,
                        {
                          id: uid(),
                          projectId: p.id,
                          count: 1,
                          separate: false,
                          additional: false,
                        },
                      ],
                    });
                }}
              >
                <Plus size={16} /> Добавить проект
              </button>
            </section>
          </div>
        </div>
      </details>
      {dirty && (
        <div className="purchase-notice">
          Настройки изменены. Нажмите «Пересчитать», чтобы обновить количества.
        </div>
      )}
      {!!s.shopping?.warnings.length && (
        <div className="purchase-notice" role="status">
          <strong>Обратите внимание</strong>
          <ul>
            {s.shopping.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="purchase-summary">
        <span>
          {pending.length} позиций ·{" "}
          {
            pending.filter(
              (i) => i.quantity > 0 && i.purchasedQty >= i.quantity,
            ).length
          }{" "}
          куплено
          {items.length > 0 &&
            s.shopping &&
            " · расчёт от " +
              new Date(s.shopping.updatedAt).toLocaleString("ru-RU")}
        </span>
        <strong>
          {money(total)}
          {unknown ? " + позиции без цены" : ""}
        </strong>
        <div className="purchase-actions">
          <button
            disabled={!pending.length}
            onClick={async () => {
              const text = purchaseText(s.shopping!);
              try {
                await navigator.clipboard.writeText(text);
                await act(async () => {}, "Список скопирован");
              } catch {
                setCopy(text);
              }
            }}
          >
            <Copy size={16} /> Текст
          </button>
          <button
            disabled={!pending.length}
            onClick={() => downloadCsv(s.shopping!)}
          >
            <Download size={16} /> CSV
          </button>
          <button
            disabled={!pending.length}
            onClick={() => printPurchases(s.shopping!)}
          >
            <Printer size={16} /> Печать / PDF
          </button>
        </div>
      </div>
      {!pending.length ? (
        <Empty title="Список покупок пуст">
          <p>
            Выберите будущие партии или пополнение склада и сформируйте список.
          </p>
        </Empty>
      ) : (
        <Paged className="purchase-list">
          {pending.map((i) => (
            <article
              key={i.id}
              className={
                "panel purchase-item " +
                (i.quantity > 0 && i.purchasedQty >= i.quantity
                  ? "purchased"
                  : "")
              }
            >
              <div className="purchase-row">
                <label className="purchase-check">
                  <input
                    aria-label={"Куплено: " + i.name}
                    type="checkbox"
                    disabled={busy || i.quantity <= 0}
                    checked={i.quantity > 0 && i.purchasedQty >= i.quantity}
                    onChange={(e) =>
                      void update(i.id, {
                        purchasedQty: e.target.checked ? i.quantity : 0,
                      })
                    }
                  />
                </label>
                <MaterialKind category={i.category} />
                {i.color && (
                  <span
                    className="purchase-color"
                    style={{ background: i.color }}
                    aria-label={"Цвет " + i.color}
                  />
                )}
                <div className="purchase-name">
                  <strong>{i.name}</strong>
                  <span>
                    {i.shortage > 0
                      ? "Не хватает " + qty(i.shortage) + " " + units[i.unit]
                      : i.quantity > 0
                        ? "Ручная позиция / покупка сохранена"
                        : "Дефицита нет — при необходимости задайте цель пополнения"}
                  </span>
                </div>
                <div className="purchase-quantity">
                  <strong>
                    {qty(i.quantity)} {units[i.unit]}
                  </strong>
                  <span>
                    {i.packageQty
                      ? Math.ceil(i.quantity / i.packageQty - 1e-9) +
                        " уп. × " +
                        qty(i.packageQty) +
                        " " +
                        units[i.unit]
                      : "Без упаковки"}
                  </span>
                  <span>
                    {i.price === undefined
                      ? "Цена неизвестна"
                      : money(i.price * i.quantity)}
                  </span>
                </div>
                <button
                  disabled={busy || !i.materialId || i.quantity <= 0}
                  onClick={() => {
                    setReceipt(i);
                    setAmount(i.quantity);
                    setCost(
                      i.price === undefined
                        ? ""
                        : String(Math.round(i.price * i.quantity) / 100),
                    );
                  }}
                >
                  <PackagePlus size={17} /> Оприходовать
                </button>
                <button
                  aria-label={"Удалить из покупок: " + i.name}
                  disabled={busy}
                  onClick={() =>
                    confirm(
                      "Убрать из списка?",
                      "Склад и история приходов не изменятся. При следующем расчёте материал может появиться снова.",
                      async () => {
                        await act(() =>
                          mutate((d) => {
                            ensureShopping(d).items = ensureShopping(
                              d,
                            ).items.filter((x) => x.id !== i.id);
                          }),
                        );
                      },
                    )
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
              <PurchaseDetails
                key={i.id + ":" + i.quantity + ":" + i.target}
                item={i}
                onSave={(patch) => update(i.id, patch)}
                onTarget={(target) =>
                  configure({
                    targets: { ...config.targets, [i.materialId!]: target },
                  })
                }
              />
            </article>
          ))}
        </Paged>
      )}
      <p className="muted">
        Галочка «Куплено» не меняет остатки. Для поступления материалов
        используйте «Оприходовать».
      </p>
      {received.length > 0 && (
        <details className="panel">
          <summary>Приходы из списка · {received.length}</summary>
          <Paged className="purchase-history">
            {received.map((i) => (
              <div key={i.id}>
                <strong>{i.name}</strong>
                <span>
                  Оприходовано {qty(i.receivedQty ?? 0)} {units[i.unit]}
                  {i.receiptCost !== undefined
                    ? " · " + money(i.receiptCost)
                    : ""}
                </span>
              </div>
            ))}
          </Paged>
        </details>
      )}
      {manual && (
        <Modal title="Ручная позиция" onClose={() => setManual(false)}>
          <form
            className="purchase-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const m = s.materials.find((m) => m.id === materialId);
              if (
                await act(
                  () =>
                    mutate((d) => {
                      ensureShopping(d).items.push({
                        id: uid(),
                        key: "manual:" + uid(),
                        materialId: m?.id,
                        name: m ? m.name : name.trim(),
                        unit: m?.unit ?? unit,
                        category: m?.category ?? category,
                        color: m?.colorEnabled !== false ? m?.color : undefined,
                        manual: true,
                        physical: 0,
                        reserved: 0,
                        demand: 0,
                        target: 0,
                        shortage: 0,
                        quantity: manualQty,
                        packageQty: m?.packageQty,
                        price:
                          m && m.packageCost > 0
                            ? m.packageCost / m.packageQty
                            : undefined,
                        reasons: ["Добавлено вручную"],
                        note: "",
                        purchasedQty: 0,
                      });
                      ensureShopping(d).updatedAt = now();
                    }),
                  "Позиция добавлена",
                )
              ) {
                setManual(false);
                setName("");
                setMaterialId("");
              }
            }}
          >
            <Field label="Связь со складом">
              <select
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
              >
                <option value="">Без связи — свободная позиция</option>
                {s.materials
                  .filter((m) => !m.archived)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </Field>
            {!materialId && (
              <>
                <Field label="Название">
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label="Тип">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                  >
                    {Object.entries(categories).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Единица">
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as Unit)}
                  >
                    {Object.entries(units).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <Field label="Количество">
              <Num value={manualQty} min={0.001} onChange={setManualQty} />
            </Field>
            <p className="muted">
              Для прихода свободной позиции сначала создайте соответствующий
              материал на складе.
            </p>
            <button
              className="primary"
              disabled={
                busy ||
                !Number.isFinite(manualQty) ||
                manualQty <= 0 ||
                (!materialId && !name.trim())
              }
            >
              Добавить
            </button>
          </form>
        </Modal>
      )}
      {receipt && (
        <Modal title="Оприходовать покупку" onClose={() => setReceipt(null)}>
          <form
            className="purchase-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const price =
                cost.trim() === ""
                  ? undefined
                  : Math.round(Number(cost.replace(",", ".")) * 100);
              if (
                await act(
                  () =>
                    mutate((d) =>
                      receivePurchase(d, receipt.id, amount, price),
                    ),
                  "Материал поступил на склад",
                )
              )
                setReceipt(null);
            }}
          >
            <p>{receipt.name}</p>
            <Field label={"Фактическое количество, " + units[receipt.unit]}>
              <Num value={amount} min={0.001} onChange={setAmount} />
            </Field>
            <Field label="Общая стоимость покупки, ₽ · необязательно">
              <input
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </Field>
            <p className="muted">
              Будет создан один приход. Эта строка сохранит связь с ним;
              повторно оприходовать её нельзя. Указанная стоимость обновит цену
              материала пропорционально его упаковке.
            </p>
            <button
              className="primary"
              disabled={busy || !Number.isFinite(amount) || amount <= 0}
            >
              Подтвердить приход
            </button>
          </form>
        </Modal>
      )}
      {copy !== null && (
        <Modal title="Скопируйте список" onClose={() => setCopy(null)}>
          <textarea
            aria-label="Текст списка покупок"
            rows={14}
            readOnly
            value={copy}
            onFocus={(e) => e.target.select()}
          />
        </Modal>
      )}
    </>
  );
}
