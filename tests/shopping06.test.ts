import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { fixture } from "./fixture";
import { stock, start, movement } from "../src/domain/engine";
import { uid } from "../src/domain/model";
import { validate } from "../src/domain/validation";
import {
  generatePurchases,
  purchaseNeed,
  receivePurchase,
} from "../src/shopping/engine";
import { defaultPurchaseConfig } from "../src/shopping/model";
import { purchaseCsv } from "../src/shopping/export";
import { encodeBackup, decodeBackup } from "../src/data/backup";
import { db, replaceAll, mutate, readState } from "../src/data/db";
beforeEach(async () => {
  await db.open();
  await db.transaction("rw", db.states, db.assets, db.assetIndex, async () => {
    await db.states.clear();
    await db.assets.clear();
    await db.assetIndex.clear();
  });
});
describe("Закупки", () => {
  it("считает свободный остаток, потребность и упаковки", () =>
    expect(purchaseNeed(500, 200, 400, 100, 1000)).toEqual({
      available: 300,
      shortage: 200,
      quantity: 1000,
    }));
  it("учитывает отрицательный свободный остаток", () =>
    expect(purchaseNeed(100, 150, 0, 0)).toEqual({
      available: -50,
      shortage: 50,
      quantity: 50,
    }));
  it("не заказывает нулевой дефицит при равенстве цели порогу", () =>
    expect(purchaseNeed(4, 0, 0, 4, 18).shortage).toBe(0));
  it("не учитывает полный резерв повторно", () => {
    const { s, p, printer } = fixture();
    const run = start(s, p.id, 1, printer.id);
    const cfg = {
      ...defaultPurchaseConfig(),
      lowStock: false,
      runIds: [run.id],
    };
    expect(generatePurchases(s, cfg).items).toHaveLength(0);
  });
  it("добавляет только незарезервированный расход при частичном резерве", () => {
    const { s, m, p, printer } = fixture();
    p.items[0].qty = 120;
    const run = start(s, p.id, 1, printer.id);
    movement(s, m.id, "release", 70, "measured", "", run.id);
    movement(s, m.id, "adjustment", -200, "inventory");
    const cfg = {
      ...defaultPurchaseConfig(),
      lowStock: false,
      runIds: [run.id],
    };
    const row = generatePurchases(s, cfg).items[0];
    expect(row).toMatchObject({
      demand: 70,
      reserved: 50,
      physical: 100,
      shortage: 20,
    });
  });
  it("не добавляет активный проект как новую партию без явного выбора", () => {
    const { s, p, printer } = fixture();
    start(s, p.id, 1, printer.id);
    const cfg = {
      ...defaultPurchaseConfig(),
      lowStock: false,
      projects: [
        {
          id: uid(),
          projectId: p.id,
          count: 2,
          separate: false,
          additional: false,
        },
      ],
    };
    expect(generatePurchases(s, cfg).warnings[0]).toContain("уже есть");
    cfg.projects[0].additional = true;
    expect(generatePurchases(s, cfg).items[0].demand).toBe(400);
  });
  it("различает расход на изделие и на отдельный запуск", () => {
    const { s, p, m } = fixture();
    p.items[0] = { ...p.items[0], scope: "batch", qty: 5 };
    movement(s, m.id, "adjustment", -300, "inventory");
    const cfg = {
      ...defaultPurchaseConfig(),
      lowStock: false,
      projects: [
        {
          id: uid(),
          projectId: p.id,
          count: 3,
          separate: false,
          additional: false,
        },
      ],
    };
    expect(generatePurchases(s, cfg).items[0].demand).toBe(5);
    cfg.projects[0].separate = true;
    expect(generatePurchases(s, cfg).items[0].demand).toBe(15);
  });
  it("не объединяет одинаковые названия разных материалов", () => {
    const { s, m } = fixture();
    m.minimum = 400;
    s.materials.push({ ...m, id: uid() });
    expect(generatePurchases(s, defaultPurchaseConfig()).items).toHaveLength(2);
  });
  it("сохраняет заметки и купленный объём, но открывает выросшую потребность", () => {
    const { s, m } = fixture();
    m.minimum = 400;
    const list = generatePurchases(s, defaultPurchaseConfig());
    list.items[0].note = "Матовый";
    list.items[0].purchasedQty = 1000;
    const cfg = { ...list.config, targets: { [m.id]: 2000 } };
    const next = generatePurchases(s, cfg, list.items).items[0];
    expect(next.note).toBe("Матовый");
    expect(next.purchasedQty).toBe(1000);
    expect(next.quantity).toBe(2000);
    expect(next.reasons.join(" ")).toContain("выросла");
  });
  it("не представляет неизвестную цену как бесплатную покупку", () => {
    const { s, m } = fixture();
    m.minimum = 400;
    m.packageCost = 0;
    expect(
      generatePurchases(s, defaultPurchaseConfig()).items[0].price,
    ).toBeUndefined();
  });
  it("проверяет ввод и старые документы без закупок", () => {
    const { s, p } = fixture();
    expect(() => validate(s)).not.toThrow();
    expect(() =>
      generatePurchases(s, {
        ...defaultPurchaseConfig(),
        projects: [
          {
            id: uid(),
            projectId: p.id,
            count: NaN,
            separate: false,
            additional: false,
          },
        ],
      }),
    ).toThrow();
  });
  it("галочка не меняет склад, а приход связан с ровно одним движением", () => {
    const { s, m } = fixture();
    m.minimum = 400;
    s.shopping = generatePurchases(s, defaultPurchaseConfig());
    const row = s.shopping.items[0];
    row.purchasedQty = row.quantity;
    expect(stock(s, m.id).physical).toBe(300);
    receivePurchase(s, row.id, 1000, 150000);
    expect(stock(s, m.id).physical).toBe(1300);
    expect(m.packageCost).toBe(150000);
    expect(() => receivePurchase(s, row.id, 1000)).toThrow("уже оприходована");
    expect(stock(s, m.id).physical).toBe(1300);
    expect(() => validate(s)).not.toThrow();
  });
  it("два конкурентных прихода проходят через атомарную проверку", async () => {
    const { s, m } = fixture();
    m.minimum = 400;
    s.shopping = generatePurchases(s, defaultPurchaseConfig());
    await replaceAll(s, []);
    const id = s.shopping.items[0].id;
    const results = await Promise.allSettled([
      mutate((d) => receivePurchase(d, id, 1000)),
      mutate((d) => receivePurchase(d, id, 1000)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(stock(await readState(), m.id).physical).toBe(1300);
  });
  it("включает покупки и связи прихода в резервную копию", async () => {
    const { s, m } = fixture();
    m.minimum = 400;
    s.shopping = generatePurchases(s, defaultPurchaseConfig());
    receivePurchase(s, s.shopping.items[0].id, 18);
    const backup = decodeBackup(await encodeBackup(s, []));
    expect(backup.state.shopping).toEqual(s.shopping);
    expect(() => validate(backup.state)).not.toThrow();
  });
  it("CSV сохраняет кириллицу и нейтрализует формулы", () => {
    const { s, m } = fixture();
    m.minimum = 400;
    m.name = "=1+1";
    m.brand = "";
    const list = generatePurchases(s, defaultPurchaseConfig());
    list.items[0].note = 'Тест; "краска"';
    const csv = purchaseCsv(list);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain('"Тест; ""краска"""');
  });
});

describe("Ручные поправки закупок", () => {
  it("сохраняет ручной объём при исчезновении автоматического дефицита", () => {
    const { s, m } = fixture();
    m.minimum = 400;
    const cfg = defaultPurchaseConfig(),
      list = generatePurchases(s, cfg);
    list.items[0].override = 750;
    movement(s, m.id, "receipt", 2000, "measured");
    expect(generatePurchases(s, cfg, list.items).items[0].quantity).toBe(750);
  });
  it("учитывает выбранный объём упаковки и растущую потребность", () => {
    const { s, m } = fixture();
    m.minimum = 400;
    const cfg = defaultPurchaseConfig(),
      list = generatePurchases(s, cfg);
    list.items[0].packageOverride = 250;
    list.items[0].override = 750;
    expect(generatePurchases(s, cfg, list.items).items[0].quantity).toBe(750);
    cfg.targets[m.id] = 1500;
    const item = generatePurchases(s, cfg, list.items).items[0];
    expect(item.shortage).toBe(1200);
    expect(item.quantity).toBe(1250);
    expect(item.packageQty).toBe(250);
  });
});
