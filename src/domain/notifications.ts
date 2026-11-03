import { backupDue, inventoryDue, stockHealth } from "./engine";
import { units, type State } from "./model";
export function notifications(s: State) {
  const result: {
    id: string;
    title: string;
    detail: string;
    href: string;
    tone: string;
  }[] = [];
  for (const m of s.materials.filter((m) => !m.archived)) {
    const health = stockHealth(s, m);
    if (health.level === "healthy") continue;
    const last =
      s.movements.filter((x) => x.materialId === m.id).at(-1)?.id ?? "";
    result.push({
      id: `stock:${m.id}:${health.level}:${last}`,
      title:
        (health.level === "critical" ? "Пополнить: " : "Скоро закончится: ") +
        m.name,
      detail: `Доступно ${health.available} ${units[m.unit]} · ${Math.round(health.percent)}% упаковки`,
      href: "#/materials/" + health.level,
      tone: health.level,
    });
  }
  result.sort(
    (a, b) => Number(b.tone === "critical") - Number(a.tone === "critical"),
  );
  if (inventoryDue(s))
    result.push({
      id: "inventory:" + s.settings.inventoryAt,
      title: "Пора сверить материалы",
      detail: "Сравните расчётные остатки с фактическими.",
      href: "#/inventory",
      tone: "warning",
    });
  if (backupDue(s))
    result.push({
      id: "backup:" + s.settings.backupAt,
      title: "Сохраните резервную копию",
      detail: "Экспорт мастерской доступен в настройках и в боковом меню.",
      href: "#/settings",
      tone: "neutral",
    });
  return result;
}
