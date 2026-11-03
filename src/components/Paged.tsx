import { Children, useState, type ReactNode } from "react";
function usePages(children: ReactNode) {
  const all = Children.toArray(children).filter(
      (child) => typeof child !== "string" || child.trim().length > 0,
    ),
    signature = all.map((x: any) => x.key).join("|");
  const [position, setPosition] = useState({ signature, page: 1 }),
    [size, setSize] = useState(10);
  const pages = Math.max(1, Math.ceil(all.length / size)),
    page =
      position.signature === signature ? Math.min(position.page, pages) : 1;
  const go = (page: number) => setPosition({ signature, page });
  const controls = all.length > 0 && (
    <nav className="pagination" aria-label="Страницы списка">
      <span>Всего: {all.length}</span>
      <label>
        На странице
        <select
          aria-label="На странице"
          value={size}
          onChange={(e) => {
            setSize(Number(e.target.value));
            go(1);
          }}
        >
          {[10, 20, 50].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <button type="button" disabled={page === 1} onClick={() => go(page - 1)}>
        ← Назад
      </button>
      <span aria-live="polite">
        {page} / {pages}
      </span>
      <button
        type="button"
        disabled={page === pages}
        onClick={() => go(page + 1)}
      >
        Далее →
      </button>
    </nav>
  );
  return {
    items: all.slice((page - 1) * size, page * size),
    controls,
    key: page + ":" + size,
  };
}
export function Paged({
  children,
  className,
  scroll = false,
}: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  const { items, controls, key } = usePages(children);
  return (
    <>
      <div
        className={["paged-items", className, scroll ? "paged-scroll" : ""]
          .filter(Boolean)
          .join(" ")}
        key={key}
      >
        {items}
      </div>
      {controls}
    </>
  );
}
/** Pagination remains outside both axes of the table's scroll container. */
export function PagedTable({
  children,
  head,
  className,
}: {
  children: ReactNode;
  head: ReactNode;
  className?: string;
}) {
  const { items, controls, key } = usePages(children);
  return (
    <div className="paged-table">
      <div className="table-wrap" key={key}>
        <table className={className}>
          <thead>{head}</thead>
          <tbody>{items}</tbody>
        </table>
      </div>
      {controls}
    </div>
  );
}
