import { validateShopping } from "../shopping/engine";
import { validateWorkspace } from "./workspaceValidation";
import {
  assetGroups,
  categories,
  stages,
  sources,
  units,
  closed,
  type State,
  type Asset,
} from "./model";
import { stock } from "./engine";
const fail = (s: string): never => {
  throw new Error("Проверка данных: " + s);
};
function obj(v: any) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("ожидался объект");
}
function str(v: any, name: string, required = false) {
  if (typeof v !== "string" || v.length > 100000 || (required && !v.trim()))
    fail(name);
}
function num(v: any, name: string, min = 0) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > 1e12)
    fail(name);
}
function bool(v: any) {
  if (typeof v !== "boolean") fail("ожидался флаг");
}
function arr(v: any) {
  if (!Array.isArray(v) || v.length > 100000) fail("ожидался список");
}
function en(v: any, dict: object) {
  if (typeof v !== "string" || !Object.hasOwn(dict, v))
    fail("неизвестное значение " + v);
}
function unique(list: any[]) {
  const ids = new Set();
  for (const x of list) {
    obj(x);
    str(x.id, "идентификатор", true);
    if (!/^[a-z0-9-]{1,100}$/i.test(x.id) || ids.has(x.id))
      fail("повторяющийся или неверный ID");
    ids.add(x.id);
  }
}
function printer(p: any) {
  obj(p);
  str(p.id, "принтер", true);
  str(p.name, "название принтера", true);
  for (const k of ["brand", "model", "purchaseDate"]) str(p[k], k);
  en(p.technology, { FDM: 1, SLA: 1 });
  for (const k of ["purchaseCost", "powerW", "tariff", "maintenanceHour"])
    num(p[k], k);
  num(p.lifeHours, "ресурс", 0.001);
  bool(p.active);
}
function project(p: any, s: State) {
  obj(p);
  str(p.id, "проект", true);
  str(p.title, "название проекта", true);
  for (const k of ["description", "size", "notes", "updatedAt", "printerId"])
    str(p[k], k);
  bool(p.archived);
  en(p.technology, { FDM: 1, SLA: 1 });
  arr(p.tags);
  p.tags.forEach((x: any) => str(x, "тег"));
  for (const k of ["hours", "laborHours", "laborRate", "extra"]) num(p[k], k);
  arr(p.items);
  unique(p.items);
  for (const i of p.items) {
    if (!s.materials.some((m) => m.id === i.materialId))
      fail("материал рецепта не найден");
    num(i.qty, "расход");
    en(i.scope, { unit: 1, batch: 1 });
    en(i.source, sources);
  }
  arr(p.mixes);
  unique(p.mixes);
  for (const m of p.mixes) {
    str(m.name, "название смеси", true);
    num(m.volume, "объём");
    num(m.lossPercent, "потери");
    arr(m.components);
    if (m.components.length < 2) fail("минимум два компонента смеси");
    let total = 0;
    for (const c of m.components) {
      if (!s.materials.some((x) => x.id === c.materialId && x.unit === "ml"))
        fail("компонент смеси должен быть в мл");
      num(c.share, "доля");
      total += c.share;
    }
    if (!total) fail("нулевые доли смеси");
  }
  arr(p.profiles);
  for (const f of p.profiles) {
    if (!s.printers.some((x) => x.id === f.printerId))
      fail("принтер профиля не найден");
    num(f.hours, "время профиля");
    num(f.factor, "коэффициент профиля");
  }
  if (p.printerId && !s.printers.some((x) => x.id === p.printerId))
    fail("принтер проекта не найден");
}
function cost(c: any) {
  obj(c);
  for (const k of [
    "materials",
    "electricity",
    "depreciation",
    "maintenance",
    "labor",
    "extra",
    "total",
  ]) {
    num(c[k], "себестоимость");
    if (!Number.isSafeInteger(c[k]))
      fail("стоимость должна быть в целых копейках");
  }
  if (
    c.total !==
    c.materials +
      c.electricity +
      c.depreciation +
      c.maintenance +
      c.labor +
      c.extra
  )
    fail("итог стоимости");
}
export function validate(s: any): asserts s is State {
  obj(s);
  if (s.schemaVersion !== 3) fail("неподдерживаемая версия формата");
  num(s.revision, "версия");
  for (const k of ["materials", "printers", "projects", "runs", "movements"]) {
    arr(s[k]);
    unique(s[k]);
  }
  for (const m of s.materials) {
    str(m.name, "название материала", true);
    for (const k of ["brand", "series", "code", "color", "notes"]) str(m[k], k);
    if (m.colorEnabled !== undefined) bool(m.colorEnabled);
    en(m.category, categories);
    en(m.unit, units);
    bool(m.archived);
    num(m.packageQty, "объём упаковки", 0.001);
    num(m.packageCost, "цена");
    num(m.minimum, "минимум");
    if (m.category === "filament" && m.unit !== "g")
      fail("филамент учитывается в граммах");
    if (
      ["paint", "primer", "varnish"].includes(m.category) &&
      !["ml", "g", "pcs"].includes(m.unit)
    )
      fail("краски, грунты и лаки: мл, г или шт");
    if (m.category === "resin" && !["g", "ml"].includes(m.unit))
      fail("смола: г или мл");
  }
  s.printers.forEach(printer);
  s.projects.forEach((p: any) => project(p, s));
  for (const r of s.runs) {
    if (!s.projects.some((p: any) => p.id === r.projectId))
      fail("проект запуска не найден");
    str(r.title, "название запуска", true);
    en(r.stage, stages);
    num(r.count, "количество", 1);
    if (!Number.isInteger(r.count)) fail("целое количество");
    str(r.createdAt, "дата");
    printer(r.printer);
    project(r.recipe, s);
    num(r.hours, "время");
    num(r.factor, "коэффициент");
    num(r.laborHours, "труд");
    cost(r.cost);
    arr(r.lines);
    const ids = new Set();
    for (const l of r.lines) {
      if (
        !s.materials.some(
          (m: any) => m.id === l.materialId && m.unit === l.unit,
        ) ||
        ids.has(l.materialId)
      )
        fail("материал запуска");
      ids.add(l.materialId);
      str(l.name, "название");
      num(l.qty, "расход");
      num(l.unitCost, "цена единицы");
    }
    if (closed(r)) {
      obj(r.actual);
      cost(r.actualCost);
      for (const l of r.lines)
        num(r.actual[l.materialId], "фактический расход");
      for (const k of Object.keys(r.actual))
        if (!ids.has(k)) fail("лишний фактический материал");
      en(r.source, sources);
      num(r.actualHours, "факт время");
      num(r.actualLaborHours, "факт труд");
      num(r.actualExtra, "факт прочее");
    }
  }
  for (const m of s.movements) {
    if (!s.materials.some((x: any) => x.id === m.materialId))
      fail("материал движения");
    en(m.kind, {
      receipt: 1,
      reserve: 1,
      release: 1,
      consume: 1,
      waste: 1,
      adjustment: 1,
    });
    en(m.source, sources);
    num(m.qty, "движение", m.kind === "adjustment" ? -1e12 : 0);
    str(m.at, "дата");
    str(m.note, "примечание");
    if (m.runId && !s.runs.some((r: any) => r.id === m.runId))
      fail("ссылка на запуск");
    if (["reserve", "release", "consume", "waste"].includes(m.kind) && !m.runId)
      fail("движение без запуска");
  }
  for (const m of s.materials) {
    const v = stock(s, m.id);
    if (v.physical < -0.001 || v.reserved < -0.001)
      fail("отрицательный физический остаток/резерв");
  }
  for (const r of s.runs) {
    const all = s.movements.filter((m: any) => m.runId === r.id);
    for (const m of all)
      if (!r.lines.some((l: any) => l.materialId === m.materialId))
        fail("постороннее движение запуска");
    for (const l of r.lines) {
      const movements = all.filter((m: any) => m.materialId === l.materialId);
      const reserve = movements.reduce(
        (a: number, m: any) =>
          a +
          (m.kind === "reserve" ? m.qty : m.kind === "release" ? -m.qty : 0),
        0,
      );
      const consumed = movements.reduce(
        (a: number, m: any) =>
          a + (["consume", "waste"].includes(m.kind) ? m.qty : 0),
        0,
      );
      if (
        Math.abs(reserve - (closed(r) ? 0 : l.qty)) > 0.002 ||
        Math.abs(consumed - (closed(r) ? r.actual[l.materialId] : 0)) > 0.002
      )
        fail("журнал не соответствует запуску");
    }
  }
  obj(s.settings);
  const t = s.settings;
  en(t.theme, { light: 1, dark: 1 });
  for (const k of ["inventoryEnabled", "backupEnabled"]) bool(t[k]);
  for (const k of [
    "inventoryDays",
    "inventoryRuns",
    "backupDays",
    "backupChanges",
  ])
    num(t[k], k, 1);
  for (const k of ["inventoryCompleted", "changes", "backupRevision"])
    num(t[k], k);
  for (const k of ["inventoryAt", "backupAt", "snoozeUntil"]) str(t[k], k);
  validateWorkspace(s);
  validateShopping(s);
}
export function validateAssets(s: State, assets: Asset[]) {
  arr(assets);
  unique(assets);
  for (const a of assets) {
    if (!s.projects.some((p) => p.id === a.projectId)) fail("фото без проекта");
    en(a.group, assetGroups);
    str(a.caption, "подпись");
    num(a.order, "порядок");
    bool(a.cover);
    if (
      a.purpose &&
      !["note", "paint-mask", "paint-preview"].includes(a.purpose)
    )
      fail("назначение изображения");
    for (const b of [a.blob, a.thumb])
      if (
        !(b instanceof Blob) ||
        !["image/jpeg", "image/png", "image/webp"].includes(b.type) ||
        b.size > 15 * 1024 * 1024
      )
        fail("неподдерживаемое изображение");
  }
}
