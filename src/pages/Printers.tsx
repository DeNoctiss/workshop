import { Paged } from "../components/Paged";
import { useState } from "react";
import { Plus, Printer as PrinterIcon, Pencil } from "lucide-react";
import { useApp } from "../components/context";
import {
  Header,
  Field,
  Num,
  Modal,
  Badge,
  Empty,
  money,
} from "../components/ui";
import { uid, type Printer } from "../domain/model";
import { mutate } from "../data/db";
export function Printers() {
  const { state, act } = useApp();
  const [edit, setEdit] = useState<Printer | null>(null),
    [revision, setRevision] = useState(0);
  function open(p: Printer) {
    setEdit(structuredClone(p));
    setRevision(state.revision);
  }
  return (
    <>
      <Header
        title="Принтеры"
        description="Оборудование и параметры для расчёта себестоимости."
      >
        <button
          className="primary"
          onClick={() =>
            open({
              id: uid(),
              name: "",
              brand: "",
              model: "",
              technology: "FDM",
              purchaseDate: "",
              purchaseCost: 0,
              lifeHours: 10000,
              powerW: 150,
              tariff: 650,
              maintenanceHour: 0,
              active: true,
            })
          }
        >
          <Plus size={18} />
          Добавить принтер
        </button>
      </Header>
      {!state.printers.length ? (
        <Empty title="Добавьте первое оборудование">
          <p>Можно учесть стоимость принтера вместе с AMS.</p>
        </Empty>
      ) : (
        <Paged className="cards">
          {state.printers.map((p) => (
            <article className="panel" key={p.id}>
              <div className="card-top">
                <div className="printer-symbol">
                  <PrinterIcon size={42} />
                </div>
                <Badge tone={p.active ? "success" : "neutral"}>
                  {p.active ? "Активен" : "Неактивен"}
                </Badge>
              </div>
              <h2>{p.name}</h2>
              <p>
                {p.brand} {p.model} · {p.technology}
              </p>
              <dl className="costs">
                <div>
                  <dt>Стоимость оборудования</dt>
                  <dd>{money(p.purchaseCost)}</dd>
                </div>
                <div>
                  <dt>Ресурс</dt>
                  <dd>{p.lifeHours} ч</dd>
                </div>
                <div>
                  <dt>Средняя мощность</dt>
                  <dd>{p.powerW} Вт</dd>
                </div>
                <div>
                  <dt>Амортизация / час</dt>
                  <dd>{money(p.purchaseCost / p.lifeHours)}</dd>
                </div>
              </dl>
              <button onClick={() => open(p)}>
                <Pencil size={16} />
                Настроить
              </button>
            </article>
          ))}
        </Paged>
      )}
      {edit && (
        <Modal title="Параметры принтера" onClose={() => setEdit(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  () =>
                    mutate((s) => {
                      const i = s.printers.findIndex((p) => p.id === edit.id);
                      if (i < 0) s.printers.push(edit);
                      else s.printers[i] = edit;
                    }, revision),
                  "Принтер сохранён",
                )
              )
                setEdit(null);
            }}
          >
            <Field label="Название">
              <input
                required
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <div className="form-grid">
              <Field label="Производитель">
                <input
                  value={edit.brand}
                  onChange={(e) => setEdit({ ...edit, brand: e.target.value })}
                />
              </Field>
              <Field label="Модель">
                <input
                  value={edit.model}
                  onChange={(e) => setEdit({ ...edit, model: e.target.value })}
                />
              </Field>
              <Field label="Технология">
                <select
                  value={edit.technology}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      technology: e.target.value as "FDM" | "SLA",
                    })
                  }
                >
                  <option>FDM</option>
                  <option>SLA</option>
                </select>
              </Field>
              <Field label="Дата покупки">
                <input
                  type="date"
                  value={edit.purchaseDate}
                  onChange={(e) =>
                    setEdit({ ...edit, purchaseDate: e.target.value })
                  }
                />
              </Field>
              {(
                [
                  "purchaseCost",
                  "lifeHours",
                  "powerW",
                  "tariff",
                  "maintenanceHour",
                ] as const
              ).map((k, i) => {
                const monetary = [
                  "purchaseCost",
                  "tariff",
                  "maintenanceHour",
                ].includes(k);
                return (
                  <Field
                    key={k}
                    label={
                      [
                        "Стоимость, ₽",
                        "Ресурс, ч",
                        "Средняя мощность, Вт",
                        "Тариф, ₽ / кВт·ч",
                        "Обслуживание, ₽ / ч",
                      ][i]
                    }
                  >
                    <Num
                      value={edit[k] / (monetary ? 100 : 1)}
                      min={k === "lifeHours" ? 1 : 0}
                      onChange={(v) =>
                        setEdit({
                          ...edit,
                          [k]: monetary ? Math.round(v * 100) : v,
                        })
                      }
                    />
                  </Field>
                );
              })}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.active}
                onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
              />
              Доступен для новых запусков
            </label>
            <p className="muted">
              Прошлые запуски сохраняют прежние параметры и стоимость.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setEdit(null)}>
                Отмена
              </button>
              <button className="primary">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
