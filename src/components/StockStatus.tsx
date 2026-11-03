import {
  CircleDot,
  Droplets,
  Paintbrush,
  SprayCan,
  Shield,
  Pipette,
  Layers,
  Package,
  Wrench,
} from "lucide-react";
import { stockHealth } from "../domain/engine";
import { categories, units, type Category } from "../domain/model";
import { useApp } from "./context";
import { qty } from "./ui";
const icons = {
  filament: CircleDot,
  resin: Droplets,
  paint: Paintbrush,
  primer: SprayCan,
  varnish: Shield,
  glue: Pipette,
  abrasive: Layers,
  packaging: Package,
  other: Wrench,
};
export function MaterialKind({ category }: { category: Category }) {
  const Icon = icons[category];
  return (
    <span
      className="material-kind"
      tabIndex={0}
      role="img"
      aria-label={categories[category]}
      data-tooltip={categories[category]}
    >
      <Icon size={28} strokeWidth={1.7} aria-hidden="true" />
    </span>
  );
}
export function StockWarnings() {
  const { state } = useApp();
  const stocks = state.materials
    .filter((m) => !m.archived)
    .map((m) => ({ m, ...stockHealth(state, m) }));
  return (
    <div className="stock-warnings">
      {(["critical", "warning"] as const).map((level) => {
        const list = stocks
          .filter((x) => x.level === level)
          .sort((a, b) => a.percent - b.percent);
        if (!list.length) return null;
        return (
          <details key={level} className={"stock-warning " + level}>
            <summary>
              {level === "critical"
                ? "Необходимо пополнить"
                : "Скоро закончатся"}{" "}
              · {list.length}
            </summary>
            <ul>
              {list.slice(0, 3).map((x) => (
                <li key={x.m.id}>
                  <span>{x.m.name}</span>
                  <b>
                    {qty(x.available)} {units[x.m.unit]} ·{" "}
                    {Math.round(x.percent)}%
                  </b>
                </li>
              ))}
            </ul>
            <a href={"#/materials/" + level}>Посмотреть весь список →</a>
          </details>
        );
      })}
    </div>
  );
}

export function MaterialIdentity({
  material,
  name,
}: {
  material: import("../domain/model").Material;
  name?: string;
}) {
  return (
    <div className="material-name">
      <MaterialKind category={material.category} />
      {material.colorEnabled !== false && material.color && (
        <span
          className="swatch"
          role="img"
          aria-label={"Цвет: " + material.color}
          style={{ background: material.color }}
        />
      )}
      <div>
        <strong>{name || material.name}</strong>
        <small>{units[material.unit]}</small>
      </div>
    </div>
  );
}
