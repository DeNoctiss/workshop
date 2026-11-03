import { MaterialIdentity } from "../components/StockStatus";
import { NoteFeed, RunCustomer, RunTasks } from "../components/WorkspaceNotes";
import { PagedTable } from "../components/Paged";
import { useState } from "react";
import { Search, Check, ArrowLeft } from "lucide-react";
import { useApp } from "../components/context";
import {
  Header,
  Badge,
  Empty,
  Modal,
  Field,
  Num,
  Costs,
  money,
  qty,
  date,
} from "../components/ui";
import {
  closed,
  stages,
  sources,
  units,
  type Run,
  type Source,
  type Stage,
} from "../domain/model";
import { finish, setStage, revise, stock } from "../domain/engine";
import { mutate } from "../data/db";
export function Runs({ id }: { id?: string }) {
  const { state: s } = useApp();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("");
  if (id) {
    const r = s.runs.find((x) => x.id === id);
    return r ? (
      <RunDetail key={id} r={r} />
    ) : (
      <Empty title="Запуск не найден" />
    );
  }
  const list = s.runs
    .filter(
      (r) =>
        r.title.toLowerCase().includes(query.toLowerCase()) &&
        (!filter || (filter === "active" ? !closed(r) : r.stage === filter)),
    )
    .slice()
    .reverse();
  return (
    <>
      <Header
        title="Производства"
        description="Отдельные запуски изделий — от резерва материалов до готовой фигурки."
      />
      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <input
            placeholder="Найти производство…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Этап"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">Все этапы</option>
          <option value="active">Только активные</option>
          {Object.entries(stages).map(([k, v]) => (
            <option value={k} key={k}>
              {v}
            </option>
          ))}
        </select>
        <a className="button primary" href="#/projects">
          Выбрать изделие для запуска
        </a>
      </div>
      {!list.length ? (
        <Empty title="Производств пока нет">
          <p>Откройте проект, проверьте материалы и запустите изготовление.</p>
        </Empty>
      ) : (
        <PagedTable
          head={
            <>
              <tr>
                <th>Изделие</th>
                <th>Принтер</th>
                <th>Экземпляров</th>
                <th>Дата</th>
                <th>Этап</th>
                <th>План</th>
                <th>Факт</th>
                <th />
              </tr>
            </>
          }
        >
          {list.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={"#/runs/" + r.id}>
                  <strong>{r.title}</strong>
                </a>
              </td>
              <td>{r.printer.name}</td>
              <td>{r.count}</td>
              <td>{date(r.createdAt)}</td>
              <td>
                <Badge
                  tone={
                    r.stage === "completed"
                      ? "success"
                      : r.stage === "failed"
                        ? "danger"
                        : closed(r)
                          ? "neutral"
                          : "blue"
                  }
                >
                  {stages[r.stage]}
                </Badge>
              </td>
              <td>{money(r.cost.total)}</td>
              <td>{r.actualCost ? money(r.actualCost.total) : "—"}</td>
              <td>
                <a href={"#/runs/" + r.id}>Открыть →</a>
              </td>
            </tr>
          ))}
        </PagedTable>
      )}
    </>
  );
}
function RunDetail({ r }: { r: Run }) {
  const { state: s, act, confirm } = useApp();
  const [closeStage, setCloseStage] = useState<
      "completed" | "failed" | "cancelled" | null
    >(null),
    [edit, setEdit] = useState(false);
  return (
    <>
      <a className="back" href="#/runs">
        <ArrowLeft size={16} />
        Все производства
      </a>
      <Header
        title={r.title}
        description={`${r.count} экземпляров · ${r.printer.name} · ${date(r.createdAt)}`}
      >
        <Badge tone={closed(r) ? "neutral" : "blue"}>{stages[r.stage]}</Badge>
        <a className="button" href={"#/projects/" + r.projectId}>
          Карточка изделия
        </a>
      </Header>
      <RunCustomer runId={r.id} />
      {!closed(r) && (
        <section className="panel">
          <div className="section-head">
            <Field label="Текущий этап">
              <select
                value={r.stage}
                onChange={(e) => {
                  const stage = e.currentTarget.value as Stage;
                  void act(
                    () => mutate((d) => setStage(d, r.id, stage)),
                    "Этап обновлён",
                  );
                }}
              >
                {Object.entries(stages)
                  .filter(
                    ([k]) => !["completed", "failed", "cancelled"].includes(k),
                  )
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="actions">
              <button
                className="primary"
                onClick={() =>
                  confirm(
                    "Завершить по плану?",
                    "Плановый расход будет списан один раз. Резервы освободятся.",
                    () =>
                      mutate((d) => {
                        const current = d.runs.find((x) => x.id === r.id)!;
                        finish(
                          d,
                          r.id,
                          "completed",
                          Object.fromEntries(
                            current.lines.map((l) => [l.materialId, l.qty]),
                          ),
                          "plan",
                        );
                      }),
                  )
                }
              >
                <Check size={17} />
                Завершить по плану
              </button>
              <button onClick={() => setCloseStage("completed")}>
                Скорректировать расход
              </button>
            </div>
          </div>
          <div className="actions">
            {r.stage === "planned" && (
              <button onClick={() => setEdit(true)}>
                Изменить план партии
              </button>
            )}
            <button
              className="danger-text"
              onClick={() => setCloseStage("failed")}
            >
              Брак / остановка
            </button>
            <button onClick={() => setCloseStage("cancelled")}>
              Отменить запуск
            </button>
          </div>
        </section>
      )}
      <div className="launch-grid">
        <section className="panel">
          <h2>{closed(r) ? "Подтверждённый расход" : "План и резерв"}</h2>
          <PagedTable
            head={
              <>
                <tr>
                  <th>Материал</th>
                  <th>План</th>
                  <th>{closed(r) ? "Факт" : "Доступно с резервом запуска"}</th>
                </tr>
              </>
            }
          >
            {r.lines.map((l) => (
              <tr key={l.materialId}>
                <td>
                  {s.materials.find((m) => m.id === l.materialId) ? (
                    <MaterialIdentity
                      material={s.materials.find((m) => m.id === l.materialId)!}
                      name={l.name}
                    />
                  ) : (
                    <>
                      {l.name}
                      <small>{units[l.unit]}</small>
                    </>
                  )}
                </td>
                <td>{qty(l.qty)}</td>
                <td>
                  {qty(
                    closed(r)
                      ? (r.actual?.[l.materialId] ?? 0)
                      : stock(s, l.materialId).available + l.qty,
                  )}
                </td>
              </tr>
            ))}
          </PagedTable>
          <p className="muted">
            Рецепт и цены зафиксированы при запуске.{" "}
            {r.source && sources[r.source]}
          </p>
          {r.reason && <p className="prewrap">{r.reason}</p>}
        </section>
        <section className="panel">
          <h2>
            {r.actualCost
              ? "Фактическая себестоимость"
              : "Плановая себестоимость"}
          </h2>
          <Costs cost={r.actualCost ?? r.cost} />
          <p className="muted">
            Печать: {qty(r.actualHours ?? r.hours)} ч · работа:{" "}
            {qty(r.actualLaborHours ?? r.laborHours)} ч
          </p>
        </section>
      </div>
      <RunTasks runId={r.id} />
      <NoteFeed target="run" ownerId={r.id} />
      {closeStage && (
        <CloseForm
          r={r}
          stage={closeStage}
          onClose={() => setCloseStage(null)}
        />
      )}{" "}
      {edit && <ReviseForm r={r} onClose={() => setEdit(false)} />}
    </>
  );
}
function ReviseForm({ r, onClose }: { r: Run; onClose: () => void }) {
  const { act, state } = useApp();
  const [count, setCount] = useState(r.count),
    [hours, setHours] = useState(r.hours),
    [factor, setFactor] = useState(r.factor),
    [revision] = useState(state.revision);
  return (
    <Modal title="Изменить план" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act(
              () =>
                mutate((s) => revise(s, r.id, count, hours, factor), revision),
              "План и резервы обновлены",
            )
          )
            onClose();
        }}
      >
        <Field label="Экземпляров">
          <Num value={count} min={1} step={1} onChange={setCount} />
        </Field>
        <Field label="Время всей партии, ч">
          <Num value={hours} onChange={setHours} />
        </Field>
        <Field label="Коэффициент филамента / смолы">
          <Num value={factor} onChange={setFactor} />
        </Field>
        <p>
          Сохраняется снимок рецепта и цен. Проверяется доступный остаток и
          обновляются резервы.
        </p>
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
function CloseForm({
  r,
  stage,
  onClose,
}: {
  r: Run;
  stage: "completed" | "failed" | "cancelled";
  onClose: () => void;
}) {
  const { act, state } = useApp(),
    [revision] = useState(state.revision);
  const [values, setValues] = useState(
      Object.fromEntries(
        r.lines.map((l) => [l.materialId, stage === "completed" ? l.qty : 0]),
      ),
    ),
    [source, setSource] = useState<Source>("estimated"),
    [reason, setReason] = useState(""),
    [percent, setPercent] = useState(0),
    [hours, setHours] = useState(stage === "completed" ? r.hours : 0),
    [labor, setLabor] = useState(stage === "completed" ? r.laborHours : 0),
    [extra, setExtra] = useState(stage === "completed" ? r.cost.extra : 0);
  return (
    <Modal
      title={
        stage === "completed"
          ? "Подтвердить фактический расход"
          : stage === "failed"
            ? "Брак / остановка печати"
            : "Отменить запуск"
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act(
              () =>
                mutate(
                  (s) =>
                    finish(
                      s,
                      r.id,
                      stage,
                      values,
                      source,
                      reason,
                      hours,
                      labor,
                      extra,
                    ),
                  revision,
                ),
              "Запуск закрыт, резерв освобождён",
            )
          )
            onClose();
        }}
      >
        <p>
          {stage === "completed"
            ? "Подставлен план. Исправьте только существенные отклонения."
            : "Укажите только уже потраченные материалы. Нулевые значения означают отсутствие расхода."}
        </p>
        {stage === "failed" && (
          <div className="info-strip">
            <Field label="Грубая оценка печати, %">
              <Num value={percent} onChange={setPercent} />
            </Field>
            <button
              type="button"
              onClick={() => {
                if (!Number.isFinite(percent) || percent < 0 || percent > 100)
                  return;
                setValues(
                  Object.fromEntries(
                    r.lines.map((l) => [
                      l.materialId,
                      ["filament", "resin"].includes(
                        state.materials.find((m) => m.id === l.materialId)!
                          .category,
                      )
                        ? Math.round(l.qty * percent * 10) / 1000
                        : values[l.materialId],
                    ]),
                  ),
                );
                setSource("estimated");
              }}
            >
              Применить к материалу печати
            </button>
            <small>
              Слои расходуют разное количество материала. Это приблизительная
              оценка.
            </small>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Материал</th>
                <th>План</th>
                <th>Потрачено</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.materialId}>
                  <td>{l.name}</td>
                  <td>
                    {qty(l.qty)} {units[l.unit]}
                  </td>
                  <td>
                    <Num
                      label={"Расход " + l.name}
                      value={values[l.materialId]}
                      onChange={(v) =>
                        setValues({ ...values, [l.materialId]: v })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-grid three">
          <Field label="Печать, ч">
            <Num value={hours} onChange={setHours} />
          </Field>
          <Field label="Работа, ч">
            <Num value={labor} onChange={setLabor} />
          </Field>
          <Field label="Прочие расходы, ₽">
            <Num
              value={extra / 100}
              onChange={(v) => setExtra(Math.round(v * 100))}
            />
          </Field>
        </div>
        <Field label="Источник расхода">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
          >
            {Object.entries(sources)
              .filter(([k]) => k !== "inventory")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Комментарий / причина">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Назад
          </button>
          <button className="primary">Подтвердить и закрыть запуск</button>
        </div>
      </form>
    </Modal>
  );
}
