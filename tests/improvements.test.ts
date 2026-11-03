import { describe, it, expect } from "vitest";
import { fixture } from "./fixture";
import {
  stockHealth,
  reconcile,
  movement,
  planLaunch,
  startLaunch,
  stock,
  finish,
} from "../src/domain/engine";
import { notifications } from "../src/domain/notifications";
import { validate } from "../src/domain/validation";

describe("уровни запасов", () => {
  it.each([
    [501, "healthy"],
    [500, "warning"],
    [201, "warning"],
    [200, "critical"],
    [0, "critical"],
  ])("остаток %s → %s", (amount, level) => {
    const { s, m } = fixture();
    m.minimum = 200;
    reconcile(s, m.id, Number(amount), "Измерено", "");
    expect(stockHealth(s, m).level).toBe(level);
  });
  it("1 мл краски предупреждает даже при нулевом минимуме", () => {
    const { s, m } = fixture();
    m.category = "paint";
    m.unit = "ml";
    m.minimum = 0;
    m.packageQty = 17;
    reconcile(s, m.id, 1, "Измерено", "");
    expect(stockHealth(s, m).level).toBe("warning");
    expect(notifications(s).some((x) => x.title.includes(m.name))).toBe(true);
  });
  it("резерв учитывается, отрицательный остаток сохраняется, архив скрыт", () => {
    const { s, m, p, printer } = fixture();
    startLaunch(s, p.id, 1, printer.id, "batch");
    expect(stockHealth(s, m).percent).toBe(10);
    reconcile(s, m.id, 100, "Измерено", "");
    expect(stockHealth(s, m).available).toBe(-100);
    expect(stockHealth(s, m).percent).toBe(0);
    m.archived = true;
    expect(notifications(s).some((x) => x.id.startsWith("stock:"))).toBe(false);
  });
  it("пополнение снимает предупреждение, повторный расход создаёт новое", () => {
    const { s, m } = fixture();
    const first = notifications(s).find((x) => x.id.startsWith("stock:"))!.id;
    movement(s, m.id, "receipt", 1000, "measured");
    expect(notifications(s).some((x) => x.id.startsWith("stock:"))).toBe(false);
    reconcile(s, m.id, 300, "Измерено", "");
    expect(
      notifications(s).find((x) => x.id.startsWith("stock:"))!.id,
    ).not.toBe(first);
  });
});
describe("режимы запуска", () => {
  it("разовый расход учитывается для каждого отдельного запуска", () => {
    const { s, p, m, printer } = fixture();
    movement(s, m.id, "receipt", 1000, "measured");
    p.items.push({ ...p.items[0], id: "batch-line", qty: 10, scope: "batch" });
    p.laborHours = 1;
    p.laborRate = 100;
    p.extra = 25;
    const batch = planLaunch(s, p, 3, printer.id, "batch", { hours: 9 });
    const separate = planLaunch(s, p, 3, printer.id, "separate", { hours: 9 });
    expect(batch.lines[0].qty).toBe(610);
    expect(separate.lines[0].qty).toBe(630);
    const runs = startLaunch(s, p.id, 3, printer.id, "separate", { hours: 9 });
    expect(runs).toHaveLength(3);
    expect(
      runs.every((r) => r.count === 1 && r.hours === 3 && r.laborHours === 1),
    ).toBe(true);
    expect(runs.reduce((n, r) => n + r.cost.total, 0)).toBe(
      separate.cost.total,
    );
    expect(stock(s, m.id).reserved).toBe(630);
    validate(s);
    finish(s, runs[0].id, "cancelled", {}, "measured");
    expect(stock(s, m.id).reserved).toBe(420);
    expect(s.runs[1].stage).toBe("planned");
    validate(s);
  });
  it("одна партия создаёт одну запись", () => {
    const { s, p, m, printer } = fixture();
    movement(s, m.id, "receipt", 1000, "measured");
    const runs = startLaunch(s, p.id, 3, printer.id, "batch");
    expect(runs).toHaveLength(1);
    expect(runs[0].count).toBe(3);
    validate(s);
  });
  it("нехватка на всю партию не оставляет частичных запусков и резервов", () => {
    const { s, p, printer } = fixture();
    const before = structuredClone(s);
    expect(() => startLaunch(s, p.id, 3, printer.id, "separate")).toThrow();
    expect(s).toEqual(before);
  });
  it.each([0, -1, 1.5, 10001])("отклоняет неверное количество %s", (count) => {
    const { s, p, printer } = fixture();
    expect(() => startLaunch(s, p.id, count, printer.id, "separate")).toThrow();
  });
});

it("высокий порог сохраняет жёлтую зону выше красной", () => {
  const { s, m } = fixture();
  m.minimum = 700;
  reconcile(s, m.id, 750, "Измерено", "");
  expect(stockHealth(s, m).level).toBe("warning");
  reconcile(s, m.id, 700, "Измерено", "");
  expect(stockHealth(s, m).level).toBe("critical");
});
