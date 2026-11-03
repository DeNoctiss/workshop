import type { Node, Edge } from "@xyflow/react";
import type { Category, Unit } from "./model";
export type ProductProperties =
  | { kind: "paint"; paintType?: string; finish?: string; application?: string }
  | {
      kind: "filament";
      polymer?: string;
      diameter?: number;
      density?: number;
      nozzleMin?: number;
      nozzleMax?: number;
      bedMin?: number;
      bedMax?: number;
      finish?: string;
    }
  | { kind: "resin"; resinType?: string; density?: number; wavelength?: number }
  | { kind: "primer"; base?: string; application?: string }
  | {
      kind: "varnish";
      finish?: string;
      base?: string;
      application?: string;
      transparent?: boolean;
    }
  | { kind: "glue" | "abrasive" | "packaging" | "other"; details?: string };
export interface CatalogProduct {
  id: string;
  source: "builtin" | "user";
  category: Category;
  name: string;
  brand: string;
  series: string;
  sku: string;
  aliases: string[];
  colorHex?: string;
  colorName?: string;
  discontinued?: boolean;
  packages: { id: string; label: string; qty: number; unit: Unit }[];
  properties: ProductProperties;
  urls: string[];
  checkedAt: string;
  datasetVersion: string;
  license: string;
  updatedAt?: string;
}
export interface MaterialReference {
  productId?: string;
  inventoryMaterialId?: string;
  snapshot: {
    label: string;
    colorHex?: string;
    sku?: string;
    category?: Category;
  };
  comment?: string;
}
export interface ProjectNote {
  id: string;
  projectId: string;
  text: string;
  attachmentIds?: string[];
  createdAt: string;
  updatedAt: string;
}
export interface RunNote {
  id: string;
  runId: string;
  text: string;
  attachmentIds?: string[];
  createdAt: string;
  updatedAt: string;
  source: "internal" | "customer_reported";
}
export interface RunTask {
  id: string;
  runId: string;
  text: string;
  done: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  sourceNoteId?: string;
}
export interface Customer {
  name: string;
  chatUrl: string;
  requests: string;
}
export type PaintBlend = "color" | "multiply" | "soft-light" | "source-over";
export interface PaintLayer {
  id: string;
  name: string;
  maskAssetId: string;
  color: string;
  opacity: number;
  visible: boolean;
  blend: PaintBlend;
  material?: MaterialReference;
}
export interface PaintDocument {
  schemaVersion?: 1 | 2;
  id: string;
  sourceAssetId: string;
  previewAssetId: string;
  width: number;
  height: number;
  layers: PaintLayer[];
  updatedAt: string;
}
export type BoardData =
  | { kind: "paint"; title: string; document: PaintDocument }
  | { kind: "image"; title: string; assetId: string }
  | { kind: "note"; title: string; text: string; color?: string }
  | {
      kind: "checklist";
      title: string;
      items: { id: string; text: string; done: boolean }[];
    }
  | { kind: "group"; title: string; color?: string }
  | { kind: "material"; title: string; material: MaterialReference }
  | { kind: "palette"; title: string; colors: MaterialReference[] }
  | { kind: "link"; title: string; url: string };
export type BoardNode = Node<BoardData, "workshop">;
export interface ProjectBoard {
  id: string;
  projectId: string;
  schemaVersion: 1;
  revision: number;
  nodes: BoardNode[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number };
  updatedAt: string;
  migratedAssetIds: string[];
}
export const emptyCustomer = (): Customer => ({
  name: "",
  chatUrl: "",
  requests: "",
});
export function safeUrl(text: string): string | null {
  try {
    const u = new URL(text);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
