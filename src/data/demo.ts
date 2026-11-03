import {
  emptyState,
  uid,
  newProject,
  now,
  type Material,
  type Printer,
} from "../domain/model";
import { movement, start, setStage } from "../domain/engine";
export function demoState() {
  const s = emptyState();
  const printer: Printer = {
    id: uid(),
    name: "Bambu Lab P1S + AMS",
    brand: "Bambu Lab",
    model: "P1S",
    technology: "FDM",
    purchaseDate: "2025-01-01",
    purchaseCost: 10000000,
    lifeHours: 10000,
    powerW: 150,
    tariff: 650,
    maintenanceHour: 300,
    active: true,
  };
  s.printers.push(printer, {
    ...printer,
    id: uid(),
    name: "Смоляной принтер",
    brand: "",
    model: "SLA",
    technology: "SLA",
    purchaseCost: 4000000,
    powerW: 80,
  });
  const add = (
    name: string,
    brand: string,
    code: string,
    category: Material["category"],
    unit: Material["unit"],
    packageQty: number,
    packageCost: number,
    amount: number,
    color: string,
  ) => {
    const m: Material = {
      id: uid(),
      name,
      brand,
      series: "",
      code,
      category,
      unit,
      packageQty,
      packageCost,
      minimum: amount * 0.15,
      color,
      notes: "Демонстрационные цены и остатки",
      archived: false,
      checkedAt: now(),
      checkMethod: "Пример",
    };
    s.materials.push(m);
    movement(
      s,
      m.id,
      "receipt",
      amount,
      "estimated",
      "Начальный демонстрационный остаток",
    );
    return m.id;
  };
  const pla = add(
      "PLA Matte Black",
      "Bambu Lab",
      "",
      "filament",
      "g",
      1000,
      220000,
      650,
      "#30343d",
    ),
    skin = add(
      "Flat Flesh",
      "Vallejo",
      "70.955",
      "paint",
      "ml",
      17,
      35000,
      12,
      "#e5b693",
    ),
    white = add(
      "White",
      "Vallejo",
      "70.951",
      "paint",
      "ml",
      17,
      35000,
      15,
      "#f0f0ed",
    ),
    black = add(
      "Black",
      "Vallejo",
      "70.950",
      "paint",
      "ml",
      17,
      35000,
      10,
      "#222831",
    ),
    primer = add(
      "Серый грунт",
      "Jim Scale",
      "",
      "primer",
      "ml",
      30,
      45000,
      18,
      "#8b909b",
    ),
    box = add(
      "Коробка 15 × 9 × 9",
      "",
      "",
      "packaging",
      "pcs",
      1,
      12000,
      12,
      "#c6b39a",
    );
  for (const [i, name] of [
    "Гитарист · HEADLINERS",
    "Вокалист · HEADLINERS",
    "Барабанщик · HEADLINERS",
  ].entries()) {
    const p = newProject();
    Object.assign(p, {
      title: name,
      description:
        "Демонстрационный рецепт коллекционной фигурки. Цены и расход — примеры, замените своими.",
      tags: ["HEADLINERS", "MUSICIAN SERIES"],
      printerId: printer.id,
      hours: 5 + i,
      laborHours: 2,
      laborRate: 50000,
      items: [
        {
          id: uid(),
          materialId: pla,
          qty: 80 + i * 15,
          scope: "unit",
          source: "slicer",
        },
        {
          id: uid(),
          materialId: black,
          qty: 1,
          scope: "unit",
          source: "estimated",
        },
        {
          id: uid(),
          materialId: primer,
          qty: 2,
          scope: "unit",
          source: "estimated",
        },
        {
          id: uid(),
          materialId: box,
          qty: 1,
          scope: "unit",
          source: "calculated",
        },
      ],
      mixes: [
        {
          id: uid(),
          name: "Оттенок кожи",
          volume: 2,
          lossPercent: 10,
          components: [
            { materialId: skin, share: 75 },
            { materialId: white, share: 25 },
          ],
        },
      ],
    });
    s.projects.push(p);
  }
  const r = start(s, s.projects[0].id, 1, printer.id);
  setStage(s, r.id, "painting");
  return s;
}
