import {
  emptyState,
  newProject,
  uid,
  type Printer,
  type Material,
} from "../src/domain/model";
import { movement } from "../src/domain/engine";
export function fixture() {
  const s = emptyState();
  const m: Material = {
    id: uid(),
    name: "PLA",
    brand: "",
    series: "",
    code: "",
    category: "filament",
    unit: "g",
    packageQty: 1000,
    packageCost: 200000,
    minimum: 10,
    color: "#333333",
    notes: "",
    archived: false,
  };
  s.materials.push(m);
  const printer: Printer = {
    id: uid(),
    name: "P1S",
    brand: "Bambu",
    model: "P1S",
    technology: "FDM",
    purchaseDate: "",
    purchaseCost: 10000000,
    lifeHours: 10000,
    powerW: 100,
    tariff: 500,
    maintenanceHour: 200,
    active: true,
  };
  s.printers.push(printer);
  const p = newProject();
  p.title = "Фигурка";
  p.printerId = printer.id;
  p.hours = 2;
  p.items = [
    { id: uid(), materialId: m.id, qty: 200, scope: "unit", source: "slicer" },
  ];
  s.projects.push(p);
  movement(s, m.id, "receipt", 300, "measured");
  return { s, m, p, printer };
}
