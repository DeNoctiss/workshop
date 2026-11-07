import { Paged } from "../components/Paged";
import { useState } from "react";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Layers,
  ArrowUpRight,
  Box,
} from "lucide-react";
import { useApp } from "../components/context";
import { Header, Empty, Badge, Photo, money } from "../components/ui";
import { closed, newProject, type Project, type State } from "../domain/model";
import { plan } from "../domain/engine";
import { ProjectForm } from "./ProjectForm";
export function readiness(s: State, p: Project) {
  if (p.archived)
    return { label: "Архив", tone: "neutral", key: "archive", cost: 0 };
  let cost = 0,
    short = false;
  try {
    const a = plan(s, p);
    cost = a.cost.total;
    short = a.shortages.length > 0;
    if (!a.lines.length)
      return { label: "Черновик", tone: "neutral", key: "draft", cost };
  } catch {
    return { label: "Черновик", tone: "neutral", key: "draft", cost };
  }
  if (s.runs.some((r) => r.projectId === p.id && !closed(r)))
    return { label: "В производстве", tone: "blue", key: "active", cost };
  return {
    label: short ? "Требуются материалы" : "Готов к запуску",
    tone: short ? "warning" : "success",
    key: short ? "short" : "ready",
    cost,
  };
}
export function Projects() {
  const { state: s, assets } = useApp();
  const [query, setQuery] = useState(""),
    [tech, setTech] = useState(""),
    [status, setStatus] = useState(""),
    [printer, setPrinter] = useState(""),
    [sort, setSort] = useState("updated"),
    [list, setList] = useState(false),
    [archive, setArchive] = useState(false),
    [edit, setEdit] = useState<Project | null>(null);
  const items = s.projects
    .filter(
      (p) =>
        p.archived === archive &&
        `${p.title} ${p.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!tech || p.technology === tech) &&
        (!printer || p.printerId === printer) &&
        (!status || readiness(s, p).key === status),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : sort === "cost"
          ? readiness(s, a).cost - readiness(s, b).cost
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const firstProject = s.projects.length === 0;
  const inView = s.projects.some((p) => p.archived === archive);
  const resetFilters = () => {
    setQuery("");
    setTech("");
    setStatus("");
    setPrinter("");
  };
  return (
    <>
      <Header
        title="Проекты"
        description="Ваши изделия, рецепты и всё необходимое для следующего запуска."
      >
        {!firstProject && (
          <button className="primary" onClick={() => setEdit(newProject())}>
            <Plus size={18} />
            Новый проект
          </button>
        )}
      </Header>
      {!firstProject && (
        <div className="info-strip">
          <Layers size={23} />
          <span>
            Изделия{" "}
            <strong>{s.projects.filter((p) => !p.archived).length}</strong>
          </span>
          <span>
            Активные производства{" "}
            <strong>{s.runs.filter((r) => !closed(r)).length}</strong>
          </span>
          <a href="#/materials">
            Перейти к запасам <ArrowUpRight size={16} />
          </a>
        </div>
      )}
      {!firstProject && (
        <div className="toolbar">
          <div className="search">
            <Search size={18} />
            <input
              placeholder="Найти проект или тег…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Технология"
            value={tech}
            onChange={(e) => setTech(e.target.value)}
          >
            <option value="">Все технологии</option>
            <option>FDM</option>
            <option>SLA</option>
          </select>
          <select
            aria-label="Статус проекта"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Любой статус</option>
            <option value="ready">Готов к запуску</option>
            <option value="active">В производстве</option>
            <option value="short">Требуются материалы</option>
            <option value="draft">Черновик</option>
          </select>
          <select
            aria-label="Принтер"
            value={printer}
            onChange={(e) => setPrinter(e.target.value)}
          >
            <option value="">Все принтеры</option>
            {s.printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Сортировка"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="updated">Сначала обновлённые</option>
            <option value="name">По названию</option>
            <option value="cost">По себестоимости</option>
          </select>
          <div className="segmented">
            <button
              aria-label="Плитка"
              className={!list ? "selected" : ""}
              onClick={() => setList(false)}
            >
              <LayoutGrid size={18} />
            </button>
            <button
              aria-label="Список"
              className={list ? "selected" : ""}
              onClick={() => setList(true)}
            >
              <List size={18} />
            </button>
          </div>
        </div>
      )}
      {!firstProject && (
        <div className="section-head">
          <span className="muted">{items.length} проектов</span>
          <label className="check">
            <input
              type="checkbox"
              checked={archive}
              onChange={(e) => setArchive(e.target.checked)}
            />
            Архив
          </label>
        </div>
      )}
      {!items.length ? (
        <Empty
          title={
            firstProject
              ? "Начнём с первого изделия"
              : inView
                ? "Ничего не найдено"
                : archive
                  ? "Архив пуст"
                  : "Нет активных проектов"
          }
        >
          {firstProject ? (
            <>
              <p>
                Создайте рецепт проекта. Принтер и материалы можно добавить
                позже.
              </p>
              <button className="primary" onClick={() => setEdit(newProject())}>
                <Plus size={18} /> Создать проект
              </button>
            </>
          ) : inView ? (
            <>
              <p>Измените поиск или фильтры, чтобы увидеть проекты.</p>
              <button onClick={resetFilters}>Сбросить фильтры</button>
            </>
          ) : (
            <>
              <p>
                {archive
                  ? "Архивных проектов пока нет."
                  : "Все проекты находятся в архиве."}
              </p>
              <button
                onClick={() => {
                  resetFilters();
                  setArchive(!archive);
                }}
              >
                {archive ? "Показать активные" : "Открыть архив"}
              </button>
            </>
          )}
        </Empty>
      ) : (
        <Paged className={list ? "project-list" : "cards"}>
          {items.map((p) => {
            const status = readiness(s, p),
              photos = assets
                .filter((a) => a.projectId === p.id && a.cover)
                .sort((a, b) => a.order - b.order)
                .slice(0, 2);
            return (
              <a
                href={"#/projects/" + p.id}
                className="project-card"
                key={p.id}
              >
                <div className="project-visual">
                  {photos.length ? (
                    photos.map((a) => <Photo key={a.id} asset={a} />)
                  ) : (
                    <div className="project-placeholder">
                      <Box size={68} />
                      <span>{p.size || p.technology}</span>
                    </div>
                  )}
                  <span className="technology">{p.technology}</span>
                </div>
                <div className="project-body">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <h2>{p.title}</h2>
                  <p>
                    {s.printers.find((x) => x.id === p.printerId)?.name ||
                      "Принтер не выбран"}
                  </p>
                  <div className="card-bottom">
                    <span>
                      <small>Себестоимость / 1 шт.</small>
                      <strong>{money(status.cost)}</strong>
                    </span>
                    <ArrowUpRight size={22} />
                  </div>
                </div>
              </a>
            );
          })}
        </Paged>
      )}
      {edit && <ProjectForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
