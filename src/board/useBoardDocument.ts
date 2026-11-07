import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../components/context";
import { emptyBoard, serializableNodes } from "../domain/migrations";
import type { ProjectBoard } from "../domain/workspace";
import type { Asset } from "../domain/model";
import { saveBoard, readState, errorText } from "../data/db";
export function useBoardDocument(projectId: string) {
  const { state } = useApp();
  const [graph, setGraph] = useState<ProjectBoard>(() =>
    structuredClone(
      state.boards.find((b) => b.projectId === projectId) ??
        emptyBoard(projectId),
    ),
  );
  const current = useRef(graph),
    base = useRef(graph.revision),
    generation = useRef(0),
    dirty = useRef(false),
    pending = useRef(new Map<string, Asset>()),
    saving = useRef<Promise<boolean> | null>(null),
    alive = useRef(true);
  const [version, setVersion] = useState(0),
    [status, setStatus] = useState("Сохранено"),
    [error, setError] = useState("");
  const history = useRef<{ past: ProjectBoard[]; future: ProjectBoard[] }>({
    past: [],
    future: [],
  });
  const clean = (b: ProjectBoard) => ({
    ...structuredClone(b),
    nodes: serializableNodes(b.nodes),
  });
  const checkpoint = () => {
    history.current.past = [
      ...history.current.past.slice(-39),
      clean(current.current),
    ];
    history.current.future = [];
  };
  const change = (next: ProjectBoard, remember = true, persist = true) => {
    if (remember) checkpoint();
    current.current = next;
    setGraph(next);
    if (persist) {
      dirty.current = true;
      generation.current++;
      setVersion(generation.current);
      setStatus("Есть изменения");
    }
  };
  const persist = useCallback(async (): Promise<boolean> => {
    if (saving.current) {
      if (!(await saving.current)) return false;
    }
    if (!dirty.current) return true;
    const snapshot = current.current,
      at = generation.current,
      assets = Array.from(pending.current.values());
    if (alive.current) setStatus("Сохранение…");
    const promise = saveBoard(snapshot, base.current, assets)
      .then((saved) => {
        base.current = saved.revision;
        assets.forEach((a) => pending.current.delete(a.id));
        if (at === generation.current) dirty.current = false;
        if (alive.current) {
          setStatus(dirty.current ? "Есть изменения" : "Сохранено");
          setError("");
        }
        return true;
      })
      .catch((e) => {
        if (alive.current) {
          setError(errorText(e));
          setStatus("Ошибка сохранения");
        }
        return false;
      });
    saving.current = promise;
    const ok = await promise;
    if (saving.current === promise) saving.current = null;
    return ok;
  }, []);
  const flush = useCallback(async () => {
    for (let i = 0; i < 3; i++) {
      if (!(await persist())) return false;
      if (!dirty.current) return true;
    }
    return false;
  }, [persist]);
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void persist(), 700);
    return () => clearTimeout(t);
  }, [version, persist]);
  useEffect(() => {
    alive.current = true;
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden") void persist();
    };
    const backup = (e: Event) => {
      if (dirty.current || saving.current || pending.current.size) {
        e.preventDefault();
        if (alive.current)
          setError("Сначала дождитесь сохранения доски перед выгрузкой ZIP.");
      }
    };
    const navigate = (e: MouseEvent) => {
      const a = (e.target as Element).closest<HTMLAnchorElement>(
        'a[href^="#/"]',
      );
      if (a && dirty.current && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const href = a.getAttribute("href")!;
        void flush().then((ok) => {
          if (ok) location.hash = href;
        });
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("workshop-before-backup", backup);
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("click", navigate, true);
    return () => {
      alive.current = false;
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("workshop-before-backup", backup);
      document.removeEventListener("visibilitychange", hide);
      document.removeEventListener("click", navigate, true);
      void persist();
    };
  }, [persist, flush]);
  useEffect(() => {
    const remote = state.boards.find((b) => b.projectId === projectId);
    if (remote && remote.revision !== base.current && !saving.current) {
      if (dirty.current) {
        setError(
          "Доска изменена в другой вкладке. Скачайте черновик перед загрузкой актуальной версии.",
        );
        setStatus("Конфликт изменений");
      } else {
        base.current = remote.revision;
        current.current = structuredClone(remote);
        setGraph(current.current);
        history.current = { past: [], future: [] };
      }
    }
  }, [state.boards, projectId]);
  const undo = (redo = false) => {
    const from = redo ? history.current.future : history.current.past,
      to = redo ? history.current.past : history.current.future;
    const next = from.pop();
    if (!next) return;
    to.push(clean(current.current));
    change(next, false);
  };
  const reload = async () => {
    if (saving.current) await saving.current;
    const b =
      (await readState()).boards.find((b) => b.projectId === projectId) ??
      emptyBoard(projectId);
    base.current = b.revision;
    dirty.current = false;
    pending.current.clear();
    current.current = b;
    setGraph(b);
    history.current = { past: [], future: [] };
    setError("");
    setStatus("Сохранено");
    return b;
  };
  return {
    graph,
    current,
    change,
    checkpoint,
    undo,
    canUndo: !!history.current.past.length,
    canRedo: !!history.current.future.length,
    status,
    error,
    flush,
    reload,
    addAssets: (assets: Asset[]) =>
      assets.forEach((a) => pending.current.set(a.id, a)),
    draft: () => clean(current.current),
  };
}
