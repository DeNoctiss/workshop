import type { ShoppingState } from "../shopping/model";
import type {
  CatalogProduct,
  Customer,
  ProjectBoard,
  ProjectNote,
  RunNote,
  RunTask,
} from "./workspace";
export type Unit = "g" | "ml" | "pcs" | "m";
export type Category =
  | "filament"
  | "resin"
  | "paint"
  | "primer"
  | "varnish"
  | "glue"
  | "abrasive"
  | "packaging"
  | "other";
export type Stage =
  | "planned"
  | "printing"
  | "processing"
  | "painting"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type Source =
  "slicer" | "calculated" | "estimated" | "measured" | "plan" | "inventory";
export const units: Record<Unit, string> = {
  g: "г",
  ml: "мл",
  pcs: "шт",
  m: "м",
};
export const categories: Record<Category, string> = {
  filament: "Филамент",
  resin: "Смола",
  paint: "Краска",
  primer: "Грунт",
  varnish: "Лак",
  glue: "Клей",
  abrasive: "Абразив",
  packaging: "Упаковка",
  other: "Прочее",
};
export const stages: Record<Stage, string> = {
  planned: "Запланировано",
  printing: "Печать",
  processing: "Постобработка",
  painting: "Покраска",
  paused: "Пауза",
  completed: "Завершено",
  failed: "Брак",
  cancelled: "Отменено",
};
export const sources: Record<Source, string> = {
  slicer: "Слайсер",
  calculated: "Расчёт",
  estimated: "Ручная оценка",
  measured: "Измерено",
  plan: "Подтверждено по плану",
  inventory: "Инвентаризация",
};
export interface Material {
  productId?: string;
  productSnapshot?: CatalogProduct;
  packageId?: string;
  id: string;
  name: string;
  brand: string;
  series: string;
  code: string;
  category: Category;
  color: string;
  /** Missing in v0.1/v0.2 means the existing color stays visible. */
  colorEnabled?: boolean;
  unit: Unit;
  packageQty: number;
  packageCost: number;
  minimum: number;
  notes: string;
  archived: boolean;
  checkedAt?: string;
  checkMethod?: string;
}
export interface Printer {
  id: string;
  name: string;
  brand: string;
  model: string;
  technology: "FDM" | "SLA";
  purchaseDate: string;
  purchaseCost: number;
  lifeHours: number;
  powerW: number;
  tariff: number;
  maintenanceHour: number;
  active: boolean;
}
export interface RecipeItem {
  id: string;
  materialId: string;
  qty: number;
  scope: "unit" | "batch";
  source: Source;
}
export interface Mix {
  id: string;
  name: string;
  volume: number;
  lossPercent: number;
  components: { materialId: string; share: number }[];
}
export interface Project {
  id: string;
  title: string;
  description: string;
  size: string;
  tags: string[];
  technology: "FDM" | "SLA";
  printerId: string;
  items: RecipeItem[];
  mixes: Mix[];
  hours: number;
  laborHours: number;
  laborRate: number;
  extra: number;
  notes: string;
  archived: boolean;
  updatedAt: string;
  profiles: { printerId: string; hours: number; factor: number }[];
}
export interface Movement {
  id: string;
  materialId: string;
  kind: "receipt" | "reserve" | "release" | "consume" | "waste" | "adjustment";
  qty: number;
  at: string;
  runId?: string;
  source: Source;
  note: string;
}
export interface Line {
  materialId: string;
  name: string;
  unit: Unit;
  qty: number;
  unitCost: number;
}
export interface Cost {
  materials: number;
  electricity: number;
  depreciation: number;
  maintenance: number;
  labor: number;
  extra: number;
  total: number;
}
export interface Run {
  customer?: Customer;
  id: string;
  projectId: string;
  title: string;
  count: number;
  stage: Stage;
  createdAt: string;
  closedAt?: string;
  recipe: Project;
  printer: Printer;
  lines: Line[];
  hours: number;
  factor: number;
  laborHours: number;
  cost: Cost;
  actual?: Record<string, number>;
  actualHours?: number;
  actualLaborHours?: number;
  actualExtra?: number;
  actualCost?: Cost;
  source?: Source;
  reason?: string;
  relatedRunId?: string;
}
export type AssetGroup = "main" | "person" | "model" | "process" | "finished";
export const assetGroups: Record<AssetGroup, string> = {
  main: "Основные фото",
  person: "Референсы человека",
  model: "Референсы 3D-модели",
  process: "Процесс",
  finished: "Готовое изделие",
};
export interface Asset {
  id: string;
  projectId: string;
  group: AssetGroup;
  caption: string;
  order: number;
  cover: boolean;
  purpose?: "note" | "paint-mask" | "paint-preview";
  blob: Blob;
  thumb: Blob;
}
export type AssetMeta = Omit<Asset, "blob" | "thumb">;
export interface Settings {
  theme: "light" | "dark";
  inventoryEnabled: boolean;
  inventoryDays: number;
  inventoryRuns: number;
  inventoryAt: string;
  inventoryCompleted: number;
  snoozeUntil: string;
  backupEnabled: boolean;
  backupDays: number;
  backupChanges: number;
  backupAt: string;
  changes: number;
  backupRevision: number;
}
export interface State {
  shopping?: ShoppingState;
  schemaVersion: 3;
  userProducts: CatalogProduct[];
  projectNotes: ProjectNote[];
  runNotes: RunNote[];
  runTasks: RunTask[];
  boards: ProjectBoard[];
  revision: number;
  materials: Material[];
  printers: Printer[];
  projects: Project[];
  runs: Run[];
  movements: Movement[];
  settings: Settings;
}
export function uid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const s = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export const now = () => new Date().toISOString();
export const closed = (r: Run) =>
  ["completed", "failed", "cancelled"].includes(r.stage);
export const emptyState = (): State => ({
  schemaVersion: 3,
  userProducts: [],
  projectNotes: [],
  runNotes: [],
  runTasks: [],
  boards: [],
  revision: 0,
  materials: [],
  printers: [],
  projects: [],
  runs: [],
  movements: [],
  settings: {
    theme: "light",
    inventoryEnabled: true,
    inventoryDays: 14,
    inventoryRuns: 5,
    inventoryAt: now(),
    inventoryCompleted: 0,
    snoozeUntil: "",
    backupEnabled: true,
    backupDays: 7,
    backupChanges: 20,
    backupAt: now(),
    changes: 0,
    backupRevision: 0,
  },
});
export const newProject = (): Project => ({
  id: uid(),
  title: "",
  description: "",
  size: "12 см",
  tags: [],
  technology: "FDM",
  printerId: "",
  items: [],
  mixes: [],
  hours: 0,
  laborHours: 0,
  laborRate: 0,
  extra: 0,
  notes: "",
  archived: false,
  updatedAt: now(),
  profiles: [],
});
