import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { useApp } from "./context";
import { notifications } from "../domain/notifications";
const storageKey = "masterskaya-notifications-read-v1";
function loadRead(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value)
      ? value.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
export function Notifications() {
  const { state } = useApp();
  const [open, setOpen] = useState(false),
    [read, setRead] = useState(loadRead);
  const root = useRef<HTMLDivElement>(null);
  const items = notifications(state),
    unread = items.filter((x) => !read.includes(x.id)).length;
  function mark(ids: string[]) {
    const next = [...new Set([...read, ...ids])].slice(-1000);
    setRead(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Session-only when storage is unavailable. */
    }
  }
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const sync = () => setRead(loadRead());
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("storage", sync);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return (
    <div className="notifications" ref={root}>
      <button
        className="icon bell"
        aria-label={"Уведомления, непрочитанных: " + unread}
        aria-expanded={open}
        aria-controls="notification-list"
        onClick={() => setOpen(!open)}
      >
        <Bell size={21} />
        {unread > 0 && (
          <span className="notification-count">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          id="notification-list"
          className="notification-popover"
          aria-label="Уведомления"
        >
          <div className="section-head">
            <h2>Уведомления</h2>
            <button
              className="icon"
              aria-label="Закрыть уведомления"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          {!!unread && (
            <button
              className="read-all"
              onClick={() => mark(items.map((x) => x.id))}
            >
              Отметить всё прочитанным
            </button>
          )}
          {!items.length && (
            <p className="muted">Всё в порядке. Новых предупреждений нет.</p>
          )}
          <div className="notification-items">
            {items.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={
                  "notification-item " +
                  item.tone +
                  (read.includes(item.id) ? " read" : "")
                }
                onClick={() => {
                  mark([item.id]);
                  setOpen(false);
                }}
              >
                <strong>
                  {!read.includes(item.id) && <span className="unread-dot" />}
                  {item.title}
                </strong>
                <small>{item.detail}</small>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
