import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset } from "../domain/model";
import { now } from "../domain/model";
import type { BoardData } from "../domain/workspace";
import { derivedAsset, maskCanvas, paintComposite } from "./canvas";
import type { PaintSession } from "./core/PaintSession";
export type PaintData = Extract<BoardData, { kind: "paint" }>;
type Input = {
  session: PaintSession | null;
  base: HTMLCanvasElement | null;
  projectId: string;
  sourceId: string;
  sourceFile: Asset | null;
  documentId: string;
  title: string;
  tick: number;
  onSave: (data: PaintData, assets: Asset[]) => Promise<boolean>;
};
/** One writer, immutable snapshots. A late result can never overwrite a newer save. */
export function usePaintSave(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  const [status, setStatus] = useState("Сохранено"),
    saved = useRef(0),
    running = useRef<Promise<boolean> | null>(null),
    alive = useRef(true),
    masks = useRef(new WeakMap<Uint8Array, Asset>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const save = useCallback(() => {
    if (running.current) return running.current;
    const task = (async () => {
      try {
        while (true) {
          const p = latest.current,
            s = p.session;
          if (!s || !p.base || s.revision === saved.current) return true;
          if (s.transaction) return false;
          const revision = s.revision,
            layers = s.frame.layers,
            assets: Asset[] = [];
          if (alive.current) setStatus("Сохраняем…");
          if (p.sourceFile) assets.push(p.sourceFile);
          const stored = [];
          for (const layer of layers) {
            let asset = masks.current.get(layer.mask);
            if (!asset) {
              asset = await derivedAsset(
                p.projectId,
                maskCanvas(layer.mask, s.width, s.height),
                "paint-mask",
                layer.name,
              );
              masks.current.set(layer.mask, asset);
            }
            assets.push(asset);
            const { mask: _mask, ...meta } = layer;
            stored.push({ ...meta, maskAssetId: asset.id });
          }
          const preview = await derivedAsset(
            p.projectId,
            paintComposite(p.base, layers),
            "paint-preview",
            p.title,
          );
          assets.push(preview);
          const ok = await p.onSave(
            {
              kind: "paint",
              title: p.title,
              document: {
                id: p.documentId,
                schemaVersion: 2,
                sourceAssetId: p.sourceId,
                previewAssetId: preview.id,
                width: s.width,
                height: s.height,
                layers: stored,
                updatedAt: now(),
              },
            },
            assets,
          );
          if (!ok) throw Error("Не удалось сохранить. Повторите попытку.");
          saved.current = revision;
          if (alive.current) setStatus("Сохранено");
          if (!alive.current || s.transaction) return true;
        }
      } catch (error) {
        if (alive.current)
          setStatus(
            "Ошибка сохранения: " +
              (error instanceof Error ? error.message : String(error)),
          );
        return false;
      }
    })();
    running.current = task;
    void task.finally(() => {
      running.current = null;
    });
    return task;
  }, []);
  useEffect(() => {
    const s = input.session;
    if (!s || s.revision === saved.current) return;
    if (!running.current) setStatus("Есть изменения");
    if (s.transaction) return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [input.tick, input.session, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const s = latest.current.session;
      if (
        s &&
        (s.revision !== saved.current || s.transaction || s.frame.selection)
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return { save, status };
}
