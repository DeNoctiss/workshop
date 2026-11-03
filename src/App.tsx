import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ShoppingCart,
  Boxes,
  Layers,
  Factory,
  Package,
  Printer,
  Calculator,
  ClipboardCheck,
  Settings as SettingsIcon,
  Download,
  Menu,
  X,
  FlaskConical,
} from "lucide-react";
import { Context } from "./components/context";
import { Empty, Modal } from "./components/ui";
import { emptyState, type State, type AssetMeta } from "./domain/model";
import { Notifications } from "./components/Notifications";
import { StockWarnings } from "./components/StockStatus";
import { readState, db, replaceAll, errorText } from "./data/db";
import { demoState } from "./data/demo";
import { Projects } from "./pages/Projects";
import {
  ProjectDetail,
  Calculator as CalculatorPage,
} from "./pages/ProjectDetail";
import { Inventory } from "./pages/Inventory";
import { Materials } from "./pages/Materials";
import { Printers } from "./pages/Printers";
import { Runs } from "./pages/Runs";
import { Settings, exportBackup } from "./pages/Settings";
const ProjectBoardPage = lazy(() => import("./board/ProjectBoardPage"));
const ShoppingPage = lazy(() => import("./shopping/ShoppingPage"));
const CatalogPage = lazy(() => import("./catalog/CatalogPage"));
const navigation = [
  ["projects", "Проекты", Layers],
  ["runs", "Производства", Factory],
  ["materials", "Материалы", Package],
  ["shopping", "Закупки", ShoppingCart],
  ["catalog", "Каталог товаров", FlaskConical],
  ["printers", "Принтеры", Printer],
  ["calculator", "Калькулятор", Calculator],
  ["inventory", "Инвентаризация", ClipboardCheck],
  ["settings", "Настройки", SettingsIcon],
] as const;
export default function App() {
  const [state, setState] = useState<State>(emptyState),
    [assets, setAssets] = useState<AssetMeta[]>([]),
    [loading, setLoading] = useState(true),
    [route, setRoute] = useState(location.hash.slice(2) || "projects"),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [confirmation, setConfirmation] = useState<{
      title: string;
      description: string;
      action: () => Promise<unknown>;
    } | null>(null);
  const working = useRef(false),
    refreshVersion = useRef(0);
  async function refresh() {
    const version = ++refreshVersion.current;
    try {
      const [s, a] = await Promise.all([readState(), db.assetIndex.toArray()]);
      if (version === refreshVersion.current) {
        setState(s);
        setAssets(a);
      }
    } catch (e) {
      setToast({ text: errorText(e), error: true });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const hash = () => {
      setRoute(location.hash.slice(2) || "projects");
      setMenu(false);
      window.scrollTo(0, 0);
    };
    const update = () => void refresh();
    window.addEventListener("hashchange", hash);
    window.addEventListener("workshop-change", update);
    return () => {
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("workshop-change", update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);
  useEffect(() => {
    if (toast && !toast.error) {
      const timer = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function act(fn: () => Promise<unknown>, message?: string) {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (message) setToast({ text: message, error: false });
      return true;
    } catch (e) {
      setToast({ text: errorText(e), error: true });
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const [page, id] = route.split("/");
  let content =
    page === "projects" ? (
      id ? (
        <ProjectDetail key={id} id={id} />
      ) : (
        <Projects />
      )
    ) : page === "runs" ? (
      <Runs id={id} />
    ) : page === "materials" ? (
      <Materials key={route} initialRisk={id} />
    ) : page === "shopping" ? (
      <ShoppingPage />
    ) : page === "inventory" ? (
      <Inventory />
    ) : page === "printers" ? (
      <Printers />
    ) : page === "calculator" ? (
      <CalculatorPage />
    ) : page === "board" && id ? (
      <Suspense fallback={<Empty title="Открываем доску…" />}>
        <ProjectBoardPage key={id} projectId={id} />
      </Suspense>
    ) : page === "catalog" ? (
      <Suspense fallback={<Empty title="Открываем каталог…" />}>
        <CatalogPage />
      </Suspense>
    ) : page === "settings" ? (
      <Settings />
    ) : (
      <Empty title="Страница не найдена">
        <a href="#/projects">К проектам</a>
      </Empty>
    );
  return (
    <Context.Provider
      value={{
        state,
        assets,
        busy,
        act,
        confirm: (title, description, action) =>
          setConfirmation({ title, description, action }),
      }}
    >
      <div className="app-shell">
        {menu && (
          <button
            className="sidebar-overlay"
            aria-label="Закрыть меню"
            onClick={() => setMenu(false)}
          />
        )}
        <aside className={menu ? "sidebar open" : "sidebar"}>
          <a className="brand" href="#/projects">
            <span className="brand-mark">
              <Boxes size={27} />
            </span>
            <span>
              Мастерская<small>ПЕЧАТЬ · ПОКРАСКА · УЧЁТ</small>
            </span>
          </a>
          <div className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
          <nav>
            {navigation.map(([key, label, Icon]) => (
              <a
                key={key}
                href={"#/" + key}
                className={page === key ? "active" : ""}
              >
                <Icon size={21} />
                {label}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <p>
              <span className="online-dot" />
              Данные на этом устройстве
            </p>
            <small>Без облака и подписок</small>
            <button
              onClick={() =>
                void act(
                  exportBackup,
                  "Резервная копия подготовлена к скачиванию",
                )
              }
            >
              <Download size={16} />
              Резервная копия
            </button>
          </div>
        </aside>
        <div className="workspace">
          <div className="topbar">
            <button
              className="mobile-menu icon"
              aria-label="Открыть меню"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <div>
              <span>Моя мастерская</span>
              <span className="slash">/</span>
              <strong>
                {navigation.find(([key]) => key === page)?.[1] || "Проекты"}
              </strong>
            </div>
            <small>
              <span className="online-dot" />
              Локальное хранение
            </small>
            <Notifications />
          </div>
          <main aria-busy={busy}>
            {loading ? (
              <Empty title="Открываем мастерскую…" />
            ) : (
              <>
                {page === "projects" && !id && <StockWarnings />}
                {content}
                {page === "projects" &&
                  !id &&
                  !state.projects.length &&
                  !state.materials.length && (
                    <div className="demo-banner">
                      <FlaskConical size={27} />
                      <span>
                        <strong>Сначала попробовать на примере?</strong>
                        <small>
                          Три изделия HEADLINERS, материалы и один запуск. Цены
                          и расходы демонстрационные.
                        </small>
                      </span>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => replaceAll(demoState(), []),
                            "Демонстрационная мастерская загружена",
                          )
                        }
                      >
                        Загрузить пример
                      </button>
                    </div>
                  )}
              </>
            )}
          </main>
          <footer>
            <span>Мастерская · производственный блокнот</span>
            <span>Версия 0.6.0 · локальная база</span>
          </footer>
        </div>
      </div>
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={"toast " + (toast.error ? "error" : "")}
        >
          <span>{toast.text}</span>
          <button
            className="icon ghost"
            aria-label="Закрыть уведомление"
            onClick={() => setToast(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          Сохраняем…
        </div>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <p>{confirmation.description}</p>
          <div className="modal-actions">
            <button disabled={busy} onClick={() => setConfirmation(null)}>
              Отмена
            </button>
            <button
              disabled={busy}
              className="primary"
              onClick={async () => {
                if (await act(confirmation.action, "Готово"))
                  setConfirmation(null);
              }}
            >
              Подтвердить
            </button>
          </div>
        </Modal>
      )}
    </Context.Provider>
  );
}
