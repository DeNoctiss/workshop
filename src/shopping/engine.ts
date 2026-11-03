import {
  closed,
  now,
  uid,
  units,
  categories,
  type State,
} from "../domain/model";
import { stock, expand, movement, q, nonnegative } from "../domain/engine";
import {
  defaultPurchaseConfig,
  type PurchaseConfig,
  type PurchaseItem,
  type ShoppingState,
} from "./model";
export function purchaseNeed(
  physical: number,
  reserved: number,
  demand: number,
  target: number,
  pack?: number,
) {
  const available = q(physical - reserved),
    shortage = q(Math.max(0, demand + target - available));
  return {
    available,
    shortage,
    quantity:
      pack && pack > 0 ? q(Math.ceil(shortage / pack - 1e-9) * pack) : shortage,
  };
}
export function validateConfig(config: PurchaseConfig) {
  if (
    !config ||
    typeof config.lowStock !== "boolean" ||
    typeof config.keepTarget !== "boolean" ||
    !Array.isArray(config.runIds) ||
    !Array.isArray(config.projects) ||
    !config.targets ||
    typeof config.targets !== "object"
  )
    throw Error("Некорректные источники закупок");
  if (
    config.runIds.some((id) => typeof id !== "string") ||
    config.runIds.length > 10000 ||
    config.projects.length > 1000
  )
    throw Error("Некорректные источники закупок");
  for (const p of config.projects)
    if (
      !p ||
      typeof p.id !== "string" ||
      typeof p.projectId !== "string" ||
      !Number.isInteger(p.count) ||
      p.count < 1 ||
      p.count > 10000 ||
      typeof p.separate !== "boolean" ||
      typeof p.additional !== "boolean"
    )
      throw Error("Количество изделий: целое число от 1 до 10 000");
  for (const value of Object.values(config.targets))
    nonnegative(value, "Целевой запас");
}
export function generatePurchases(
  s: State,
  config: PurchaseConfig,
  previous: PurchaseItem[] = [],
): ShoppingState {
  validateConfig(config);
  const warnings: string[] = [],
    demands = new Map<string, { amount: number; reasons: string[] }>();
  const add = (id: string, amount: number, reason: string) => {
    const d = demands.get(id) ?? { amount: 0, reasons: [] };
    d.amount = q(d.amount + amount);
    d.reasons.push(reason);
    demands.set(id, d);
  };
  for (const id of new Set(config.runIds)) {
    const run = s.runs.find((r) => r.id === id);
    if (!run || closed(run)) {
      warnings.push("Завершённое или удалённое производство пропущено.");
      continue;
    }
    for (const line of run.lines) {
      const allocated = s.movements
        .filter((m) => m.runId === id && m.materialId === line.materialId)
        .reduce(
          (sum, m) =>
            sum +
            (m.kind === "reserve" ? m.qty : m.kind === "release" ? -m.qty : 0),
          0,
        );
      add(
        line.materialId,
        Math.max(0, line.qty - allocated),
        "Производство «" +
          run.title +
          "»: учтён только незарезервированный расход",
      );
    }
  }
  const selected = new Set<string>();
  for (const planned of config.projects) {
    if (selected.has(planned.projectId)) {
      warnings.push(
        "Повторно выбранный проект пропущен: измените количество в первой строке.",
      );
      continue;
    }
    selected.add(planned.projectId);
    const p = s.projects.find((p) => p.id === planned.projectId);
    if (!p || p.archived) {
      warnings.push("Недоступный проект пропущен.");
      continue;
    }
    if (
      !planned.additional &&
      s.runs.some((r) => r.projectId === p.id && !closed(r))
    ) {
      warnings.push(
        "«" +
          p.title +
          "»: уже есть активная партия. Для новой партии включите «Дополнительная».",
      );
      continue;
    }
    const printer = s.printers.find((x) => x.id === p.printerId);
    if (!printer) {
      warnings.push(
        "«" + p.title + "»: не указан принтер, расход не рассчитан.",
      );
      continue;
    }
    try {
      const lines = expand(
        s,
        p,
        planned.separate ? 1 : planned.count,
        printer,
        p.profiles.find((x) => x.printerId === printer.id)?.factor ?? 1,
      );
      if (!lines.length)
        warnings.push(
          "«" + p.title + "»: нет положительных норм расхода, добавьте рецепт.",
        );
      for (const line of lines)
        add(
          line.materialId,
          line.qty * (planned.separate ? planned.count : 1),
          "Новая партия «" +
            p.title +
            "», " +
            planned.count +
            " шт., " +
            (planned.separate ? "отдельные запуски" : "один запуск"),
        );
    } catch (e) {
      warnings.push(
        "«" + p.title + "»: " + (e instanceof Error ? e.message : String(e)),
      );
    }
  }
  const items: PurchaseItem[] = [];
  for (const m of s.materials.filter((x) => !x.archived)) {
    const balance = stock(s, m.id),
      d = demands.get(m.id),
      low = config.lowStock && balance.available <= m.minimum,
      key = "material:" + m.id;
    const prev = previous.find(
      (p) => p.key === key && !p.manual && !p.receiptMovementId,
    );
    const target =
      low || (config.keepTarget && !!d)
        ? (config.targets[m.id] ?? Math.max(m.packageQty, m.minimum))
        : 0;
    if (!low && !d && balance.available >= 0 && !prev) continue;
    const need = purchaseNeed(
      balance.physical,
      balance.reserved,
      d?.amount ?? 0,
      target,
      prev?.packageOverride ?? m.packageQty,
    );
    const quantity =
      need.shortage === 0
        ? (prev?.override ?? prev?.purchasedQty ?? 0)
        : prev?.override !== undefined
          ? prev.override >= need.shortage
            ? prev.override
            : need.quantity
          : need.quantity;
    const reasons = [...(d?.reasons ?? [])];
    if (low) reasons.push("Доступный остаток на пороге пополнения или ниже");
    if (balance.available < 0)
      reasons.push("Склад не покрывает действующие резервы");
    if (prev?.purchasedQty && prev.purchasedQty < quantity)
      reasons.push(
        "Потребность выросла: отметка покупки больше не закрывает нужный объём",
      );
    if (!low && !need.shortage && !prev) continue;
    items.push({
      id: prev?.id ?? uid(),
      key,
      materialId: m.id,
      name: [m.brand, m.series, m.code, m.name].filter(Boolean).join(" "),
      unit: m.unit,
      category: m.category,
      color: m.colorEnabled !== false ? m.color : undefined,
      manual: false,
      physical: balance.physical,
      reserved: balance.reserved,
      demand: d?.amount ?? 0,
      target,
      shortage: need.shortage,
      quantity: q(quantity),
      packageQty:
        prev?.packageOverride ?? (m.packageQty > 0 ? m.packageQty : undefined),
      packageOverride: prev?.packageOverride,
      price:
        m.packageCost > 0 && m.packageQty > 0
          ? m.packageCost / m.packageQty
          : undefined,
      override: prev?.override,
      reasons,
      note: prev?.note ?? "",
      purchasedQty: prev?.purchasedQty ?? 0,
    });
  }
  for (const item of previous)
    if (item.manual || item.receiptMovementId) items.push(item);
    else if (
      !s.materials.some((m) => m.id === item.materialId && !m.archived)
    ) {
      items.push(item);
      warnings.push("«" + item.name + "»: материал недоступен или в архиве.");
    }
  return { config: structuredClone(config), items, updatedAt: now(), warnings };
}
export const ensureShopping = (s: State): ShoppingState =>
  s.shopping ??
  (s.shopping = {
    config: defaultPurchaseConfig(),
    items: [],
    updatedAt: now(),
    warnings: [],
  });
export function receivePurchase(
  s: State,
  id: string,
  amount: number,
  cost?: number,
) {
  nonnegative(amount, "Количество");
  if (q(amount) <= 0) throw Error("Количество должно быть больше нуля");
  if (cost !== undefined) {
    nonnegative(cost, "Стоимость");
    if (!Number.isInteger(cost))
      throw Error("Стоимость должна быть в копейках");
  }
  const row = s.shopping?.items.find((x) => x.id === id);
  if (!row) throw Error("Позиция не найдена");
  if (row.receiptMovementId) throw Error("Эта покупка уже оприходована");
  const m = s.materials.find((m) => m.id === row.materialId && !m.archived);
  if (!m) throw Error("Сначала добавьте материал на склад");
  movement(s, m.id, "receipt", amount, "measured", "Закупки: " + row.name);
  row.receiptMovementId = s.movements.at(-1)!.id;
  row.receivedQty = q(amount);
  row.receiptCost = cost;
  row.purchasedQty = q(amount);
  if (cost !== undefined)
    m.packageCost = Math.round((cost / amount) * m.packageQty);
}
export function validateShopping(s: State) {
  const shopping = s.shopping;
  if (shopping === undefined) return;
  validateConfig(shopping.config);
  if (
    !Array.isArray(shopping.items) ||
    shopping.items.length > 10000 ||
    typeof shopping.updatedAt !== "string" ||
    !Array.isArray(shopping.warnings) ||
    shopping.warnings.some((v) => typeof v !== "string")
  )
    throw Error("Некорректный список закупок");
  const ids = new Set<string>();
  for (const row of shopping.items) {
    if (
      !row ||
      typeof row.id !== "string" ||
      ids.has(row.id) ||
      typeof row.key !== "string" ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      !(row.unit in units) ||
      !(row.category in categories) ||
      typeof row.manual !== "boolean" ||
      typeof row.note !== "string" ||
      !Array.isArray(row.reasons) ||
      row.reasons.some((v) => typeof v !== "string")
    )
      throw Error("Некорректная позиция закупки");
    ids.add(row.id);
    for (const v of [
      row.reserved,
      row.demand,
      row.target,
      row.shortage,
      row.quantity,
      row.purchasedQty,
    ])
      nonnegative(v, "Закупки");
    if (!Number.isFinite(row.physical)) throw Error("Некорректный остаток");
    for (const key of [
      "packageQty",
      "packageOverride",
      "price",
      "override",
      "receivedQty",
      "receiptCost",
    ] as const)
      if (row[key] !== undefined) nonnegative(row[key]!, "Закупки");
    if (row.materialId && !s.materials.some((m) => m.id === row.materialId))
      throw Error("Материал закупки не найден");
    if (
      row.receiptMovementId &&
      !s.movements.some(
        (m) =>
          m.id === row.receiptMovementId &&
          m.materialId === row.materialId &&
          m.kind === "receipt" &&
          m.qty === row.receivedQty,
      )
    )
      throw Error("Не найден связанный приход закупки");
  }
}
