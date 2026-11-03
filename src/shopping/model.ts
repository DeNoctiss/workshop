import type { Category, Unit } from "../domain/model";
export interface PurchaseProject {
  id: string;
  projectId: string;
  count: number;
  separate: boolean;
  additional: boolean;
}
export interface PurchaseConfig {
  lowStock: boolean;
  keepTarget: boolean;
  runIds: string[];
  projects: PurchaseProject[];
  targets: Record<string, number>;
}
export interface PurchaseItem {
  id: string;
  key: string;
  materialId?: string;
  name: string;
  unit: Unit;
  category: Category;
  color?: string;
  manual: boolean;
  physical: number;
  reserved: number;
  demand: number;
  target: number;
  shortage: number;
  quantity: number;
  packageQty?: number;
  packageOverride?: number;
  price?: number;
  override?: number;
  reasons: string[];
  note: string;
  purchasedQty: number;
  receiptMovementId?: string;
  receivedQty?: number;
  receiptCost?: number;
}
export interface ShoppingState {
  config: PurchaseConfig;
  items: PurchaseItem[];
  updatedAt: string;
  warnings: string[];
}
export const defaultPurchaseConfig = (): PurchaseConfig => ({
  lowStock: true,
  keepTarget: false,
  runIds: [],
  projects: [],
  targets: {},
});
