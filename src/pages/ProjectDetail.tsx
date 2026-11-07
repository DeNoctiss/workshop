import { MaterialKind } from "../components/StockStatus";
import { useState } from "react";
import {
  Pencil,
  Copy,
  Archive,
  Play,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useApp } from "../components/context";
import {
  Header,
  Back,
  Badge,
  Field,
  Num,
  Costs,
  Photo,
  money,
  qty,
  date,
  Empty,
} from "../components/ui";
import { closed, units, stages } from "../domain/model";
import {
  plan,
  stock,
  planLaunch,
  startLaunch,
  type LaunchMode,
} from "../domain/engine";
import { mutate, copyProject } from "../data/db";
import { ProjectForm } from "./ProjectForm";
import { NoteFeed, CustomerFields } from "../components/WorkspaceNotes";
import { emptyCustomer } from "../domain/workspace";
import { updateCustomer } from "../domain/workflow";
import { Paged } from "../components/Paged";
import { readiness } from "./Projects";
export function ProjectDetail({
  id,
  calculator = false,
}: {
  id: string;
  calculator?: boolean;
}) {
  const { state: s, assets, act, confirm } = useApp();
  const p = s.projects.find((x) => x.id === id);
  const [customer, setCustomer] = useState(emptyCustomer),
    [editing, setEditing] = useState(false),
    [count, setCount] = useState(1),
    [launchMode, setLaunchMode] = useState<LaunchMode>("batch"),
    [printerId, setPrinterId] = useState(p?.printerId || ""),
    [hours, setHours] = useState<number | undefined>(),
    [factor, setFactor] = useState<number | undefined>();
  if (!p)
    return (
      <Empty title="Выберите проект">
        <a href="#/projects">Перейти к проектам</a>
      </Empty>
    );
  let result: ReturnType<typeof plan> | undefined,
    error = "";
  try {
    result = planLaunch(s, p, count, printerId, launchMode, { hours, factor });
  } catch (e) {
    error = (e as Error).message;
  }
  const status = readiness(s, p),
    image = assets.find((a) => a.projectId === id && a.cover),
    activeRuns = s.runs
      .filter((r) => r.projectId === id && !closed(r))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeRunLinks = activeRuns.map((r) => (
    <a className="history-row" key={r.id} href={"#/runs/" + r.id}>
      <span>
        {date(r.createdAt)} · {r.count} шт.
      </span>
      <Badge>{stages[r.stage]}</Badge>
      <strong>Открыть производство</strong>
    </a>
  ));
  return (
    <>
      <Back />
      <Header
        title={calculator ? "Калькулятор · " + p.title : p.title}
        description={p.description}
      >
        <a className="button primary" href={"#/board/" + id}>
          Открыть доску проекта
        </a>
        <button onClick={() => setEditing(true)}>
          <Pencil size={16} />
          Рецепт
        </button>
        <button
          onClick={() =>
            void act(async () => {
              const id = await copyProject(p.id);
              location.hash = "/projects/" + id;
            }, "Копия создана")
          }
        >
          <Copy size={16} />
          Копия
        </button>
        <button
          onClick={() =>
            confirm(
              p.archived ? "Вернуть проект?" : "Архивировать проект?",
              "История запусков будет сохранена.",
              () =>
                mutate((d) => {
                  d.projects.find((x) => x.id === id)!.archived = !p.archived;
                }),
            )
          }
        >
          <Archive size={16} />
          {p.archived ? "Вернуть" : "В архив"}
        </button>
      </Header>
      <div className="project-summary">
        {image && <Photo asset={image} />}
        <Badge tone={status.tone}>{status.label}</Badge>
        <span>{p.technology}</span>
        <span>{p.size}</span>
        <span>{s.printers.find((x) => x.id === p.printerId)?.name}</span>
        {p.tags.map((t) => (
          <span className="tag" key={t}>
            {t}
          </span>
        ))}
      </div>
      {!calculator && activeRuns.length > 0 && (
        <section
          className="panel project-active-runs"
          aria-labelledby="active-runs-title"
        >
          <div className="section-head">
            <h2 id="active-runs-title">Активные производства</h2>
            <Badge tone="blue">{activeRuns.length}</Badge>
          </div>
          <p className="muted">
            Открыть текущую работу или запланировать отдельный новый запуск
            ниже.
          </p>
          {activeRuns.length > 10 ? (
            <Paged>{activeRunLinks}</Paged>
          ) : (
            <div>{activeRunLinks}</div>
          )}
        </section>
      )}
      <div className="launch-grid">
        <section className="panel launch">
          <div className="section-head">
            <h2>{calculator ? "Расчёт партии" : "Запуск в производство"}</h2>
            <Badge tone="blue">План</Badge>
          </div>
          <Field label="Как производить партию">
            <div className="segmented" role="group" aria-label="Режим запуска">
              <button
                type="button"
                aria-pressed={launchMode === "batch"}
                onClick={() => setLaunchMode("batch")}
              >
                Один запуск · {count} шт.
              </button>
              <button
                type="button"
                aria-pressed={launchMode === "separate"}
                onClick={() => setLaunchMode("separate")}
              >
                Отдельные запуски · по 1 шт.
              </button>
            </div>
          </Field>
          <p className="muted">
            {launchMode === "batch"
              ? "Одна запись производства. Расход «на партию» учитывается один раз."
              : "Каждое изделие можно завершить или остановить отдельно. Расход «на партию» повторяется для каждого запуска. Общее время ниже делится поровну; работа и прочие расходы считаются на каждое изделие."}
          </p>
          <div className="form-grid">
            <Field label="Экземпляров">
              <Num value={count} min={1} step={1} onChange={setCount} />
            </Field>
            <Field label="Принтер">
              <select
                value={printerId}
                onChange={(e) => {
                  setPrinterId(e.target.value);
                  setHours(undefined);
                  setFactor(undefined);
                }}
              >
                <option value="">Выберите</option>
                {s.printers
                  .filter((x) => x.active && x.technology === p.technology)
                  .map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Время всей партии, ч">
              <Num
                value={hours ?? result?.hours ?? p.hours * count}
                onChange={setHours}
              />
            </Field>
            <Field
              label="Коэффициент филамента / смолы"
              hint="1 = расход по рецепту; краски и упаковка не меняются"
            >
              <Num value={factor ?? result?.factor ?? 1} onChange={setFactor} />
            </Field>
          </div>
          <details className="customer-disclosure">
            <summary>Заказчик и пожелания (необязательно)</summary>
            <CustomerFields value={customer} onChange={setCustomer} />
          </details>
          {error ? (
            <p className="warning-text">{error}</p>
          ) : (
            result && (
              <div
                className={
                  result.shortages.length ? "availability bad" : "availability"
                }
              >
                {result.shortages.length ? (
                  <AlertTriangle size={20} />
                ) : (
                  <CheckCircle2 size={20} />
                )}
                <span>
                  {result.shortages.length
                    ? `Не хватает ${result.shortages.length} позиций`
                    : "Материалов достаточно"}
                  <small>Учитываются резервы других производств</small>
                </span>
              </div>
            )
          )}
          <button
            className="primary launch-button"
            disabled={
              !!error ||
              !result ||
              !!result.shortages.length ||
              !result.lines.length ||
              p.archived
            }
            onClick={() =>
              confirm(
                "Запустить производство?",
                `${count} экземпляров, ${launchMode === "batch" ? "один запуск" : count + " отдельных запусков"}. Материалы будут зарезервированы; списание произойдёт при завершении.`,
                async () => {
                  let runId = "";
                  await mutate((d) => {
                    const runs = startLaunch(
                      d,
                      id,
                      count,
                      printerId,
                      launchMode,
                      {
                        hours,
                        factor,
                      },
                    );
                    runs.forEach((r) => updateCustomer(d, r.id, customer));
                    runId = runs[0].id;
                  });
                  location.hash =
                    launchMode === "separate" && count > 1
                      ? "/runs"
                      : "/runs/" + runId;
                },
              )
            }
          >
            <Play size={17} />
            Запустить производство
          </button>
        </section>
        <section className="panel">
          <h2>Плановая себестоимость</h2>
          {result ? (
            <>
              <Costs cost={result.cost} />
              <p className="muted">
                {money(result.cost.total / count)} за экземпляр · не цена
                продажи
              </p>
            </>
          ) : (
            <p>Укажите параметры запуска.</p>
          )}
        </section>
      </div>
      <section className="panel material-section">
        <div className="section-head">
          <div>
            <h2>Расходные материалы</h2>
            <p>
              Потребность для выбранной партии. Краски в мл — приблизительная
              оценка.
            </p>
          </div>
          <button onClick={() => setEditing(true)}>
            <Pencil size={16} />
            Изменить рецепт
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Материал</th>
                <th>На 1 шт.¹</th>
                <th>На запуск</th>
                <th>Склад</th>
                <th>Резерв</th>
                <th>Доступно</th>
                <th>Стоимость</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {result?.lines.map((l) => {
                const v = stock(s, l.materialId),
                  m = s.materials.find((x) => x.id === l.materialId)!;
                return (
                  <tr key={l.materialId}>
                    <td>
                      <div className="material-name">
                        <MaterialKind category={m.category} />
                        {m.colorEnabled !== false && (
                          <span
                            className="swatch"
                            style={{ background: m.color }}
                          />
                        )}
                        <div>
                          <strong>{l.name}</strong>
                          <small>{units[l.unit]}</small>
                        </div>
                      </div>
                    </td>
                    <td>{qty(l.qty / count)}</td>
                    <td>
                      <strong>{qty(l.qty)}</strong>
                    </td>
                    <td>{qty(v.physical)}</td>
                    <td>{qty(v.reserved)}</td>
                    <td>{qty(v.available)}</td>
                    <td>{money(l.qty * l.unitCost)}</td>
                    <td>
                      <Badge
                        tone={
                          v.available < l.qty
                            ? "danger"
                            : v.available - l.qty < m.minimum
                              ? "warning"
                              : "success"
                        }
                      >
                        {v.available < l.qty
                          ? "Не хватает"
                          : v.available - l.qty < m.minimum
                            ? "Мало после запуска"
                            : "Хватает"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!result?.lines.length && <p>Добавьте расходные материалы в рецепт.</p>}
        <p className="muted">
          ¹ Средний расход на экземпляр выбранной партии, включая распределённые
          общие расходы. <a href="#/inventory">Проверить остатки</a>
        </p>
      </section>
      {!!p.mixes.length && (
        <section className="panel">
          <h2>Смеси в рецепте</h2>
          <div className="mix-list">
            {p.mixes.map((m) => (
              <div key={m.id}>
                <strong>{m.name}</strong>
                <p>
                  {m.volume} мл / шт. + {m.lossPercent}% потерь
                </p>
                {m.components.map((c, i) => (
                  <small key={i}>
                    {s.materials.find((x) => x.id === c.materialId)?.name}:{" "}
                    {qty(
                      (c.share /
                        m.components.reduce((n, x) => n + x.share, 0)) *
                        100,
                    )}
                    %
                  </small>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
      <details className="panel">
        <summary>История запусков</summary>
        <Paged>
          {s.runs
            .filter((r) => r.projectId === id)
            .slice()
            .reverse()
            .map((r) => (
              <a className="history-row" key={r.id} href={"#/runs/" + r.id}>
                <span>
                  {date(r.createdAt)} · {r.count} шт.
                </span>
                <Badge>{stages[r.stage]}</Badge>
                <strong>{money(r.actualCost?.total ?? r.cost.total)}</strong>
              </a>
            ))}
        </Paged>
      </details>
      {!calculator && <NoteFeed target="project" ownerId={id} />}{" "}
      {editing && <ProjectForm initial={p} onClose={() => setEditing(false)} />}
    </>
  );
}
export function Calculator() {
  const { state } = useApp();
  const [id, setId] = useState("");
  return (
    <>
      <div className="panel calculator-picker">
        <Field label="Изделие для расчёта">
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Выберите проект</option>
            {state.projects
              .filter((p) => !p.archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {id ? (
        <ProjectDetail key={id} id={id} calculator />
      ) : (
        <Empty title="Калькулятор себестоимости">
          <p>Выберите изделие, затем сравните оборудование и размер партии.</p>
        </Empty>
      )}
    </>
  );
}
