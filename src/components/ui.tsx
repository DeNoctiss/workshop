import { db } from "../data/db";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, PackageOpen, ArrowLeft } from "lucide-react";
import type { AssetMeta, Cost } from "../domain/model";
export const money = (v: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(v / 100);
export const qty = (v: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(v);
export const date = (v: string) => new Date(v).toLocaleDateString("ru-RU");
export function Header({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <div className="eyebrow">ПРОИЗВОДСТВЕННЫЙ БЛОКНОТ</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="actions">{children}</div>
    </header>
  );
}
export function Field({
  label,
  children,
  hint,
  help,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  help?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {help && (
          <span
            className="help-tooltip"
            role="img"
            aria-label={help}
            tabIndex={0}
            data-tooltip={help}
          >
            ⓘ
          </span>
        )}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Num({
  value,
  onChange,
  min = 0,
  step = "any",
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number | "any";
  label?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(
    () => setText(Number.isFinite(value) ? String(value) : ""),
    [value],
  );
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      step={step}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value === "" ? NaN : Number(e.target.value));
      }}
      onBlur={() => {
        if (text === "") {
          setText(String(min));
          onChange(min);
        }
      }}
    />
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon ghost"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <PackageOpen size={38} />
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function Back() {
  return (
    <a className="back" href="#/projects">
      <ArrowLeft size={16} />
      Все проекты
    </a>
  );
}
export function Photo({
  asset,
  full = false,
  onClick,
}: {
  asset: AssetMeta;
  full?: boolean;
  onClick?: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true,
      url = "";
    void db.assets
      .get(asset.id)
      .then((a) => {
        if (!a || !alive) return;
        url = URL.createObjectURL(full ? a.blob : a.thumb);
        setUrl(url);
      })
      .catch(() => {
        if (alive) setUrl("");
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset.id, full]);
  return url ? (
    <img loading="lazy" src={url} alt={asset.caption} onClick={onClick} />
  ) : (
    <span className="muted">Загрузка фото…</span>
  );
}
const costNames: Record<keyof Cost, string> = {
  materials: "Материалы",
  electricity: "Электроэнергия",
  depreciation: "Амортизация",
  maintenance: "Обслуживание",
  labor: "Работа",
  extra: "Прочие расходы",
  total: "Всего",
};
export function Costs({ cost }: { cost: Cost }) {
  return (
    <dl className="costs">
      {Object.entries(costNames).map(([k, title]) => (
        <div key={k} className={k === "total" ? "total" : ""}>
          <dt>{title}</dt>
          <dd>{money(cost[k as keyof Cost])}</dd>
        </div>
      ))}
    </dl>
  );
}
