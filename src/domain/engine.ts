import {
  closed,
  now,
  uid,
  type State,
  type Project,
  type Printer,
  type Line,
  type Cost,
  type Run,
  type Movement,
  type Source,
  type Stage,
} from "./model";
export const q = (v: number) => Math.round(v * 1000) / 1000;
export function nonnegative(v: number, label = "Значение") {
  if (!Number.isFinite(v) || v < 0 || v > 1e9)
    throw new Error(`${label}: введите число от 0 до 1 000 000 000`);
  return v;
}
export function stock(s: State, id: string) {
  let physical = 0,
    reserved = 0;
  for (const m of s.movements)
    if (m.materialId === id) {
      if (m.kind === "reserve") reserved += m.qty;
      else if (m.kind === "release") reserved -= m.qty;
      else
        physical +=
          (m.kind === "consume" || m.kind === "waste" ? -1 : 1) * m.qty;
    }
  return {
    physical: q(physical),
    reserved: q(reserved),
    available: q(physical - reserved),
  };
}
export function movement(
  s: State,
  materialId: string,
  kind: Movement["kind"],
  qty: number,
  source: Source,
  note = "",
  runId?: string,
) {
  if (kind === "adjustment") {
    if (!Number.isFinite(qty)) throw new Error("Некорректная корректировка");
  } else nonnegative(qty, "Количество");
  if (!s.materials.some((m) => m.id === materialId))
    throw new Error("Материал не найден");
  if (q(qty) !== 0)
    s.movements.push({
      id: uid(),
      materialId,
      kind,
      qty: q(qty),
      source,
      note,
      runId,
      at: now(),
    });
}
export function expand(
  s: State,
  p: Project,
  count: number,
  printer: Printer,
  factor = 1,
): Line[] {
  if (!Number.isInteger(count) || count < 1 || count > 10000)
    throw new Error("Количество экземпляров: целое число от 1 до 10 000");
  nonnegative(factor, "Коэффициент материала");
  if (!printer.active || printer.technology !== p.technology)
    throw new Error("Выберите активный совместимый принтер");
  const map = new Map<string, Line>();
  function add(id: string, amount: number) {
    nonnegative(amount, "Расход");
    const m = s.materials.find((x) => x.id === id);
    if (!m || m.archived) throw new Error("Материал отсутствует или в архиве");
    if (
      (m.category === "filament" && p.technology !== "FDM") ||
      (m.category === "resin" && p.technology !== "SLA")
    )
      throw new Error(`Материал ${m.name} несовместим с технологией`);
    const qty =
      amount *
      (m.category === "filament" || m.category === "resin" ? factor : 1);
    const previous = map.get(id);
    map.set(id, {
      materialId: id,
      name: [m.brand, m.series, m.code, m.name].filter(Boolean).join(" "),
      unit: m.unit,
      unitCost: m.packageCost / m.packageQty,
      qty: q((previous?.qty || 0) + qty),
    });
  }
  for (const item of p.items)
    add(item.materialId, item.qty * (item.scope === "unit" ? count : 1));
  for (const mix of p.mixes) {
    nonnegative(mix.volume, "Объём смеси");
    nonnegative(mix.lossPercent, "Потери");
    if (mix.components.length < 2)
      throw new Error("Смесь должна содержать не менее двух компонентов");
    const total = mix.components.reduce(
      (n, c) => n + nonnegative(c.share, "Доля"),
      0,
    );
    if (total <= 0) throw new Error("Укажите доли смеси");
    for (const c of mix.components) {
      if (s.materials.find((m) => m.id === c.materialId)?.unit !== "ml")
        throw new Error("В смеси используются только материалы в мл");
      add(
        c.materialId,
        (mix.volume * count * (1 + mix.lossPercent / 100) * c.share) / total,
      );
    }
  }
  return [...map.values()].filter((l) => l.qty > 0);
}
export function calculate(
  lines: Line[],
  printer: Printer,
  hours: number,
  laborHours: number,
  laborRate: number,
  extra: number,
): Cost {
  [hours, laborHours, laborRate, extra].forEach((x) => nonnegative(x));
  if (printer.lifeHours <= 0)
    throw new Error("Ресурс принтера должен быть больше нуля");
  const materials = lines.reduce(
      (n, l) => n + Math.round(l.qty * l.unitCost),
      0,
    ),
    electricity = Math.round(
      ((hours * printer.powerW) / 1000) * printer.tariff,
    ),
    depreciation = Math.round(
      (hours * printer.purchaseCost) / printer.lifeHours,
    ),
    maintenance = Math.round(hours * printer.maintenanceHour),
    labor = Math.round(laborHours * laborRate);
  return {
    materials,
    electricity,
    depreciation,
    maintenance,
    labor,
    extra: Math.round(extra),
    total:
      materials +
      electricity +
      depreciation +
      maintenance +
      labor +
      Math.round(extra),
  };
}
export function plan(
  s: State,
  p: Project,
  count = 1,
  printerId = p.printerId,
  override?: { hours?: number; factor?: number },
) {
  const printer = s.printers.find((x) => x.id === printerId);
  if (!printer) throw new Error("Добавьте и выберите принтер");
  const profile = p.profiles.find((x) => x.printerId === printerId);
  const hours = override?.hours ?? (profile?.hours ?? p.hours) * count,
    factor = override?.factor ?? profile?.factor ?? 1;
  const lines = expand(s, p, count, printer, factor),
    cost = calculate(
      lines,
      printer,
      hours,
      p.laborHours * count,
      p.laborRate,
      p.extra * count,
    );
  return {
    printer,
    lines,
    hours,
    factor,
    cost,
    shortages: lines.filter(
      (l) => stock(s, l.materialId).available + 0.0001 < l.qty,
    ),
  };
}
export function start(
  s: State,
  projectId: string,
  count: number,
  printerId: string,
  override?: { hours?: number; factor?: number },
  relatedRunId?: string,
) {
  const p = s.projects.find((x) => x.id === projectId);
  if (!p || p.archived) throw new Error("Проект не найден или в архиве");
  const a = plan(s, p, count, printerId, override);
  if (!a.lines.length) throw new Error("Добавьте материалы в рецепт");
  if (a.shortages.length)
    throw new Error(
      "Недостаточно материалов: " + a.shortages.map((l) => l.name).join(", "),
    );
  const r: Run = {
    id: uid(),
    projectId,
    title: p.title,
    count,
    stage: "planned",
    createdAt: now(),
    recipe: structuredClone(p),
    printer: structuredClone(a.printer),
    lines: a.lines,
    hours: a.hours,
    factor: a.factor,
    laborHours: p.laborHours * count,
    cost: a.cost,
    relatedRunId,
  };
  s.runs.push(r);
  for (const l of r.lines)
    movement(
      s,
      l.materialId,
      "reserve",
      l.qty,
      "calculated",
      "Резерв запуска",
      r.id,
    );
  return r;
}
function active(s: State, id: string) {
  const r = s.runs.find((x) => x.id === id);
  if (!r) throw new Error("Запуск не найден");
  if (closed(r)) throw new Error("Этот запуск уже закрыт");
  return r;
}
export function setStage(s: State, id: string, stage: Stage) {
  if (["completed", "failed", "cancelled"].includes(stage))
    throw new Error("Используйте завершение с подтверждением расхода");
  active(s, id).stage = stage;
}
export function finish(
  s: State,
  id: string,
  stage: "completed" | "failed" | "cancelled",
  values: Record<string, number>,
  source: Source,
  reason = "",
  hours?: number,
  laborHours?: number,
  extra?: number,
) {
  const r = active(s, id);
  for (const key of Object.keys(values))
    if (!r.lines.some((l) => l.materialId === key))
      throw new Error("Расход содержит неизвестный материал");
  const actual: Record<string, number> = {};
  for (const l of r.lines) {
    const amount = q(
      nonnegative(values[l.materialId] ?? 0, "Фактический расход"),
    );
    const available = stock(s, l.materialId).available + l.qty;
    if (amount > Math.max(0, available) + 0.0001)
      throw new Error(
        `Недостаточно свободного запаса: ${l.name}. Уточните склад.`,
      );
    actual[l.materialId] = amount;
  }
  const h = hours ?? (stage === "completed" ? r.hours : 0),
    lh = laborHours ?? (stage === "completed" ? r.laborHours : 0),
    ex = extra ?? (stage === "completed" ? r.cost.extra : 0);
  const cost = calculate(
    r.lines.map((l) => ({ ...l, qty: actual[l.materialId] })),
    r.printer,
    h,
    lh,
    r.recipe.laborRate,
    ex,
  );
  for (const l of r.lines) {
    movement(
      s,
      l.materialId,
      "release",
      l.qty,
      "calculated",
      "Освобождение резерва",
      r.id,
    );
    movement(
      s,
      l.materialId,
      stage === "failed" ? "waste" : "consume",
      actual[l.materialId],
      source,
      reason || "Подтверждение расхода",
      r.id,
    );
  }
  Object.assign(r, {
    stage,
    closedAt: now(),
    actual,
    actualHours: h,
    actualLaborHours: lh,
    actualExtra: ex,
    actualCost: cost,
    source,
    reason,
  });
}
export function revise(
  s: State,
  id: string,
  count: number,
  hours: number,
  factor: number,
) {
  const r = active(s, id);
  if (r.stage !== "planned")
    throw new Error("Менять план можно до начала печати");
  const lines = expand(s, r.recipe, count, r.printer, factor).map((l) => ({
    ...l,
    unitCost:
      r.lines.find((old) => old.materialId === l.materialId)?.unitCost ??
      l.unitCost,
  }));
  for (const l of lines) {
    const own = r.lines.find((x) => x.materialId === l.materialId)?.qty || 0;
    if (l.qty > stock(s, l.materialId).available + own + 0.0001)
      throw new Error("Недостаточно материалов для изменения плана");
  }
  const cost = calculate(
    lines,
    r.printer,
    hours,
    r.recipe.laborHours * count,
    r.recipe.laborRate,
    r.recipe.extra * count,
  );
  for (const l of r.lines)
    movement(
      s,
      l.materialId,
      "release",
      l.qty,
      "calculated",
      "Изменение плана",
      id,
    );
  for (const l of lines)
    movement(
      s,
      l.materialId,
      "reserve",
      l.qty,
      "calculated",
      "Изменение плана",
      id,
    );
  Object.assign(r, {
    count,
    hours,
    factor,
    lines,
    cost,
    laborHours: r.recipe.laborHours * count,
  });
}
export function reconcile(
  s: State,
  id: string,
  physical: number,
  method: string,
  note: string,
) {
  nonnegative(physical, "Остаток");
  const m = s.materials.find((x) => x.id === id);
  if (!m) throw new Error("Материал не найден");
  movement(
    s,
    id,
    "adjustment",
    q(physical - stock(s, id).physical),
    "inventory",
    `${method}: ${note}`,
  );
  m.checkedAt = now();
  m.checkMethod = method;
}
export function inventoryDue(s: State, date = Date.now()) {
  const c = s.settings;
  if (!c.inventoryEnabled || Date.parse(c.snoozeUntil) > date) return false;
  return (
    date - Date.parse(c.inventoryAt) >= c.inventoryDays * 86400000 ||
    s.runs.filter((r) => r.stage === "completed").length -
      c.inventoryCompleted >=
      c.inventoryRuns
  );
}
export function backupDue(s: State, date = Date.now()) {
  const c = s.settings;
  return (
    c.backupEnabled &&
    (date - Date.parse(c.backupAt) >= c.backupDays * 86400000 ||
      c.changes - c.backupRevision >= c.backupChanges)
  );
}

/** Percentage is available stock relative to one package, not all historic receipts. */
export function stockHealth(s: State, material: State["materials"][number]) {
  const balance = stock(s, material.id);
  const percent = Math.max(0, (balance.available / material.packageQty) * 100);
  const level =
    balance.available <= material.minimum
      ? "critical"
      : balance.available <=
          Math.max(
            material.packageQty * 0.5,
            material.minimum + Math.max(material.packageQty * 0.1, 0.001),
          )
        ? "warning"
        : "healthy";
  return {
    ...balance,
    percent,
    level,
    belowMinimum: balance.available <= material.minimum,
  };
}

export type LaunchMode = "batch" | "separate";
export function planLaunch(
  s: State,
  p: Project,
  count: number,
  printerId: string,
  mode: LaunchMode,
  override?: { hours?: number; factor?: number },
) {
  // Validate count even when planning single-item runs.
  if (!Number.isInteger(count) || count < 1 || count > 10000)
    throw new Error("Количество экземпляров: целое число от 1 до 10 000");
  if (mode === "batch") return plan(s, p, count, printerId, override);
  const one = plan(s, p, 1, printerId, {
    ...override,
    hours: override?.hours === undefined ? undefined : override.hours / count,
  });
  const lines = one.lines.map((l) => ({ ...l, qty: q(l.qty * count) }));
  const cost = Object.fromEntries(
    Object.entries(one.cost).map(([k, v]) => [k, v * count]),
  ) as unknown as Cost;
  return {
    ...one,
    lines,
    hours: one.hours * count,
    cost,
    shortages: lines.filter(
      (l) => stock(s, l.materialId).available + 0.0001 < l.qty,
    ),
  };
}
/** Commit only after every individual run has passed validation. */
export function startLaunch(
  s: State,
  projectId: string,
  count: number,
  printerId: string,
  mode: LaunchMode,
  override?: { hours?: number; factor?: number },
) {
  const draft = structuredClone(s);
  const p = draft.projects.find((p) => p.id === projectId);
  if (!p || p.archived) throw new Error("Проект не найден или в архиве");
  const total = planLaunch(draft, p, count, printerId, mode, override);
  if (total.shortages.length)
    throw new Error("Недостаточно материалов для всех запусков");
  const runs: Run[] = [];
  for (let i = 0; i < (mode === "batch" ? 1 : count); i++) {
    const run = start(
      draft,
      projectId,
      mode === "batch" ? count : 1,
      printerId,
      {
        ...override,
        hours: mode === "batch" ? override?.hours : total.hours / count,
      },
    );
    if (mode === "separate" && count > 1) run.title += ` · ${i + 1}/${count}`;
    runs.push(run);
  }
  s.runs = draft.runs;
  s.movements = draft.movements;
  return runs;
}
