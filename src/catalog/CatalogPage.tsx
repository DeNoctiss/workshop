import { useState } from "react";
import { Header, Modal } from "../components/ui";
import {
  CatalogBrowser,
  ProductDetails,
  type ProductChoice,
} from "./CatalogPicker";
import { ProductEditor } from "./ProductEditor";
import { MaterialForm } from "../pages/Materials";
import { newMaterial } from "./catalog";
import type { CatalogProduct } from "../domain/workspace";
import type { Material } from "../domain/model";
export default function CatalogPage() {
  const [selection, setSelection] = useState<ProductChoice | null>(null),
    [edit, setEdit] = useState<CatalogProduct | null | undefined>(undefined),
    [material, setMaterial] = useState<Material | null>(null);
  return (
    <>
      <Header
        title="Каталог товаров"
        description="Справочник материалов и ваш личный каталог. Покупки и остатки — в разделе «Материалы»."
      >
        <button className="primary" onClick={() => setEdit(null)}>
          Создать свой товар
        </button>
      </Header>
      <section className="panel">
        <CatalogBrowser onPick={setSelection} />
      </section>
      {selection && (
        <Modal
          title={selection.material?.name ?? selection.product!.name}
          onClose={() => setSelection(null)}
        >
          {selection.product && <ProductDetails product={selection.product} />}
          <div className="modal-actions">
            {selection.product?.source === "user" && (
              <button
                onClick={() => {
                  setEdit(selection.product);
                  setSelection(null);
                }}
              >
                Редактировать товар
              </button>
            )}
            <button
              className="primary"
              onClick={() => {
                setMaterial(
                  selection.material ?? newMaterial(selection.product),
                );
                setSelection(null);
              }}
            >
              {selection.material
                ? "Открыть складскую позицию"
                : "Добавить на склад"}
            </button>
          </div>
        </Modal>
      )}
      {edit !== undefined && (
        <ProductEditor
          initial={edit ?? undefined}
          onClose={() => setEdit(undefined)}
        />
      )}
      {material && (
        <MaterialForm initial={material} onClose={() => setMaterial(null)} />
      )}
    </>
  );
}
