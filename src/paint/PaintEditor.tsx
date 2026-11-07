import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as PointerEvt,
  type KeyboardEvent as KeyEvt,
} from "react";
import { createPortal } from "react-dom";
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
  Maximize2,
  Minimize2,
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
  updateMaskCanvasRegion,
  polygonMask,
  downloadPng,
  png,
  type PaintCacheEntry,
} from "./canvas";
import { normalizeHex } from "./core/color";
import { PaintSession, type PaintFrame } from "./core/PaintSession";
import {
  combine,
  combineStrokeRegion,
  hasSelection,
  imagePoint,
  likelyBackgroundSelection,
  outlineMask,
  paintStrokeRegion,
  strokeCoverage,
  type Point,
  type SelectionMode,
  type WandOptions,
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
  options?: WandOptions;
};
type Stroke = {
  original: PaintFrame;
  coverage: Uint8Array;
  last: Point;
  mode: SelectionMode;
  tool: Tool;
  points: Point[];
  selectionMask?: Uint8Array;
  paintMask?: Uint8Array;
  selectionConstraint?: Uint8Array | null;
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
  inlineHostId,
  onClose,
  onSave,
}: {
  projectId: string;
  initial?: PaintData;
  inlineHostId?: string;
  onClose: () => void;
  onSave: (data: PaintData, assets: Asset[]) => Promise<boolean>;
}) {
  const { assets, confirm } = useApp();
  const [sourceId, setSourceId] = useState(
      initial?.document.sourceAssetId ?? "",
    ),
    [sourceFile, setSourceFile] = useState<Asset | null>(null),
    [title, setTitle] = useState(initial?.title ?? "Вариант окраски");
  const [expanded, setExpanded] = useState(
    !inlineHostId || window.matchMedia("(max-width: 760px)").matches,
  );
  const [inlineHost, setInlineHost] = useState<HTMLElement | null>(null);
  const canInline =
    !!inlineHost && !window.matchMedia("(max-width: 760px)").matches;
  const originalInitial = useRef(initial),
    documentId = useRef(initial?.document.id ?? uid());
  const [tick, setTick] = useState(0),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [workerReady, setWorkerReady] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [tool, setTool] = useState<Tool>("wand"),
    [mode, setMode] = useState<SelectionMode>("replace");
  const [tolerance, setTolerance] = useState(12),
    [limitedTolerance, setLimitedTolerance] = useState<number | null>(null),
    [seedOnly, setSeedOnly] = useState(false),
    [edgeSoftness, setEdgeSoftness] = useState(2),
    [selectionRisk, setSelectionRisk] = useState<number | null>(null),
    [riskAccepted, setRiskAccepted] = useState(false);
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
    [sidebar, setSidebar] = useState(
      !window.matchMedia("(max-width: 760px)").matches,
    ),
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
    workerPending = useRef(false),
    restartWorker = useRef<() => void>(() => {}),
    operationTimer = useRef<number | null>(null),
    request = useRef(0),
    operation = useRef<Operation | null>(null),
    stroke = useRef<Stroke | null>(null);
  const polygon = useRef<Point[]>([]),
    hover = useRef<Point | null>(null),
    polygonMode = useRef<SelectionMode>("replace"),
    cache = useRef(new Map<string, PaintCacheEntry>()),
    overlayCache = useRef<{
      mask: Uint8Array;
      mode: "contour" | "mask";
      canvas: HTMLCanvasElement;
    } | null>(null),
    autoFit = useRef(true),
    spaceRef = useRef(false),
    strokeRefreshFrame = useRef(0),
    drawFrame = useRef(0);
  const zoomAnchor = useRef<{ screen: Point; image: Point } | null>(null);
  const allowRoute = useRef(false);
  useLayoutEffect(() => {
    if (!inlineHostId) return;
    const host = document.getElementById(inlineHostId);
    setInlineHost(host);
    if (!host) setExpanded(true);
  }, [inlineHostId]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const narrow = () => {
      if (media.matches) {
        setExpanded(true);
        setSidebar(false);
      }
    };
    media.addEventListener("change", narrow);
    return () => media.removeEventListener("change", narrow);
  }, []);
  useEffect(() => {
    const backup = (e: Event) => {
      e.preventDefault();
      setError("Сохраните и закройте редактор перед выгрузкой ZIP.");
    };
    window.addEventListener("workshop-before-backup", backup);
    return () => window.removeEventListener("workshop-before-backup", backup);
  }, []);
  useEffect(() => {
    const guard = (event: Event) => {
      if (allowRoute.current) return;
      const engine = session.current;
      if (
        (!engine && !sourceId) ||
        (engine &&
          !engine.revision &&
          !engine.transaction &&
          !engine.frame.editing &&
          !hasSelection(engine.frame.selection) &&
          (originalInitial.current || !sourceId))
      )
        return;
      event.preventDefault();
      if (saving) {
        setError("Дождитесь окончания сохранения перед переходом.");
        return;
      }
      const destination = location.hash;
      confirm(
        "Уйти из редактора?",
        "Несохранённые слои и временное выделение будут потеряны.",
        async () => {
          allowRoute.current = true;
          location.hash = destination;
        },
      );
    };
    window.addEventListener("workshop-before-route", guard);
    return () => window.removeEventListener("workshop-before-route", guard);
  }, [sourceId, saving, confirm]);
  const refresh = () => setTick((n) => n + 1);
  const refreshStroke = () => {
    if (strokeRefreshFrame.current) return;
    strokeRefreshFrame.current = requestAnimationFrame(() => {
      strokeRefreshFrame.current = 0;
      refresh();
    });
  };
  useEffect(() => () => cancelAnimationFrame(strokeRefreshFrame.current), []);
  const s = session.current,
    f = s?.frame,
    active = s?.active;
  const modeTool = tool === "wand" || tool === "lasso" || tool === "polygon";
  const limitShort =
    limitedTolerance === null
      ? ""
      : seedOnly
        ? " · цвет как у фона"
        : ` · ΔE ${limitedTolerance}/${tolerance}`;
  const limitExplanation =
    limitedTolerance === null
      ? undefined
      : seedOnly
        ? "Цвет точки совпадает с фоном: оставлен один пиксель. Попробуйте другую точку или уточните область лассо."
        : `Область дошла до края кадра. Чтобы не захватить фон, применён допуск ΔE ${limitedTolerance} вместо ${tolerance}.`;
  const selectionAvailable = hasSelection(f?.selection ?? null);
  const { status, save, reuseMask, reusePreview } = usePaintSave({
    autoSave: false,
    initialSaved: !!initial,
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
    if (operationTimer.current !== null) {
      window.clearTimeout(operationTimer.current);
      operationTimer.current = null;
    }
    request.current++;
    if (workerPending.current) restartWorker.current();
    workerPending.current = false;
    setProcessing(false);
  };
  const finishOperation = () => {
    invalidate();
    operation.current = null;
    setRefining(false);
    session.current?.commit();
  };
  const cancelOperation = () => {
    const wasWand = operation.current?.kind === "wand";
    invalidate();
    operation.current = null;
    session.current?.cancel();
    if (wasWand) {
      setSelectionRisk(null);
      setLimitedTolerance(null);
      setSeedOnly(false);
    }
    setRefining(false);
    refresh();
  };
  const cancelGesture = () => {
    cancelAnimationFrame(strokeRefreshFrame.current);
    strokeRefreshFrame.current = 0;
    if (stroke.current) {
      session.current?.cancel();
      stroke.current = null;
    }
    polygon.current = [];
    hover.current = null;
    setError("");
    refresh();
  };
  const action = (fn: () => void) => {
    if (saving) return;
    try {
      cancelGesture();
      finishOperation();
      setLimitedTolerance(null);
      setSeedOnly(false);
      const previousSelection = session.current?.frame.selection;
      fn();
      if (session.current?.frame.selection !== previousSelection) {
        setSelectionRisk(null);
      }
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
  const runWand = (options: Partial<WandOptions> = {}) => {
    const op = operation.current;
    if (!op || op.kind !== "wand") return;
    const configured: WandOptions = {
      tolerance: options.tolerance ?? tolerance,
      contiguous: true,
      diagonal: false,
      protectFrame: op.mode === "replace" || op.mode === "add",
      edgeSoftness: options.edgeSoftness ?? edgeSoftness,
      sampleRadius: 1,
    };
    op.options = configured;
    setLimitedTolerance(null);
    setSeedOnly(false);
    const id = ++request.current;
    workerPending.current = true;
    setProcessing(true);
    worker.current?.postMessage({
      type: "fill",
      id,
      point: op.point,
      options: configured,
    });
  };
  const recalcWand = (
    options: Partial<WandOptions> & { bounded?: boolean },
  ) => {
    if (operation.current?.kind !== "wand") return;
    if (operationTimer.current !== null)
      window.clearTimeout(operationTimer.current);
    request.current++;
    setProcessing(true);
    operationTimer.current = window.setTimeout(() => {
      operationTimer.current = null;
      runWand(options);
    }, 90);
  };
  const runRefine = (g: number, blur: number) => {
    const op = operation.current;
    if (!op || op.kind !== "refine" || !op.original.selection) return;
    const id = ++request.current;
    workerPending.current = true;
    setProcessing(true);
    worker.current?.postMessage({
      type: "refine",
      id,
      mask: op.original.selection,
      grow: g,
      feather: blur,
    });
  };
  const recalcRefine = (g: number, blur: number) => {
    if (operation.current?.kind !== "refine") return;
    if (operationTimer.current !== null)
      window.clearTimeout(operationTimer.current);
    request.current++;
    setProcessing(true);
    operationTimer.current = window.setTimeout(() => {
      operationTimer.current = null;
      runRefine(g, blur);
    }, 90);
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
              const mask = await loadMask(a.blob, width, height);
              reuseMask(mask, a);
              return { ...rest, mask };
            }),
          )
        : [];
      const previewAsset = init?.document.previewAssetId
        ? await db.assets.get(init.document.previewAssetId)
        : undefined;
      if (cancelled) return;
      base.current = original;
      session.current = new PaintSession(width, height, layers);
      if (previewAsset) reusePreview(layers, previewAsset);
      const startWorker = () => {
        setWorkerReady(false);
        const work = new Worker(
          new URL("./selection.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.current = work;
        work.onmessage = (e) => {
          if (cancelled || work !== worker.current) return;
          if (e.data.type === "ready") {
            setWorkerReady(true);
            return;
          }
          if (e.data.id !== request.current) return;
          workerPending.current = false;
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
          if (op.kind === "wand") {
            setLimitedTolerance(
              e.data.limited ? e.data.effectiveTolerance : null,
            );
            setSeedOnly(!!e.data.seedOnly);
            const risk =
              op.options?.contiguous && op.point
                ? likelyBackgroundSelection(selection, width, height, op.point)
                : null;
            setSelectionRisk(risk?.fraction ?? null);
            setRiskAccepted(false);
          }
          engine.preview({ ...op.original, selection });
          refresh();
        };
        work.onerror = (e) => {
          if (!cancelled && work === worker.current) {
            workerPending.current = false;
            setWorkerReady(false);
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
      };
      restartWorker.current = () => {
        worker.current?.terminate();
        startWorker();
      };
      startWorker();
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
      if (operationTimer.current !== null)
        window.clearTimeout(operationTimer.current);
      request.current++;
      worker.current?.terminate();
      worker.current = null;
      workerPending.current = false;
      restartWorker.current = () => {};
    };
  }, [sourceId, sourceFile, reuseMask, reusePreview]);
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
  }, [ready, expanded]);
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
        let cached = overlayCache.current;
        if (!cached || cached.mask !== mask || cached.mode !== overlay) {
          const overlayCanvas =
            overlay === "mask"
              ? maskCanvas(mask, w, h, "#20bcea")
              : canvas(w, h);
          if (overlay === "contour") {
            const edge = outlineMask(mask, w, h),
              overlayContext = overlayCanvas.getContext("2d")!,
              im = overlayContext.createImageData(w, h);
            for (let i = 0; i < edge.length; i++)
              if (edge[i]) {
                const bright = (Math.floor(i / w) + (i % w)) % 8 < 4;
                im.data.set(
                  bright ? [0, 210, 245, 255] : [10, 48, 75, 255],
                  i * 4,
                );
              }
            overlayContext.putImageData(im, 0, 0);
          }
          cached = { mask, mode: overlay, canvas: overlayCanvas };
          overlayCache.current = cached;
        }
        ctx.globalAlpha = overlay === "mask" ? overlayAlpha / 100 : 1;
        ctx.drawImage(cached.canvas, 0, 0);
        ctx.globalAlpha = 1;
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
  }, [tick, ready, before, overlay, overlayAlpha, zoom, w, h, expanded]);
  const completePolygon = () => {
    if (!s) return;
    if (new Set(polygon.current.map((p) => p.x + ":" + p.y)).size < 3) {
      setError("Для полигона нужны минимум три разные точки.");
      return;
    }
    const mask = polygonMask(polygon.current, w, h);
    s.change({
      ...s.frame,
      selection: combine(s.frame.selection, mask, polygonMode.current),
    });
    setSelectionRisk(null);
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
      refreshStroke();
      return;
    }
    const rect = strokeCoverage(
      st.coverage,
      w,
      h,
      st.last,
      p,
      diameter,
      hardness / 100,
    );
    st.last = p;
    if (st.tool === "select-brush" || st.tool === "select-erase") {
      st.selectionMask ??=
        st.mode === "add" || st.mode === "subtract"
          ? (st.original.selection?.slice() ?? new Uint8Array(w * h))
          : new Uint8Array(w * h);
      combineStrokeRegion(
        st.original.selection,
        st.coverage,
        st.selectionMask,
        st.mode,
        w,
        rect,
      );
      overlayCache.current = null;
      engine.preview({
        ...st.original,
        selection: st.selectionMask,
      });
    } else {
      const layer = st.original.layers.find((l) => l.id === st.original.active);
      if (layer) {
        st.paintMask ??= layer.mask.slice();
        paintStrokeRegion(
          layer.mask,
          st.paintMask,
          st.coverage,
          brushOpacity / 100,
          st.tool === "erase",
          st.selectionConstraint ?? null,
          w,
          rect,
        );
        const cached = cache.current.get(layer.id);
        if (cached?.mask === st.paintMask && cached.color === layer.color)
          updateMaskCanvasRegion(
            cached.canvas,
            st.paintMask,
            w,
            rect,
            layer.color,
          );
        engine.preview({
          ...st.original,
          layers: st.original.layers.map((l) =>
            l.id === layer.id ? { ...l, mask: st.paintMask! } : l,
          ),
        });
      }
    }
    refreshStroke();
  };
  const down = (e: PointerEvt<HTMLElement>) => {
    e.stopPropagation();
    if (!s || saving || before || e.button !== 0) return;
    e.preventDefault();
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
      const selectedMode = effectiveMode(e);
      if (selectedMode === "intersect" && !hasSelection(s.frame.selection)) {
        setError("Сначала обведите область лассо, затем выберите «Пересечь».");
        return;
      }
      s.begin();
      operation.current = {
        kind: "wand",
        original: s.frame,
        point: p,
        mode: selectedMode,
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
    if (tool === "select-erase" && !hasSelection(s.frame.selection)) {
      setError("Сначала создайте выделение, затем уберите лишнее кистью.");
      return;
    }
    s.begin();
    stroke.current = {
      original: s.frame,
      coverage: new Uint8Array(w * h),
      last: p,
      points: [p],
      mode:
        tool === "select-brush"
          ? "add"
          : tool === "select-erase"
            ? "subtract"
            : effectiveMode(e),
      tool,
      selectionConstraint:
        (tool === "brush" || tool === "erase") &&
        hasSelection(s.frame.selection)
          ? s.frame.selection
          : null,
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
      if (
        st.tool === "lasso" ||
        st.tool === "select-brush" ||
        st.tool === "select-erase"
      ) {
        setSelectionRisk(null);
      }
    }
    stroke.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    cancelAnimationFrame(strokeRefreshFrame.current);
    strokeRefreshFrame.current = 0;
    refresh();
  };
  const chooseColor = (value: string, ref?: MaterialReference) => {
    if (saving) return;
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
  const previewColor = (value: string) => {
    if (saving) return;
    const hex = normalizeHex(value);
    if (!hex) return;
    if (operation.current) finishOperation();
    setColor(hex);
    setMaterial(undefined);
    if (s?.active)
      s.patch(s.active.id, { color: hex, material: undefined }, true);
    refresh();
  };
  const commitColor = () => {
    s?.commit();
    refresh();
  };
  const saveAndClose = () => {
    if (!ready || loading || saving || processing || refining || stroke.current)
      return;
    if (polygon.current.length) {
      setError(
        "Завершите или отмените полигональное выделение перед сохранением.",
      );
      return;
    }
    finishOperation();
    const done = async () => {
      setSaving(true);
      try {
        if (await save()) onClose();
      } finally {
        setSaving(false);
      }
    };
    if (s?.frame.editing || hasSelection(s?.frame.selection ?? null))
      confirm(
        "Сохранить и закрыть?",
        "Слои сохранятся. Временное выделение и история отмены исчезнут после закрытия.",
        async () => {
          await done();
        },
      );
    else void done();
  };
  const cancel = () => {
    if (loading || processing || saving) return;
    if (
      (!initial && sourceId) ||
      s?.revision ||
      s?.transaction ||
      s?.frame.editing ||
      hasSelection(s?.frame.selection ?? null) ||
      polygon.current.length
    )
      confirm(
        "Отменить изменения?",
        "Несохранённые слои и временное выделение будут потеряны. Исходное фото останется без изменений.",
        async () => {
          onClose();
        },
      );
    else onClose();
  };
  const dismiss = () => {
    if (saving) return;
    if (expanded && canInline) setExpanded(false);
    else cancel();
  };
  const keys = (e: KeyEvt) => {
    e.stopPropagation();
    if (saving) {
      e.preventDefault();
      return;
    }
    const key = /^Key[A-Z]$/.test(e.code)
      ? e.code.slice(3).toLowerCase()
      : e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "d") {
      e.preventDefault();
      if (!s || !hasSelection(s.frame.selection)) return;
      action(() =>
        s.change({
          ...s.frame,
          selection: s.frame.editing ? new Uint8Array(w * h) : null,
        }),
      );
      return;
    }
    const target = e.target as HTMLElement;
    const input = target.closest(
      'input,textarea,select,[contenteditable="true"]',
    );
    if (input && e.key !== "Escape") return;
    if (
      target.closest('button,[role="button"]') &&
      (e.key === " " || e.key === "Enter")
    )
      return;
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
      } else dismiss();
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
  const imageStage = (
    <div className="pe-stage" ref={stage}>
      <div
        className="pe-plane"
        style={{ minWidth: w * zoom + 48, minHeight: h * zoom + 48 }}
      >
        <div
          className="pe-image"
          style={{
            width: w * zoom,
            height: h * zoom,
            cursor:
              space || tool === "pan"
                ? "grab"
                : ["brush", "erase", "select-brush", "select-erase"].includes(
                      tool,
                    )
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
            onPointerCancel={cancelGesture}
            onPointerLeave={() => {
              if (cursor.current) cursor.current.style.display = "none";
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (tool === "polygon") completePolygon();
            }}
          />
          <canvas className="pe-overlay" ref={maskView} width={w} height={h} />
          <div className="pe-cursor" ref={cursor} />
        </div>
      </div>
    </div>
  );
  const content = (
    <>
      <div
        className={
          "pe-v2 nodrag nopan nowheel" + (expanded ? "" : " pe-inline-editor")
        }
        ref={root}
        tabIndex={-1}
        aria-busy={saving}
        onKeyDown={keys}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {!ready ? (
          <div className="pe-chooser">
            {initial && loading ? (
              <p role="status">Открываем сохранённый вариант окраски…</p>
            ) : (
              <>
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
                        const a = await prepareImage(
                          file,
                          projectId,
                          "process",
                          0,
                        );
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
              </>
            )}
          </div>
        ) : !expanded ? (
          <section
            className="pe-inline-layout"
            aria-label="Редактор в карточке"
          >
            <header className="pe-inline-head">
              <strong>Перекраска в карточке</strong>
              <ToolButton
                label="Развернуть редактор"
                onClick={() => setExpanded(true)}
              >
                <Maximize2 size={17} />
              </ToolButton>
            </header>
            <div className="pe-inline-tools">
              {tools
                .filter(([key]) =>
                  ["wand", "select-brush", "select-erase", "pan"].includes(key),
                )
                .map(([key, label, icon]) => (
                  <ToolButton
                    key={key}
                    label={label}
                    selected={tool === key}
                    onClick={() => chooseTool(key)}
                  >
                    {icon}
                  </ToolButton>
                ))}
              <strong>{tools.find(([key]) => key === tool)?.[1]}</strong>
            </div>
            <div className="pe-inline-main">
              {imageStage}
              <aside
                className="pe-inline-side"
                aria-label="Параметры перекраски"
              >
                <div className="pe-inline-options">
                  {tool === "wand" ? (
                    <>
                      <label>
                        Операция
                        <select
                          aria-label="Операция выделения"
                          value={mode}
                          onChange={(e) =>
                            action(() =>
                              setMode(e.target.value as SelectionMode),
                            )
                          }
                        >
                          {Object.entries(MODES).map(([value, label]) => (
                            <option
                              key={value}
                              value={value}
                              disabled={
                                value === "intersect" && !selectionAvailable
                              }
                            >
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <PaintRange
                        label="Допуск ΔE"
                        value={tolerance}
                        max={100}
                        onChange={(value) => {
                          setTolerance(value);
                          recalcWand({ tolerance: value });
                        }}
                      />
                      <PaintRange
                        label="Мягкий край ΔE"
                        value={edgeSoftness}
                        max={10}
                        onChange={(value) => {
                          setEdgeSoftness(value);
                          recalcWand({ edgeSoftness: value });
                        }}
                      />
                    </>
                  ) : tool === "select-brush" || tool === "select-erase" ? (
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
                    </>
                  ) : (
                    <span className="pe-hint">
                      Тяните фото для перемещения.
                    </span>
                  )}
                </div>
                <div className="pe-inline-selection">
                  <span role="status" title={limitExplanation}>
                    {processing
                      ? "Вычисляем маску…"
                      : !workerReady && tool === "wand"
                        ? "Подготавливаем палочку…"
                        : hasSelection(f?.selection ?? null)
                          ? "Выделение временное"
                          : active
                            ? "Слой готов"
                            : "Выделите область"}
                    {limitShort}
                  </span>
                  <button
                    disabled={
                      processing ||
                      refining ||
                      (selectionRisk !== null && !riskAccepted) ||
                      !hasSelection(f?.selection ?? null)
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
                  {processing && (
                    <button onClick={cancelOperation}>Отменить расчёт</button>
                  )}
                </div>
                <div className="pe-inline-properties">
                  <label>
                    Цвет слоя
                    <input
                      type="color"
                      value={active?.color ?? color}
                      disabled={processing || refining}
                      onChange={(e) => previewColor(e.target.value)}
                      onBlur={commitColor}
                      onPointerUp={commitColor}
                    />
                  </label>
                  {active && (
                    <PaintRange
                      label="Непрозрачность слоя, %"
                      value={Math.round(active.opacity * 100)}
                      max={100}
                      onChange={(value) => {
                        s?.patch(active.id, { opacity: value / 100 }, true);
                        refresh();
                      }}
                      onCommit={() => {
                        s?.commit();
                        refresh();
                      }}
                    />
                  )}
                  <label>
                    Подсветка
                    <select
                      value={overlay}
                      aria-label="Подсветка выделения"
                      onChange={(e) =>
                        setOverlay(e.target.value as typeof overlay)
                      }
                    >
                      <option value="contour">Контур</option>
                      <option value="mask">Маска</option>
                      <option value="none">Без подсветки</option>
                    </select>
                  </label>
                </div>
              </aside>
            </div>
            <footer className="pe-inline-actions">
              <ToolButton
                label="Отменить · Ctrl Z"
                disabled={!s?.past.length && !s?.transaction}
                onClick={() => action(() => s?.undo())}
              >
                <Undo2 size={17} />
              </ToolButton>
              <ToolButton
                label="Повторить · Ctrl Shift Z"
                disabled={!s?.future.length}
                onClick={() => action(() => s?.undo(true))}
              >
                <Redo2 size={17} />
              </ToolButton>
              <ToolButton label="Вписать изображение" onClick={fit}>
                <ScanLine size={17} />
              </ToolButton>
              <button
                className="primary"
                disabled={loading || processing || refining}
                onClick={saveAndClose}
              >
                Сохранить
              </button>
              <button onClick={cancel}>Отмена</button>
            </footer>
            <small className="pe-inline-state">
              {status}
              {hasSelection(f?.selection ?? null) && " · выделение временное"} ·
              исходник не меняется
            </small>
          </section>
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
                {hasSelection(f?.selection ?? null) && " · Выделение временное"}
              </span>
              <div className="pe-buttons">
                <button
                  className="primary"
                  disabled={loading || processing || refining}
                  onClick={saveAndClose}
                >
                  Сохранить
                </button>
                <button onClick={cancel}>Отмена</button>
                {canInline && (
                  <button onClick={() => setExpanded(false)}>
                    <Minimize2 size={16} /> Свернуть в карточку
                  </button>
                )}
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
              </div>
            </header>
            <div className="pe-context">
              <strong className="pe-active-tool">
                {tools.find(([key]) => key === tool)?.[1]}
              </strong>
              {modeTool && (
                <div
                  className="pe-modes"
                  role="group"
                  aria-label="Операция выделения"
                >
                  {(Object.keys(MODES) as SelectionMode[]).map((m) => (
                    <button
                      key={m}
                      disabled={
                        refining || (m === "intersect" && !selectionAvailable)
                      }
                      title={
                        m === "intersect" && !selectionAvailable
                          ? "Сначала создайте выделение"
                          : undefined
                      }
                      aria-pressed={mode === m}
                      onClick={() => action(() => setMode(m))}
                    >
                      {MODES[m]}
                    </button>
                  ))}
                </div>
              )}
              {tool === "wand" ? (
                <>
                  <PaintRange
                    label="Допуск ΔE"
                    value={tolerance}
                    max={100}
                    onChange={(v) => {
                      setTolerance(v);
                      recalcWand({ tolerance: v });
                    }}
                  />
                  <PaintRange
                    label="Мягкий край ΔE"
                    value={edgeSoftness}
                    max={10}
                    onChange={(value) => {
                      setEdgeSoftness(value);
                      recalcWand({ edgeSoftness: value });
                    }}
                  />
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
                    ? "Клик — вершина · Enter или двойной клик — замкнуть · Backspace — убрать точку · Esc — отменить"
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
                  <span
                    role="status"
                    title={
                      polygon.current.length
                        ? "Enter или двойной клик — завершить полигон; Backspace — убрать точку; Escape — отменить"
                        : limitExplanation
                    }
                  >
                    {polygon.current.length
                      ? `Вершин: ${polygon.current.length} · Enter/двойной клик — завершить`
                      : processing
                        ? "Вычисляем выделение…"
                        : !workerReady && tool === "wand"
                          ? "Подготавливаем палочку…"
                          : f?.editing
                            ? "Редактирование области слоя"
                            : hasSelection(f?.selection ?? null)
                              ? "Выделение готово"
                              : (tool === "brush" || tool === "erase") && active
                                ? "Нет выделения — кисть рисует по всему слою"
                                : "Выделите деталь на фото"}
                    {limitShort}
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
                        (selectionRisk !== null && !riskAccepted) ||
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
                  {processing && (
                    <button onClick={cancelOperation}>Отменить расчёт</button>
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
                        disabled={processing || !selectionAvailable}
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
                        recalcRefine(v, feather);
                      }}
                    />
                    <PaintRange
                      label="Растушёвка, px"
                      value={feather}
                      max={20}
                      onChange={(v) => {
                        setFeather(v);
                        recalcRefine(grow, v);
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
                {imageStage}
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
                  onColorPreview={previewColor}
                  onCatalog={() => setPicker(true)}
                  action={action}
                  refresh={refresh}
                  busy={processing || refining}
                />
              )}
            </div>
          </>
        )}
        {selectionRisk !== null && !riskAccepted && (
          <div className="pe-selection-warning" role="alert">
            <span>
              Палочка захватила {Math.round(selectionRisk * 100)}% кадра и его
              края. Вероятно, выделен фон. Уменьшите допуск или уточните
              выделение лассо и кистью.
            </span>
            <button onClick={() => setRiskAccepted(true)}>
              Использовать эту маску
            </button>
          </div>
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
    </>
  );
  if (expanded || !inlineHostId) {
    return (
      <Modal title="Виртуальная покраска" wide onClose={dismiss}>
        {content}
      </Modal>
    );
  }
  return inlineHost ? createPortal(content, inlineHost) : null;
}
