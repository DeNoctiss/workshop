import { describe, it, expect } from "vitest";
import {
  emptyState,
  newProject,
  uid,
  type State,
  type Printer,
  type Material,
} from "../src/domain/model";
import {
  stock,
  movement,
  start,
  finish,
  plan,
  reconcile,
  revise,
  inventoryDue,
  backupDue,
} from "../src/domain/engine";
import { validate } from "../src/domain/validation";
import { fixture } from "./fixture";
describe("склад и производство", () => {
  it("резерв не списывает физический запас", () => {
    const { s, m, p, printer } = fixture();
    start(s, p.id, 1, printer.id);
    expect(stock(s, m.id)).toEqual({
      physical: 300,
      reserved: 200,
      available: 100,
    });
    validate(s);
  });
  it("нельзя резервировать чужой запас", () => {
    const { s, p, printer } = fixture();
    start(s, p.id, 1, printer.id);
    expect(() => start(s, p.id, 1, printer.id)).toThrow("Недостаточно");
    expect(s.runs).toHaveLength(1);
  });
  it("завершение списывает один раз", () => {
    const { s, p, m, printer } = fixture();
    const r = start(s, p.id, 1, printer.id);
    finish(s, r.id, "completed", { [m.id]: 200 }, "plan");
    expect(stock(s, m.id)).toEqual({
      physical: 100,
      reserved: 0,
      available: 100,
    });
    expect(() => finish(s, r.id, "completed", { [m.id]: 200 }, "plan")).toThrow(
      "уже закрыт",
    );
    validate(s);
  });
  it("отмена без расхода возвращает резерв", () => {
    const { s, p, m, printer } = fixture();
    const r = start(s, p.id, 1, printer.id);
    finish(s, r.id, "cancelled", {}, "estimated");
    expect(stock(s, m.id)).toEqual({
      physical: 300,
      reserved: 0,
      available: 300,
    });
    validate(s);
  });
  it("брак списывает 35 из плановых 80", () => {
    const { s, p, m, printer } = fixture();
    p.items[0].qty = 80;
    const r = start(s, p.id, 1, printer.id);
    finish(s, r.id, "failed", { [m.id]: 35 }, "measured", "Отрыв детали");
    expect(stock(s, m.id).physical).toBe(265);
    expect(s.movements.filter((x) => x.kind === "waste")[0].qty).toBe(35);
    validate(s);
  });
  it("частичная отмена списывает только подтвержденное", () => {
    const { s, p, m, printer } = fixture();
    const r = start(s, p.id, 1, printer.id);
    finish(s, r.id, "cancelled", { [m.id]: 50 }, "estimated");
    expect(stock(s, m.id).physical).toBe(250);
  });
  it("фактический расход не забирает чужой резерв", () => {
    const { s, p, m, printer } = fixture();
    p.items[0].qty = 100;
    const a = start(s, p.id, 1, printer.id);
    start(s, p.id, 1, printer.id);
    expect(() =>
      finish(s, a.id, "completed", { [m.id]: 250 }, "measured"),
    ).toThrow();
    expect(stock(s, m.id).physical).toBe(300);
  });
  it("пересчитывает резерв до печати", () => {
    const { s, p, m, printer } = fixture();
    p.items[0].qty = 80;
    const r = start(s, p.id, 1, printer.id);
    revise(s, r.id, 2, 3, 1);
    expect(stock(s, m.id).reserved).toBe(160);
    validate(s);
  });
  it("ошибка изменения плана не меняет журнал", () => {
    const { s, p, printer } = fixture();
    const r = start(s, p.id, 1, printer.id);
    const before = JSON.stringify(s);
    expect(() => revise(s, r.id, 10, 3, 1)).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });
  it("снимок защищен от изменения цен и рецепта", () => {
    const { s, p, m, printer } = fixture();
    const r = start(s, p.id, 1, printer.id);
    m.packageCost *= 2;
    p.items[0].qty = 1;
    printer.purchaseCost *= 2;
    finish(s, r.id, "completed", { [m.id]: 200 }, "plan");
    expect(r.actualCost?.materials).toBe(40000);
    expect(r.recipe.items[0].qty).toBe(200);
    expect(r.actualCost?.depreciation).toBe(2000);
  });
  it("сверка добавляет отдельное движение, не переписывает историю", () => {
    const { s, m } = fixture();
    reconcile(s, m.id, 307, "измерено", "");
    expect(stock(s, m.id).physical).toBe(307);
    expect(s.movements.at(-1)?.qty).toBe(7);
    const count = s.movements.length;
    reconcile(s, m.id, 307, "измерено", "");
    expect(s.movements).toHaveLength(count);
  });
  it("сверка ниже резерва фиксирует дефицит и блокирует списание", () => {
    const { s, m, p, printer } = fixture();
    const r = start(s, p.id, 1, printer.id);
    reconcile(s, m.id, 100, "измерено", "");
    validate(s);
    expect(stock(s, m.id).available).toBe(-100);
    expect(() =>
      finish(s, r.id, "completed", { [m.id]: 200 }, "plan"),
    ).toThrow();
  });
  it.each([NaN, Infinity, -1, 0, 1.5])(
    "не допускает некорректное количество %s",
    (count) => {
      const { s, p, printer } = fixture();
      expect(() => start(s, p.id, count, printer.id)).toThrow();
    },
  );
  it("отмена с нулевым расходом возможна при общем дефиците", () => {
    const { s, p, m, printer } = fixture();
    p.items[0].qty = 100;
    const a = start(s, p.id, 1, printer.id);
    start(s, p.id, 1, printer.id);
    reconcile(s, m.id, 30, "измерено", "");
    finish(s, a.id, "cancelled", {}, "estimated");
    expect(stock(s, m.id).reserved).toBe(100);
    validate(s);
  });
  it("отрицательный расход отклоняется до записи", () => {
    const { s, p, m, printer } = fixture();
    const r = start(s, p.id, 1, printer.id);
    expect(() =>
      finish(s, r.id, "failed", { [m.id]: -3 }, "estimated"),
    ).toThrow();
    expect(stock(s, m.id).reserved).toBe(200);
  });
  it("технологии должны совпадать", () => {
    const { s, p, printer } = fixture();
    printer.technology = "SLA";
    expect(() => plan(s, p)).toThrow("совместимый");
  });
});
describe("рецепт, стоимость и напоминания", () => {
  it("смесь 75/25 с потерями расходует только компоненты", () => {
    const { s, p, m } = fixture();
    m.category = "paint";
    m.unit = "ml";
    m.packageQty = 17;
    const second = { ...m, id: uid(), name: "White" };
    s.materials.push(second);
    movement(s, second.id, "receipt", 30, "measured");
    p.items = [];
    p.mixes = [
      {
        id: uid(),
        name: "Кожа",
        volume: 2,
        lossPercent: 10,
        components: [
          { materialId: m.id, share: 75 },
          { materialId: second.id, share: 25 },
        ],
      },
    ];
    const a = plan(s, p, 2);
    expect(a.lines.map((l) => l.qty)).toEqual([3.3, 1.1]);
  });
  it("расход на партию не умножается", () => {
    const { s, p } = fixture();
    p.items[0].scope = "batch";
    expect(plan(s, p, 3).lines[0].qty).toBe(200);
  });
  it("агрегирует повторяющиеся материалы", () => {
    const { s, p } = fixture();
    p.items.push({ ...p.items[0], id: uid(), qty: 10 });
    expect(plan(s, p).lines).toHaveLength(1);
    expect(plan(s, p).lines[0].qty).toBe(210);
  });
  it("калькуляция печати, тарифа, амортизации и обслуживания", () => {
    const { s, p } = fixture();
    p.laborHours = 2;
    p.laborRate = 50000;
    p.extra = 10000;
    expect(plan(s, p).cost).toEqual({
      materials: 40000,
      electricity: 100,
      depreciation: 2000,
      maintenance: 400,
      labor: 100000,
      extra: 10000,
      total: 152500,
    });
  });
  it("профиль другого принтера меняет время и печатный материал", () => {
    const { s, p, printer } = fixture();
    p.profiles = [{ printerId: printer.id, hours: 3, factor: 0.8 }];
    const a = plan(s, p, 2);
    expect(a.hours).toBe(6);
    expect(a.lines[0].qty).toBe(320);
  });
  it("напоминание по дням и откладывание", () => {
    const { s } = fixture();
    s.settings.inventoryAt = new Date(Date.now() - 15 * 86400000).toISOString();
    expect(inventoryDue(s)).toBe(true);
    s.settings.snoozeUntil = new Date(Date.now() + 86400000).toISOString();
    expect(inventoryDue(s)).toBe(false);
  });
  it("напоминание после завершенных запусков", () => {
    const { s, p, m, printer } = fixture();
    p.items[0].qty = 1;
    s.settings.inventoryRuns = 1;
    const r = start(s, p.id, 1, printer.id);
    finish(s, r.id, "completed", { [m.id]: 1 }, "plan");
    expect(inventoryDue(s)).toBe(true);
  });
  it("бэкап по изменениям", () => {
    const { s } = fixture();
    s.settings.changes = 20;
    expect(backupDue(s)).toBe(true);
    s.settings.backupEnabled = false;
    expect(backupDue(s)).toBe(false);
  });
  it("проверка отклоняет дубли и неизвестные ссылки", () => {
    const { s } = fixture();
    s.materials.push({ ...s.materials[0] });
    expect(() => validate(s)).toThrow();
  });
  it("проверка обнаруживает сломанный журнал резерва", () => {
    const { s, p, printer } = fixture();
    start(s, p.id, 1, printer.id);
    s.movements.pop();
    expect(() => validate(s)).toThrow();
  });
});
