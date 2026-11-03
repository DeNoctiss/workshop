import { now, type State } from "./model";
import { reconcile, stock } from "./engine";
export interface StockCount {
  materialId: string;
  physical: number;
  expectedPhysical: number;
  method: string;
}
/** Validate the entire count first; never rebase a physical count on newer stock. */
export function applyStocktake(s: State, counts: StockCount[], note = "") {
  if (
    !counts.length ||
    new Set(counts.map((c) => c.materialId)).size !== counts.length
  )
    throw new Error("Выберите материалы для сверки");
  for (const c of counts) {
    const m = s.materials.find((m) => m.id === c.materialId && !m.archived);
    if (!m)
      throw new Error("Материал удалён или архивирован. Обновите сверку.");
    if (!Number.isFinite(c.physical) || c.physical < 0)
      throw new Error("Фактический остаток должен быть неотрицательным числом");
    if (stock(s, c.materialId).physical !== c.expectedPhysical)
      throw new Error(
        `Остаток «${m.name}» изменился во время сверки. Удалите строку из черновика и пересчитайте её.`,
      );
  }
  counts.forEach((c) => reconcile(s, c.materialId, c.physical, c.method, note));
  const full = s.materials
    .filter((m) => !m.archived)
    .every((m) => counts.some((c) => c.materialId === m.id));
  if (full) {
    s.settings.inventoryAt = now();
    s.settings.inventoryCompleted = s.runs.filter(
      (r) => r.stage === "completed",
    ).length;
    s.settings.snoozeUntil = "";
  }
  return { checked: counts.length, full };
}
