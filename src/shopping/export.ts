import type { ShoppingState } from "./model";
import { units } from "../domain/model";
const packs = (q: number, p?: number) =>
  p && p > 0 ? String(Math.ceil(q / p - 1e-9)) : "";
export function purchaseText(list: ShoppingState) {
  return (
    "Закупки · " +
    new Date(list.updatedAt).toLocaleDateString("ru-RU") +
    "\n" +
    list.items
      .filter((i) => !i.receiptMovementId)
      .map(
        (i) =>
          `${i.purchasedQty >= i.quantity && i.quantity > 0 ? "☑" : "☐"} ${i.name} — ${i.quantity} ${units[i.unit]}${i.packageQty ? " (" + packs(i.quantity, i.packageQty) + " уп.)" : ""}${i.note ? " · " + i.note : ""}`,
      )
      .join("\n")
  );
}
export function purchaseCsv(list: ShoppingState) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const rows: unknown[][] = [
    [
      "Дата",
      "Куплено",
      "Материал",
      "Количество",
      "Единица",
      "Упаковок",
      "Нехватка",
      "Стоимость, ₽",
      "Примечание",
    ],
  ];
  for (const i of list.items.filter((x) => !x.receiptMovementId))
    rows.push([
      new Date(list.updatedAt).toLocaleDateString("ru-RU"),
      i.quantity > 0 && i.purchasedQty >= i.quantity ? "Да" : "",
      i.name,
      i.quantity,
      units[i.unit],
      packs(i.quantity, i.packageQty),
      i.shortage,
      i.price === undefined
        ? "Неизвестна"
        : ((i.price * i.quantity) / 100).toFixed(2),
      i.note,
    ]);
  return "\ufeff" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}
export function downloadCsv(list: ShoppingState) {
  const url = URL.createObjectURL(
      new Blob([purchaseCsv(list)], { type: "text/csv;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "masterskaya-purchases.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function printPurchases(list: ShoppingState) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px";
  document.body.appendChild(iframe);
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Закупки — Мастерская</title><style>body{font:14px Arial;padding:25px}pre{white-space:pre-wrap;line-height:1.8;font:inherit}h1{font-size:22px}</style></head><body><h1>Что докупить</h1><pre>' +
      escape(purchaseText(list)) +
      "</pre><p>Отметка покупки не означает поступление на склад.</p></body></html>",
  );
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  }, 200);
  setTimeout(() => iframe.remove(), 60000);
}
