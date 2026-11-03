import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as PointerEvt,
  type KeyboardEvent as KeyEvt,
} from "react";
import {
  WandSparkles,
  Lasso,
  PenTool,
  Brush,
  Eraser,
  Hand,
  Undo2,
  Redo2,
  Download,
  Plus,
  Minus,
  ScanLine,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Modal, Photo } from "../components/ui";
import { Paged } from "../components/Paged";
import { useApp } from "../components/context";
import { CatalogPicker } from "../catalog/CatalogPicker";
import { db } from "../data/db";
import { prepareImage } from "../data/images";
import { uid, type Asset } from "../domain/model";
import type { MaterialReference } from "../domain/workspace";
import {
  canvas,
  loadMask,
  paintComposite,
  maskCanvas,
  polygonMask,
  downloadPng,
  png,
} from "./canvas";
import { normalizeHex } from "./core/color";
import { PaintSession, type PaintFrame } from "./core/PaintSession";
import {
  combine,
  hasSelection,
  imagePoint,
  outlineMask,
  paintStroke,
  strokeCoverage,
  type Point,
  type SelectionMode,
} from "./core/selection";
import { PaintPanels, PaintRange, ToolButton } from "./PaintPanels";
import { usePaintSave, type PaintData } from "./usePaintSave";
import "./paint.css";
type Tool =
  | "wand"
  | "lasso"
  | "polygon"
  | "select-brush"
  | "select-erase"
  | "brush"
  | "erase"
  | "pan";
type Operation = {
  kind: "wand" | "refine";
  original: PaintFrame;
  point?: Point;
  mode: SelectionMode;
};
type Stroke = {
  original: PaintFrame;
  coverage: Uint8Array;
  last: Point;
  mode: SelectionMode;
  tool: Tool;
  points: Point[];
  pan?: { x: number; y: number; left: number; top: number };
};
const MODES: Record<SelectionMode, string> = {
  replace: "Новое",
  add: "Добавить",
  subtract: "Вычесть",
  intersect: "Пересечь",
};
export function PaintEditor({
  projectId,
  initial,
  onClose,
  onSave,
}: {
  projectId: string;
  initial?: PaintData;
  onClose: () => void;
  onSave: (data: PaintData, assets: Asset[]) => Promise<boolean>;
}) {
  const { assets, confirm } = useApp();
  const [sourceId, setSourceId] = useState(
      initial?.document.sourceAssetId ?? "",
    ),
    [sourceFile, setSourceFile] = useState<Asset | null>(null),
    [title, setTitle] = useState(initial?.title ?? "Вариант окраски");
  const originalInitial = useRef(initial),
    documentId = useRef(initial?.document.id ?? uid());
  const [tick, setTick] = useState(0),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [tool, setTool] = useState<Tool>("wand"),
    [mode, setMode] = useState<SelectionMode>("replace");
  const [tolerance, setTolerance] = useState(12),
    [contiguous, setContiguous] = useState(true),
    [diagonal, setDiagonal] = useState(false);
  const [diameter, setDiameter] = useState(36),
    [hardness, setHardness] = useState(100),
    [brushOpacity, setBrushOpacity] = useState(100);
  const [grow, setGrow] = useState(0),
    [feather, setFeather] = useState(0),
    [refining, setRefining] = useState(false),
    [processing, setProcessing] = useState(false);
  const [overlay, setOverlay] = useState<"contour" | "mask" | "none">(
      "contour",
    ),
    [overlayAlpha, setOverlayAlpha] = useState(35);
  const [before, setBefore] = useState(false),
    [zoom, setZoom] = useState(1),
    [sidebar, setSidebar] = useState(true),
    [space, setSpace] = useState(false);
  const [color, setColor] = useState("#d49a76"),
    [material, setMaterial] = useState<MaterialReference>(),
    [picker, setPicker] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    main = useRef<HTMLCanvasElement>(null),
    maskView = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    cursor = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null),
    session = useRef<PaintSession | null>(null),
    worker = useRef<Worker | null>(null),
    request = useRef(0),
    operation = useRef<Operation | null>(null),
    stroke = useRef<Stroke | null>(null);
  const polygon = useRef<Point[]>([]),
    hover = useRef<Point | null>(null),
    polygonMode = useRef<SelectionMode>("replace"),
    cache = useRef(new Map()),
    autoFit = useRef(true),
    spaceRef = useRef(false),
    drawFrame = useRef(0);
  const zoomAnchor = useRef<{ screen: Point; image: Point } | null>(null);
  const refresh = () => setTick((n) => n + 1);
  const s = session.current,
    f = s?.frame,
    active = s?.active;
  const { status, save } = usePaintSave({
    session: s,
    base: base.current,
    projectId,
    sourceId,
    sourceFile,
    documentId: documentId.current,
    title,
    tick,
    onSave,
  });
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const invalidate = () => {
    request.current++;
    setProcessing(false);
  };
  const finishOperation = () => {
    invalidate();
    operation.current = null;
    setRefining(false);
    session.current?.commit();
  };
  const cancelOperation = () => {
    invalidate();
    operation.current = null;
    session.current?.cancel();
    setRefining(false);
    refresh();
  };
  const cancelGesture = () => {
    if (stroke.current) {
      session.current?.cancel();
      stroke.current = null;
    }
    polygon.current = [];
    hover.current = null;
    refresh();
  };
  const action = (fn: () => void) => {
    try {
      cancelGesture();
      finishOperation();
      fn();
      setError("");
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const chooseTool = (next: Tool) =>
    action(() => {
      setTool(next);
      if (next === "select-brush") setMode("add");
      if (next === "select-erase") setMode("subtract");
    });
  const effectiveMode = (e: {
    shiftKey: boolean;
    altKey: boolean;
  }): SelectionMode =>
    e.shiftKey && e.altKey
      ? "intersect"
      : e.altKey
        ? "subtract"
        : e.shiftKey
          ? "add"
          : mode;
  const w = base.current?.width ?? 1,
    h = base.current?.height ?? 1;
  const point = (e: { clientX: number; clientY: number }) =>
    imagePoint(
      { x: e.clientX, y: e.clientY },
      main.current!.getBoundingClientRect(),
      w,
      h,
    );
  const runWand = (options = { tolerance, contiguous, diagonal }) => {
    const op = operation.current;
    if (!op || op.kind !== "wand") return;
    const id = ++request.current;
    setProcessing(true);
    worker.current?.postMessage({ type: "fill", id, point: op.point, options });
  };
  const runRefine = (g: number, blur: number) => {
    const op = operation.current;
    if (!op || op.kind !== "refine" || !op.original.selection) return;
    const id = ++request.current;
    setProcessing(true);
    worker.current?.postMessage({
      type: "refine",
      id,
      mask: op.original.selection,
      grow: g,
      feather: blur,
    });
  };
  const fit = () => {
    if (!stage.current || !base.current) return;
    autoFit.current = true;
    setZoom(
      Math.max(
        0.1,
        Math.min(
          2,
          (stage.current.clientWidth - 48) / base.current.width,
          (stage.current.clientHeight - 48) / base.current.height,
        ),
      ),
    );
  };
  const zoomTo = (next: number, anchor?: Point) => {
    const el = stage.current,
      im = main.current;
    if (!el || !im) return;
    const box = el.getBoundingClientRect(),
      a = anchor ?? {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      },
      p = imagePoint(a, im.getBoundingClientRect(), w, h);
    autoFit.current = false;
    const z = Math.max(0.1, Math.min(8, next));
    zoomAnchor.current = { screen: a, image: p };
    setZoom(z);
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current,
      el = stage.current,
      im = main.current;
    if (!anchor || !el || !im) return;
    zoomAnchor.current = null;
    const rect = im.getBoundingClientRect();
    el.scrollLeft +=
      rect.left + (anchor.image.x * rect.width) / w - anchor.screen.x;
    el.scrollTop +=
      rect.top + (anchor.image.y * rect.height) / h - anchor.screen.y;
  }, [zoom, w, h]);
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    setLoading(true);
    setReady(false);
    setError("");
    void (async () => {
      const asset = sourceFile ?? (await db.assets.get(sourceId));
      if (!asset) throw Error("Исходное изображение не найдено");
      const image = await createImageBitmap(asset.blob),
        init = originalInitial.current,
        ratio = Math.min(1, 2048 / Math.max(image.width, image.height));
      const width =
          init?.document.width ?? Math.max(1, Math.round(image.width * ratio)),
        height =
          init?.document.height ??
          Math.max(1, Math.round(image.height * ratio));
      const original = canvas(width, height);
      original.getContext("2d")!.drawImage(image, 0, 0, width, height);
      image.close();
      const layers = init
        ? await Promise.all(
            init.document.layers.map(async (l) => {
              const a = await db.assets.get(l.maskAssetId);
              if (!a) throw Error("Не найдена маска «" + l.name + "»");
              const { maskAssetId: _id, ...rest } = l;
              return { ...rest, mask: await loadMask(a.blob, width, height) };
            }),
          )
        : [];
      if (cancelled) return;
      base.current = original;
      session.current = new PaintSession(width, height, layers);
      const work = new Worker(
        new URL("./selection.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = work;
      work.onmessage = (e) => {
        if (cancelled || e.data.id !== request.current) return;
        setProcessing(false);
        const op = operation.current,
          engine = session.current;
        if (!op || !engine) return;
        if (e.data.error) {
          fail(e.data.error);
          engine.cancel();
          operation.current = null;
          setRefining(false);
          refresh();
          return;
        }
        const selection =
          op.kind === "wand"
            ? combine(op.original.selection, e.data.mask, op.mode)
            : e.data.mask;
        engine.preview({ ...op.original, selection });
        refresh();
      };
      work.onerror = (e) => {
        if (!cancelled) {
          setProcessing(false);
          fail(e.message || "Ошибка выделения");
          session.current?.cancel();
          operation.current = null;
          setRefining(false);
          refresh();
        }
      };
      const pixels = original
        .getContext("2d")!
        .getImageData(0, 0, width, height).data;
      work.postMessage({ type: "init", pixels, width, height }, [
        pixels.buffer,
      ]);
      setReady(true);
      setLoading(false);
      refresh();
    })().catch((e) => {
      if (!cancelled) {
        fail(e);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      request.current++;
      worker.current?.terminate();
      worker.current = null;
    };
  }, [sourceId, sourceFile]);
  useEffect(() => {
    if (!ready) return;
    requestAnimationFrame(() => {
      fit();
      root.current?.focus();
    });
    const el = stage.current;
    if (!el) return;
    const resize = new ResizeObserver(() => {
      if (autoFit.current) fit();
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, [ready]);
  useEffect(() => {
    const stop = () => {
      spaceRef.current = false;
      setSpace(false);
      setBefore(false);
      if (stroke.current) {
        session.current?.cancel();
        stroke.current = null;
        refresh();
      }
    };
    const up = () => setBefore(false);
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpace(false);
      }
    };
    window.addEventListener("blur", stop);
    window.addEventListener("pointerup", up);
    window.addEventListener("keyup", key);
    return () => {
      window.removeEventListener("blur", stop);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keyup", key);
    };
  }, []);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomTo(zoom * Math.exp(-e.deltaY * 0.005), {
          x: e.clientX,
          y: e.clientY,
        });
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoom, ready]);
  useEffect(() => {
    if (
      !ready ||
      !main.current ||
      !maskView.current ||
      !base.current ||
      !session.current
    )
      return;
    cancelAnimationFrame(drawFrame.current);
    drawFrame.current = requestAnimationFrame(() => {
      const engine = session.current!,
        original = base.current!,
        view = maskView.current;
      if (!main.current || !view) return;
      paintComposite(
        original,
        before ? [] : engine.frame.layers,
        main.current,
        cache.current,
      );
      const ctx = view.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      if (before) return;
      const mask = engine.frame.selection;
      if (mask && overlay !== "none") {
        if (overlay === "mask") {
          ctx.globalAlpha = overlayAlpha / 100;
          ctx.drawImage(maskCanvas(mask, w, h, "#20bcea"), 0, 0);
          ctx.globalAlpha = 1;
        } else {
          const edge = outlineMask(mask, w, h),
            im = ctx.createImageData(w, h);
          for (let i = 0; i < edge.length; i++)
            if (edge[i]) {
              const c = (Math.floor(i / w) + (i % w)) % 8 < 4 ? 255 : 15;
              im.data.set([c, c, c, 255], i * 4);
            }
          ctx.putImageData(im, 0, 0);
        }
      }
      const points =
        stroke.current?.tool === "lasso"
          ? stroke.current.points
          : polygon.current;
      if (points.length) {
        ctx.lineWidth = 2 / zoom;
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        points.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        if (hover.current && polygon.current.length)
          ctx.lineTo(hover.current.x, hover.current.y);
        ctx.stroke();
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        ctx.strokeStyle = "#172231";
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of polygon.current) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(p.x - 2 / zoom, p.y - 2 / zoom, 4 / zoom, 4 / zoom);
        }
      }
    });
    return () => cancelAnimationFrame(drawFrame.current);
  }, [tick, ready, before, overlay, overlayAlpha, zoom, w, h]);
  const completePolygon = () => {
    if (!s || new Set(polygon.current.map((p) => p.x + ":" + p.y)).size < 3)
      return;
    const mask = polygonMask(polygon.current, w, h);
    s.change({
      ...s.frame,
      selection: combine(s.frame.selection, mask, polygonMode.current),
    });
    polygon.current = [];
    hover.current = null;
    refresh();
  };
  const updateStroke = (p: Point) => {
    const st = stroke.current,
      engine = session.current;
    if (!st || !engine || st.pan) return;
    if (st.tool === "lasso") {
      st.points.push(p);
      st.last = p;
      refresh();
      return;
    }
    strokeCoverage(st.coverage, w, h, st.last, p, diameter, hardness / 100);
    st.last = p;
    if (st.tool === "select-brush" || st.tool === "select-erase") {
      engine.preview({
        ...st.original,
        selection: combine(st.original.selection, st.coverage, st.mode),
      });
    } else {
      const layer = st.original.layers.find((l) => l.id === st.original.active);
      if (layer)
        engine.preview({
          ...st.original,
          layers: st.original.layers.map((l) =>
            l.id === layer.id
              ? {
                  ...l,
                  mask: paintStroke(
                    layer.mask,
                    st.coverage,
                    brushOpacity / 100,
                    st.tool === "erase",
                    st.original.selection,
                  ),
                }
              : l,
          ),
        });
    }
    refresh();
  };
  const down = (e: PointerEvt<HTMLElement>) => {
    e.stopPropagation();
    if (!s || before || e.button !== 0) return;
    root.current?.focus();
    setError("");
    const p = point(e);
    if (tool === "pan" || spaceRef.current) {
      const el = stage.current!;
      stroke.current = {
        original: s.frame,
        coverage: new Uint8Array(0),
        last: p,
        mode,
        tool: "pan",
        points: [],
        pan: {
          x: e.clientX,
          y: e.clientY,
          left: el.scrollLeft,
          top: el.scrollTop,
        },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (refining) {
      setError("Сначала примените или отмените обработку края");
      return;
    }
    if (tool === "polygon") {
      if (!polygon.current.length) {
        finishOperation();
        polygonMode.current = effectiveMode(e);
      } else if (
        polygon.current.length >= 3 &&
        Math.hypot(p.x - polygon.current[0].x, p.y - polygon.current[0].y) *
          zoom <
          10
      ) {
        completePolygon();
        return;
      }
      polygon.current.push(p);
      hover.current = p;
      refresh();
      return;
    }
    finishOperation();
    if (tool === "wand") {
      s.begin();
      operation.current = {
        kind: "wand",
        original: s.frame,
        point: p,
        mode: effectiveMode(e),
      };
      runWand();
      return;
    }
    if (
      (tool === "brush" || tool === "erase") &&
      (!s.active || s.frame.editing)
    ) {
      setError(
        s.frame.editing
          ? "Завершите редактирование области"
          : "Создайте пустой слой для кисти",
      );
      return;
    }
    s.begin();
    stroke.current = {
      original: s.frame,
      coverage: new Uint8Array(w * h),
      last: p,
      points: [p],
      mode: effectiveMode(e),
      tool,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    updateStroke(p);
  };
  const move = (e: PointerEvt<HTMLElement>) => {
    if (!main.current) return;
    const p = point(e),
      st = stroke.current;
    if (cursor.current) {
      const r = main.current.getBoundingClientRect();
      cursor.current.style.width = cursor.current.style.height =
        (diameter * r.width) / w + "px";
      cursor.current.style.left = (p.x / w) * 100 + "%";
      cursor.current.style.top = (p.y / h) * 100 + "%";
      cursor.current.style.display =
        ["brush", "erase", "select-brush", "select-erase"].includes(tool) &&
        !before &&
        !space
          ? "block"
          : "none";
    }
    if (st?.pan) {
      stage.current!.scrollLeft = st.pan.left - (e.clientX - st.pan.x);
      stage.current!.scrollTop = st.pan.top - (e.clientY - st.pan.y);
      return;
    }
    if (st) updateStroke(p);
    else if (polygon.current.length) {
      hover.current = p;
      refresh();
    }
  };
  const up = (e: PointerEvt<HTMLElement>) => {
    const st = stroke.current;
    if (!st || !s) return;
    e.stopPropagation();
    if (!st.pan) {
      updateStroke(point(e));
      if (st.tool === "lasso") {
        if (new Set(st.points.map((p) => p.x + ":" + p.y)).size >= 3)
          s.preview({
            ...st.original,
            selection: combine(
              st.original.selection,
              polygonMask(st.points, w, h),
              st.mode,
            ),
          });
        else s.cancel();
      }
      s.commit();
    }
    stroke.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    refresh();
  };
  const chooseColor = (value: string, ref?: MaterialReference) => {
    const hex = normalizeHex(value);
    if (!hex) {
      setError(
        "Укажите корректный HEX: например, #E5A276. У выбранного материала может не быть цвета.",
      );
      return;
    }
    action(() => {
      setColor(hex);
      setMaterial(ref);
      if (s?.active) s.patch(s.active.id, { color: hex, material: ref });
    });
  };
  const close = () => {
    if (stroke.current || polygon.current.length) {
      cancelGesture();
      return;
    }
    if (operation.current?.kind === "refine") {
      cancelOperation();
      return;
    }
    finishOperation();
    const done = async () => {
      if (await save()) onClose();
    };
    if (
      session.current?.frame.editing ||
      hasSelection(session.current?.frame.selection ?? null)
    ) {
      confirm(
        "Закрыть редактор?",
        "Нанесённые слои сохранятся. Текущее выделение ещё не применено и будет сброшено.",
        async () => {
          await done();
        },
      );
    } else void done();
  };
  const keys = (e: KeyEvt) => {
    e.stopPropagation();
    const input = (e.target as HTMLElement).closest(
      'input,textarea,select,[contenteditable="true"]',
    );
    if (input && e.key !== "Escape") return;
    const key = /^Key[A-Z]$/.test(e.code)
      ? e.code.slice(3).toLowerCase()
      : e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      action(() => s?.undo(e.shiftKey));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "y") {
      e.preventDefault();
      action(() => s?.undo(true));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "d") {
      e.preventDefault();
      action(() =>
        s?.change({
          ...s.frame,
          selection: s.frame.editing ? new Uint8Array(w * h) : null,
        }),
      );
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = key;
      if (k === "w" || k === "b" || k === "e" || k === "l") {
        e.preventDefault();
        chooseTool(
          k === "w"
            ? "wand"
            : k === "b"
              ? "brush"
              : k === "e"
                ? "erase"
                : e.shiftKey
                  ? tool === "polygon"
                    ? "lasso"
                    : "polygon"
                  : "lasso",
        );
        return;
      }
      if (e.code === "BracketLeft" || e.code === "BracketRight") {
        e.preventDefault();
        setDiameter((v) =>
          Math.max(1, Math.min(200, v + (e.code === "BracketRight" ? 5 : -5))),
        );
        return;
      }
    }
    if (e.code === "Space") {
      e.preventDefault();
      spaceRef.current = true;
      setSpace(true);
      return;
    }
    if (e.key === "Enter" && polygon.current.length) {
      e.preventDefault();
      completePolygon();
      return;
    }
    if (e.key === "Backspace" && polygon.current.length) {
      e.preventDefault();
      polygon.current.pop();
      refresh();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const menu = root.current?.querySelector("details[open]");
      if (menu) {
        menu.removeAttribute("open");
        return;
      }
      if (polygon.current.length || stroke.current) {
        cancelGesture();
      } else if (operation.current) {
        cancelOperation();
      } else if (s?.frame.editing) {
        action(() => s.cancelArea());
      } else close();
    }
  };
  const tools: [Tool, string, React.ReactNode][] = [
    ["wand", "Волшебная палочка · W", <WandSparkles />],
    ["lasso", "Свободное лассо · L", <Lasso />],
    ["polygon", "Полигональное лассо · Shift L", <PenTool />],
    ["select-brush", "Добавить в выделение", <Plus />],
    ["select-erase", "Убрать из выделения", <Minus />],
    ["brush", "Кисть слоя · B", <Brush />],
    ["erase", "Ластик слоя · E", <Eraser />],
    ["pan", "Перемещение · Пробел", <Hand />],
  ];
  return (
    <Modal title="Виртуальная покраска" wide onClose={close}>
      <div
        className="pe-v2"
        ref={root}
        tabIndex={-1}
        onKeyDown={keys}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {!ready ? (
          <div className="pe-chooser">
            <h3>Выберите исходное изображение</h3>
            <p>
              Оригинал сохраняется. Рабочая копия — до 2048 px по длинной
              стороне.
            </p>
            <label className="button">
              Загрузить фото
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                disabled={loading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setLoading(true);
                  try {
                    const a = await prepareImage(file, projectId, "process", 0);
                    setSourceFile(a);
                    setSourceId(a.id);
                  } catch (err) {
                    fail(err);
                    setLoading(false);
                  }
                }}
              />
            </label>
            {loading && <p role="status">Открываем изображение…</p>}
            <Paged className="pe-photo-grid">
              {assets
                .filter((a) => a.projectId === projectId && !a.purpose)
                .map((a) => (
                  <button
                    key={a.id}
                    disabled={loading}
                    aria-label={a.caption || "Фото проекта"}
                    onClick={() => setSourceId(a.id)}
                  >
                    <Photo asset={a} />
                    <span>{a.caption || "Фото проекта"}</span>
                  </button>
                ))}
            </Paged>
          </div>
        ) : (
          <>
            <header className="pe-header">
              <input
                aria-label="Название варианта"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (s) {
                    s.revision++;
                    refresh();
                  }
                }}
              />
              <span className="pe-save-status" role="status">
                {status}
              </span>
              <div className="pe-buttons">
                <ToolButton
                  label="Отменить · Ctrl / ⌘ Z"
                  disabled={!s?.past.length && !s?.transaction}
                  onClick={() => action(() => s?.undo())}
                >
                  <Undo2 size={18} />
                </ToolButton>
                <ToolButton
                  label="Повторить · Ctrl / ⌘ Shift Z"
                  disabled={!s?.future.length}
                  onClick={() => action(() => s?.undo(true))}
                >
                  <Redo2 size={18} />
                </ToolButton>
                <button
                  onClick={async () => {
                    try {
                      finishOperation();
                      downloadPng(
                        await png(
                          paintComposite(base.current!, s!.frame.layers),
                        ),
                        title,
                      );
                    } catch (err) {
                      fail(err);
                    }
                  }}
                >
                  <Download size={16} /> PNG
                </button>
                <button className="primary" onClick={close}>
                  Готово
                </button>
              </div>
            </header>
            <div className="pe-context">
              <div className="pe-modes" aria-label="Операция выделения">
                {(Object.keys(MODES) as SelectionMode[]).map((m) => (
                  <button
                    key={m}
                    disabled={refining}
                    aria-pressed={mode === m}
                    onClick={() => action(() => setMode(m))}
                  >
                    {MODES[m]}
                  </button>
                ))}
              </div>
              {tool === "wand" ? (
                <>
                  <PaintRange
                    label="Допуск ΔE"
                    value={tolerance}
                    max={100}
                    onChange={(v) => {
                      setTolerance(v);
                      runWand({ tolerance: v, contiguous, diagonal });
                    }}
                  />
                  <label className="pe-check">
                    <input
                      type="checkbox"
                      checked={contiguous}
                      onChange={(e) => {
                        setContiguous(e.target.checked);
                        runWand({
                          tolerance,
                          contiguous: e.target.checked,
                          diagonal,
                        });
                      }}
                    />{" "}
                    Только смежная область
                  </label>
                  <label className="pe-check">
                    <input
                      type="checkbox"
                      checked={diagonal}
                      onChange={(e) => {
                        setDiagonal(e.target.checked);
                        runWand({
                          tolerance,
                          contiguous,
                          diagonal: e.target.checked,
                        });
                      }}
                    />{" "}
                    8 соседей
                  </label>
                </>
              ) : ["select-brush", "select-erase", "brush", "erase"].includes(
                  tool,
                ) ? (
                <>
                  <PaintRange
                    label="Кисть, px"
                    value={diameter}
                    min={1}
                    max={200}
                    onChange={setDiameter}
                  />
                  <PaintRange
                    label="Жёсткость, %"
                    value={hardness}
                    max={100}
                    onChange={setHardness}
                  />
                  {["brush", "erase"].includes(tool) && (
                    <PaintRange
                      label="Сила кисти, %"
                      value={brushOpacity}
                      max={100}
                      onChange={setBrushOpacity}
                    />
                  )}
                </>
              ) : (
                <p className="pe-hint">
                  {tool === "polygon"
                    ? "Клики — вершины · Enter — замкнуть · Backspace — убрать вершину · Esc — отменить"
                    : tool === "lasso"
                      ? "Обведите деталь, удерживая кнопку мыши. Контур замкнётся при отпускании."
                      : "Перетаскивайте изображение. Пробел временно включает перемещение."}
                </p>
              )}
            </div>
            <div className={"pe-body " + (!sidebar ? "pe-side-hidden" : "")}>
              <nav className="pe-toolbar" aria-label="Инструменты">
                {tools.map(([key, label, icon]) => (
                  <ToolButton
                    key={key}
                    label={label}
                    selected={tool === key}
                    onClick={() => chooseTool(key)}
                  >
                    {icon}
                  </ToolButton>
                ))}
              </nav>
              <div className="pe-center">
                <div className="pe-selection-bar">
                  <span>
                    {processing
                      ? "Вычисляем выделение…"
                      : f?.editing
                        ? "Редактирование области слоя"
                        : hasSelection(f?.selection ?? null)
                          ? "Выделение готово"
                          : "Выделите деталь на фото"}
                  </span>
                  {f?.editing ? (
                    <>
                      <button
                        className="primary"
                        disabled={processing}
                        onClick={() => action(() => s?.applyArea())}
                      >
                        Применить область
                      </button>
                      <button onClick={() => action(() => s?.cancelArea())}>
                        Отмена области
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={
                        processing ||
                        !hasSelection(f?.selection ?? null) ||
                        refining
                      }
                      onClick={() =>
                        action(() =>
                          s?.addLayer(
                            active?.color ?? color,
                            active?.material ?? material,
                          ),
                        )
                      }
                    >
                      Слой из выделения
                    </button>
                  )}
                  <details className="pe-selection-menu">
                    <summary>Выделение</summary>
                    <div
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("button"))
                          target.closest("details")?.removeAttribute("open");
                      }}
                    >
                      <button
                        disabled={processing}
                        onClick={() =>
                          action(() =>
                            s?.change({
                              ...s.frame,
                              selection: Uint8Array.from(
                                f?.selection ?? new Uint8Array(w * h),
                                (v) => 255 - v,
                              ),
                            }),
                          )
                        }
                      >
                        Инвертировать
                      </button>
                      <button
                        disabled={processing}
                        onClick={() =>
                          action(() =>
                            s?.change({
                              ...s.frame,
                              selection: f?.editing
                                ? new Uint8Array(w * h)
                                : null,
                            }),
                          )
                        }
                      >
                        Снять выделение
                      </button>
                      <button
                        disabled={
                          processing || !hasSelection(f?.selection ?? null)
                        }
                        onClick={() => {
                          finishOperation();
                          s!.begin();
                          operation.current = {
                            kind: "refine",
                            original: s!.frame,
                            mode,
                          };
                          setGrow(0);
                          setFeather(0);
                          setRefining(true);
                        }}
                      >
                        Обработать край…
                      </button>
                    </div>
                  </details>
                </div>
                {refining && (
                  <div className="pe-refine">
                    <PaintRange
                      label="Расширить / сузить, px"
                      value={grow}
                      min={-20}
                      max={20}
                      onChange={(v) => {
                        setGrow(v);
                        runRefine(v, feather);
                      }}
                    />
                    <PaintRange
                      label="Растушёвка, px"
                      value={feather}
                      max={20}
                      onChange={(v) => {
                        setFeather(v);
                        runRefine(grow, v);
                      }}
                    />
                    <button
                      disabled={processing}
                      onClick={() => {
                        finishOperation();
                        refresh();
                      }}
                    >
                      Применить край
                    </button>
                    <button onClick={cancelOperation}>Отмена края</button>
                  </div>
                )}
                <div className="pe-stage" ref={stage}>
                  <div
                    className="pe-plane"
                    style={{
                      minWidth: w * zoom + 48,
                      minHeight: h * zoom + 48,
                    }}
                  >
                    <div
                      className="pe-image"
                      style={{
                        width: w * zoom,
                        height: h * zoom,
                        cursor:
                          space || tool === "pan"
                            ? "grab"
                            : [
                                  "brush",
                                  "erase",
                                  "select-brush",
                                  "select-erase",
                                ].includes(tool)
                              ? "none"
                              : "crosshair",
                      }}
                    >
                      <canvas
                        ref={main}
                        width={w}
                        height={h}
                        aria-label="Изображение для выделения и перекраски"
                        onPointerDown={down}
                        onPointerMove={move}
                        onPointerUp={up}
                        onPointerCancel={() => {
                          cancelGesture();
                        }}
                        onPointerLeave={() => {
                          if (cursor.current)
                            cursor.current.style.display = "none";
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          if (tool === "polygon") completePolygon();
                        }}
                      />
                      <canvas
                        className="pe-overlay"
                        ref={maskView}
                        width={w}
                        height={h}
                      />
                      <div className="pe-cursor" ref={cursor} />
                    </div>
                  </div>
                </div>
                <footer className="pe-footer">
                  <div className="pe-buttons">
                    <ToolButton
                      label="Уменьшить масштаб"
                      onClick={() => zoomTo(zoom / 1.25)}
                    >
                      <Minus size={16} />
                    </ToolButton>
                    <button onClick={() => zoomTo(1)} aria-label="Масштаб 100%">
                      {Math.round(zoom * 100)}%
                    </button>
                    <ToolButton
                      label="Увеличить масштаб"
                      onClick={() => zoomTo(zoom * 1.25)}
                    >
                      <Plus size={16} />
                    </ToolButton>
                    <ToolButton label="Вписать изображение" onClick={fit}>
                      <ScanLine size={17} />
                    </ToolButton>
                    <button
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setBefore(true);
                      }}
                      onPointerCancel={() => setBefore(false)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          setBefore(true);
                        }
                      }}
                      onKeyUp={() => setBefore(false)}
                      onBlur={() => setBefore(false)}
                    >
                      Удерживать: оригинал
                    </button>
                  </div>
                  <label className="pe-inline">
                    Подсветка
                    <select
                      aria-label="Подсветка выделения"
                      value={overlay}
                      onChange={(e) =>
                        setOverlay(e.target.value as typeof overlay)
                      }
                    >
                      <option value="contour">Контур</option>
                      <option value="mask">Маска</option>
                      <option value="none">Без подсветки</option>
                    </select>
                  </label>
                  {overlay === "mask" && (
                    <input
                      aria-label="Прозрачность подсветки"
                      type="range"
                      min={5}
                      max={80}
                      value={overlayAlpha}
                      onChange={(e) => setOverlayAlpha(Number(e.target.value))}
                    />
                  )}
                  <span className="pe-hint">
                    {w} × {h} px
                  </span>
                  <ToolButton
                    label={sidebar ? "Скрыть панель" : "Показать панель"}
                    onClick={() => setSidebar(!sidebar)}
                  >
                    {sidebar ? (
                      <PanelRightClose size={18} />
                    ) : (
                      <PanelRightOpen size={18} />
                    )}
                  </ToolButton>
                </footer>
              </div>
              {sidebar && s && (
                <PaintPanels
                  session={s}
                  material={active?.material ?? material}
                  color={active?.color ?? color}
                  onColor={chooseColor}
                  onColorPreview={(value) => {
                    const hex = normalizeHex(value);
                    if (!hex) return;
                    if (operation.current) finishOperation();
                    setColor(hex);
                    setMaterial(undefined);
                    if (s.active)
                      s.patch(
                        s.active.id,
                        { color: hex, material: undefined },
                        true,
                      );
                    refresh();
                  }}
                  onCatalog={() => setPicker(true)}
                  action={action}
                  refresh={refresh}
                  busy={processing || refining}
                />
              )}
            </div>
          </>
        )}
        {error && (
          <div className="pe-error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Скрыть ошибку">
              ×
            </button>
          </div>
        )}
      </div>
      {picker && (
        <CatalogPicker
          onClose={() => setPicker(false)}
          onPick={(choice) => {
            const hex = choice.reference.snapshot.colorHex;
            if (!hex || !normalizeHex(hex)) {
              setPicker(false);
              setError(
                "У материала нет корректного HEX. Укажите цвет вручную.",
              );
              return;
            }
            chooseColor(hex, choice.reference);
            setPicker(false);
          }}
        />
      )}
    </Modal>
  );
}
