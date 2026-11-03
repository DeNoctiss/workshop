import data from "./builtin.json";
import {
  now,
  uid,
  type Material,
  type State,
  type Unit,
  type Category,
} from "../domain/model";
import type {
  CatalogProduct,
  MaterialReference,
  ProductProperties,
} from "../domain/workspace";
export const builtinProducts = data as CatalogProduct[];
export const normalizeSearch = (s: string) =>
  s
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]/gu, "");
export function matchesProduct(p: CatalogProduct, q: string) {
  const hay = normalizeSearch(
    [
      p.name,
      p.brand,
      p.series,
      p.sku,
      p.colorName,
      ...p.aliases,
      ...Object.values(p.properties),
    ].join(" "),
  );
  return q
    .trim()
    .split(/\s+/)
    .every((t) => hay.includes(normalizeSearch(t)));
}
export const findProduct = (s: State, id?: string) =>
  s.userProducts.find((p) => p.id === id) ??
  builtinProducts.find((p) => p.id === id);
export const defaultUnit = (c: Category): Unit =>
  ["filament", "resin"].includes(c)
    ? "g"
    : ["paint", "primer", "varnish"].includes(c)
      ? "ml"
      : "pcs";
export function newProduct(): CatalogProduct {
  return {
    id: uid(),
    source: "user",
    category: "paint",
    name: "",
    brand: "",
    series: "",
    sku: "",
    aliases: [],
    packages: [],
    properties: { kind: "paint" },
    urls: [],
    checkedAt: now().slice(0, 10),
    datasetVersion: "user",
    license: "Личные данные",
    updatedAt: now(),
  };
}
export function newMaterial(p?: CatalogProduct): Material {
  const pack = p?.packages[0];
  return {
    id: uid(),
    name: p?.name ?? "",
    brand: p?.brand ?? "",
    series: p?.series ?? "",
    code: p?.sku ?? "",
    category: p?.category ?? "filament",
    unit: pack?.unit ?? defaultUnit(p?.category ?? "filament"),
    color: p?.colorHex ?? "",
    colorEnabled: !!p?.colorHex,
    packageQty: pack?.qty ?? 0,
    packageCost: 0,
    minimum: 0,
    notes: "",
    archived: false,
    ...(p
      ? {
          productId: p.id,
          productSnapshot: structuredClone(p),
          packageId: pack?.id,
        }
      : {}),
  };
}
export function productReference(p: CatalogProduct): MaterialReference {
  return {
    productId: p.id,
    snapshot: {
      label: [p.brand, p.series, p.name].filter(Boolean).join(" · "),
      sku: p.sku,
      category: p.category,
      ...(p.colorHex ? { colorHex: p.colorHex } : {}),
    },
  };
}
export function stockReference(m: Material): MaterialReference {
  return {
    ...(m.productId ? { productId: m.productId } : {}),
    inventoryMaterialId: m.id,
    snapshot: {
      label: [m.brand, m.name].filter(Boolean).join(" · "),
      sku: m.code,
      category: m.category,
      ...(m.colorEnabled !== false && /^#[a-f0-9]{6}$/i.test(m.color)
        ? { colorHex: m.color }
        : {}),
    },
  };
}
export const propertyFields: Record<
  Category,
  { key: string; label: string; numeric?: boolean }[]
> = {
  paint: [
    { key: "paintType", label: "Тип (металлик, проливка…)" },
    { key: "finish", label: "Финиш" },
    { key: "application", label: "Нанесение" },
  ],
  filament: [
    { key: "polymer", label: "Полимер (PLA, PETG…)" },
    { key: "diameter", label: "Диаметр, мм", numeric: true },
    { key: "density", label: "Плотность, г/см³", numeric: true },
    { key: "nozzleMin", label: "Сопло от, °C", numeric: true },
    { key: "nozzleMax", label: "Сопло до, °C", numeric: true },
    { key: "bedMin", label: "Стол от, °C", numeric: true },
    { key: "bedMax", label: "Стол до, °C", numeric: true },
    { key: "finish", label: "Финиш" },
  ],
  resin: [
    { key: "resinType", label: "Тип (standard, tough…)" },
    { key: "density", label: "Плотность, г/см³", numeric: true },
    { key: "wavelength", label: "Длина волны, нм", numeric: true },
  ],
  primer: [
    { key: "base", label: "Основа" },
    { key: "application", label: "Нанесение" },
  ],
  varnish: [
    { key: "finish", label: "Финиш" },
    { key: "base", label: "Основа" },
    { key: "application", label: "Нанесение" },
  ],
  glue: [{ key: "details", label: "Свойства" }],
  abrasive: [{ key: "details", label: "Зернистость и свойства" }],
  packaging: [{ key: "details", label: "Размер и свойства" }],
  other: [{ key: "details", label: "Свойства" }],
};
export function propertyText(p: ProductProperties) {
  return propertyFields[p.kind]
    .map((f) => ({
      label: f.label,
      value: (p as unknown as Record<string, unknown>)[f.key],
    }))
    .filter((f) => f.value !== undefined && f.value !== "");
}
