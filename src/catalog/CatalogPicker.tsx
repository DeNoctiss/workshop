import { useMemo, useState } from "react";
import { Search, Plus, ExternalLink } from "lucide-react";
import { useApp } from "../components/context";
import { Field, Modal, Badge, qty } from "../components/ui";
import { Paged } from "../components/Paged";
import { MaterialKind } from "../components/StockStatus";
import { categories, units, type Material } from "../domain/model";
import type { CatalogProduct, MaterialReference } from "../domain/workspace";
import { stock } from "../domain/engine";
import {
  builtinProducts,
  matchesProduct,
  normalizeSearch,
  productReference,
  stockReference,
  propertyText,
} from "./catalog";
import { ProductEditor } from "./ProductEditor";
export interface ProductChoice {
  reference: MaterialReference;
  product?: CatalogProduct;
  material?: Material;
}
export function ProductDetails({ product: p }: { product: CatalogProduct }) {
  return (
    <div className="product-details">
      <p>{[p.brand, p.series, p.sku].filter(Boolean).join(" · ")}</p>
      <div className="product-swatches">
        {p.colorHex && (
          <span className="swatch large" style={{ background: p.colorHex }} />
        )}
        {p.colorName || p.colorHex || "Цвет не указан"}
      </div>
      <dl>
        {propertyText(p.properties).map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{String(f.value)}</dd>
          </div>
        ))}
      </dl>
      <p>
        Упаковки:{" "}
        {p.packages
          .map((x) => x.label || `${qty(x.qty)} ${units[x.unit]}`)
          .join(" / ") ||
          "Укажите объём своей упаковки при добавлении на склад"}
      </p>
      <details>
        <summary>Источники и проверка</summary>
        <p>
          {p.source === "builtin" ? "Встроенный" : "Личный"} каталог ·{" "}
          {p.datasetVersion} · проверено {p.checkedAt}
        </p>
        <p>{p.license}</p>
        {p.urls.map((u) => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer">
            Источник <ExternalLink size={14} />
          </a>
        ))}
        <p className="muted">
          HEX — визуальный ориентир. Параметры из справочника сверяйте с
          этикеткой вашей упаковки.
        </p>
      </details>
    </div>
  );
}
export function CatalogBrowser({
  onPick,
  stockOnly = false,
  initialSource = "all",
}: {
  onPick: (c: ProductChoice) => void;
  stockOnly?: boolean;
  initialSource?: "all" | "stock";
}) {
  const { state } = useApp();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [brand, setBrand] = useState(""),
    [source, setSource] = useState<string>(stockOnly ? "stock" : initialSource),
    [create, setCreate] = useState(false);
  const products = useMemo(
    () => [...state.userProducts, ...builtinProducts],
    [state.userProducts],
  );
  const brands = Array.from(
    new Set(
      products
        .filter((p) => !category || p.category === category)
        .map((p) => p.brand)
        .filter(Boolean),
    ),
  ).sort();
  const entries: ProductChoice[] =
    source === "stock"
      ? state.materials
          .filter(
            (m) =>
              !m.archived &&
              (!category || m.category === category) &&
              (!brand || m.brand === brand) &&
              normalizeSearch(
                [m.name, m.brand, m.series, m.code].join(" "),
              ).includes(normalizeSearch(query)),
          )
          .map((m) => ({
            material: m,
            reference: stockReference(m),
            product: products.find((p) => p.id === m.productId),
          }))
      : products
          .filter(
            (p) =>
              (source === "all" || p.source === source) &&
              (!category || p.category === category) &&
              (!brand || p.brand === brand) &&
              matchesProduct(p, query),
          )
          .map((p) => ({ product: p, reference: productReference(p) }));
  return (
    <>
      <div className="catalog-filters">
        <div className="search">
          <Search size={18} />
          <input
            placeholder="Название, бренд, артикул или свойство…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="segmented">
          {(stockOnly
            ? [["stock", "Мой склад"]]
            : [
                ["all", "Все товары"],
                ["builtin", "Встроенные"],
                ["user", "Свои"],
                ["stock", "Мой склад"],
              ]
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={source === key}
              onClick={() => setSource(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Категория">
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setBrand("");
              }}
            >
              <option value="">Все категории</option>
              {Object.entries(categories).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Бренд">
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">Все бренды</option>
              {brands.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <div className="catalog-results">
        <Paged scroll>
          {entries.map((c) => {
            const p = c.product,
              m = c.material,
              ref = c.reference,
              warehouse = m
                ? [m]
                : state.materials.filter(
                    (m) => m.productId === p?.id && !m.archived,
                  );
            return (
              <button
                type="button"
                className="catalog-option"
                key={m?.id ?? p!.id}
                onClick={() => onPick(c)}
              >
                <MaterialKind category={m?.category ?? p!.category} />
                <span
                  className="swatch"
                  style={{ background: ref.snapshot.colorHex || "transparent" }}
                />
                <span className="catalog-label">
                  <strong>{m?.name ?? p!.name}</strong>
                  <small>
                    {[
                      m?.brand ?? p?.brand,
                      m?.series ?? p?.series,
                      m?.code ?? p?.sku,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <span>
                  {warehouse.length ? (
                    <Badge tone="success">
                      {m
                        ? `${qty(stock(state, m.id).available)} ${units[m.unit]}`
                        : "Есть на складе"}
                    </Badge>
                  ) : (
                    <Badge>Нет на складе</Badge>
                  )}
                </span>
              </button>
            );
          })}
        </Paged>
        {!entries.length && (
          <p className="empty">
            Ничего не найдено. Измените поиск или создайте свой товар.
          </p>
        )}
      </div>
      {!stockOnly && (
        <button
          className="catalog-create"
          type="button"
          onClick={() => setCreate(true)}
        >
          <Plus size={16} />
          Не нашли? Создать свой материал
        </button>
      )}
      <small className="muted">
        Локальный справочник 2026.10.28 · {builtinProducts.length} товаров · без
        цен и остатков
      </small>
      {create && (
        <ProductEditor
          onClose={() => setCreate(false)}
          onSaved={(p) =>
            onPick({ product: p, reference: productReference(p) })
          }
        />
      )}
    </>
  );
}
export function CatalogPicker({
  onPick,
  onClose,
  stockOnly = false,
}: {
  onPick: (c: ProductChoice) => void;
  onClose: () => void;
  stockOnly?: boolean;
}) {
  return (
    <Modal title="Выбрать материал" onClose={onClose} wide>
      <CatalogBrowser
        onPick={onPick}
        stockOnly={stockOnly}
        initialSource="stock"
      />
    </Modal>
  );
}
