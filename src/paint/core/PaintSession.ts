import { uid } from "../../domain/model";
import type { MaterialReference, PaintBlend } from "../../domain/workspace";
import type { WorkingLayer } from "../canvas";
import { hasSelection } from "./selection";
export type PaintFrame = {
  layers: WorkingLayer[];
  active: string;
  selection: Uint8Array | null;
  editing: string | null;
};
export const blendLabels: Record<PaintBlend, { label: string; hint: string }> =
  {
    "source-over": {
      label: "Точный HEX",
      hint: "При 100% и полной маске выбранные пиксели получают указанный HEX. Полупрозрачный край маски смешивается с оригиналом.",
    },
    color: {
      label: "Светотень",
      hint: "Сохраняет светлоту и фактуру фото. Итоговый оттенок может отличаться от HEX.",
    },
    multiply: {
      label: "Умножение",
      hint: "Затемняет исходник выбранным цветом; подходит для теней.",
    },
    "soft-light": {
      label: "Мягкий свет",
      hint: "Мягко тонирует свет и тени. Это не точное совпадение с HEX.",
    },
  };
export class PaintSession {
  frame: PaintFrame;
  past: PaintFrame[] = [];
  future: PaintFrame[] = [];
  transaction: PaintFrame | null = null;
  revision = 0;
  constructor(
    public width: number,
    public height: number,
    layers: WorkingLayer[] = [],
  ) {
    this.frame = {
      layers,
      active: layers[0]?.id ?? "",
      selection: null,
      editing: null,
    };
  }
  get active() {
    return this.frame.layers.find((l) => l.id === this.frame.active);
  }
  begin() {
    this.transaction ??= this.frame;
  }
  preview(next: PaintFrame) {
    this.begin();
    this.frame = next;
  }
  commit() {
    const original = this.transaction;
    this.transaction = null;
    if (!original || original === this.frame) return;
    this.past.push(original);
    this.future = [];
    if (original.layers !== this.frame.layers) this.revision++;
    this.trim();
  }
  cancel() {
    if (this.transaction) this.frame = this.transaction;
    this.transaction = null;
  }
  change(next: PaintFrame) {
    this.commit();
    this.begin();
    this.frame = next;
    this.commit();
  }
  trim() {
    const bytes = () => {
      const masks = new Set<Uint8Array>();
      for (const f of [this.frame, ...this.past, ...this.future]) {
        if (f.selection) masks.add(f.selection);
        for (const l of f.layers) masks.add(l.mask);
      }
      return [...masks].reduce((n, m) => n + m.byteLength, 0);
    };
    while (
      this.past.length > 30 ||
      (this.past.length > 1 && bytes() > 64 * 1024 * 1024)
    )
      this.past.shift();
  }
  undo(redo = false) {
    this.commit();
    const from = redo ? this.future : this.past,
      to = redo ? this.past : this.future,
      next = from.pop();
    if (!next) return;
    if (next.layers !== this.frame.layers) this.revision++;
    to.push(this.frame);
    this.frame = next;
    this.trim();
  }
  patch(id: string, patch: Partial<WorkingLayer>, preview = false) {
    const next = {
      ...this.frame,
      layers: this.frame.layers.map((l) =>
        l.id === id ? { ...l, ...patch } : l,
      ),
    };
    if (preview) this.preview(next);
    else this.change(next);
  }
  addLayer(color: string, material?: MaterialReference, empty = false) {
    if (this.frame.layers.length >= 12)
      throw Error("В документе может быть до 12 слоёв");
    if (!empty && !hasSelection(this.frame.selection))
      throw Error("Сначала выделите область");
    if (this.frame.editing)
      throw Error("Примените или отмените редактирование области");
    const layer: WorkingLayer = {
      id: uid(),
      name: "Область " + (this.frame.layers.length + 1),
      mask: empty
        ? new Uint8Array(this.width * this.height)
        : this.frame.selection!.slice(),
      color,
      opacity: 1,
      visible: true,
      blend: "source-over",
      material,
    };
    this.change({
      ...this.frame,
      layers: [...this.frame.layers, layer],
      active: layer.id,
      selection: null,
    });
  }
  editArea() {
    if (!this.active) return;
    this.change({
      ...this.frame,
      selection: this.active.mask.slice(),
      editing: this.active.id,
    });
  }
  applyArea() {
    const id = this.frame.editing;
    if (!id || !this.frame.selection) return;
    this.change({
      ...this.frame,
      layers: this.frame.layers.map((l) =>
        l.id === id ? { ...l, mask: this.frame.selection!.slice() } : l,
      ),
      selection: null,
      editing: null,
    });
  }
  cancelArea() {
    this.change({ ...this.frame, selection: null, editing: null });
  }
  duplicate() {
    if (!this.active) return;
    if (this.frame.layers.length >= 12) throw Error("Не больше 12 слоёв");
    const copy = {
      ...this.active,
      id: uid(),
      name: this.active.name + " — копия",
      mask: this.active.mask.slice(),
    };
    this.change({
      ...this.frame,
      layers: [...this.frame.layers, copy],
      active: copy.id,
    });
  }
}
