import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import { PaintSession, blendLabels } from "./core/PaintSession";
import { hasSelection } from "./core/selection";
import type { PaintBlend, MaterialReference } from "../domain/workspace";
export function ToolButton({
  label,
  children,
  selected,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  selected?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="pe-tool"
      aria-label={label}
      aria-pressed={selected}
      data-tip={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function PaintRange({
  label,
  value,
  min = 0,
  max,
  step = 1,
  onChange,
  onCommit = () => {},
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="pe-range">
      <span>{label}</span>
      <span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          onBlur={onCommit}
        />
        <input
          aria-label={label + " — значение"}
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (
              e.target.value.trim() &&
              Number.isFinite(n) &&
              n >= min &&
              n <= max
            )
              onChange(n);
          }}
          onBlur={() => {
            setText(String(value));
            onCommit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
              e.preventDefault();
            }
          }}
        />
      </span>
    </label>
  );
}
export function PaintPanels({
  session,
  material,
  color,
  onColor,
  onColorPreview,
  onCatalog,
  action,
  refresh,
  busy,
}: {
  session: PaintSession;
  material?: MaterialReference;
  color: string;
  onColor: (v: string) => void;
  onColorPreview: (v: string) => void;
  onCatalog: () => void;
  action: (fn: () => void) => void;
  refresh: () => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState<"layers" | "colors">("layers"),
    [hex, setHex] = useState(color);
  useEffect(() => setHex(color), [color]);
  const f = session.frame,
    active = session.active,
    locked = !!f.editing || busy;
  const shift = (step: number) => {
    const i = f.layers.findIndex((l) => l.id === f.active),
      j = i + step;
    if (j < 0 || j >= f.layers.length) return;
    const layers = f.layers.slice();
    [layers[i], layers[j]] = [layers[j], layers[i]];
    session.change({ ...f, layers });
  };
  return (
    <aside className="pe-side">
      <div className="segmented">
        <button
          aria-pressed={tab === "layers"}
          onClick={() => setTab("layers")}
        >
          Слои <span>{f.layers.length}</span>
        </button>
        <button
          aria-pressed={tab === "colors"}
          onClick={() => setTab("colors")}
        >
          Цвета
        </button>
      </div>
      {tab === "layers" ? (
        <>
          <div className="pe-layer-list">
            {f.layers.length === 0 && (
              <p className="muted">
                Выделите деталь и создайте слой. Исходник всегда остаётся целым.
              </p>
            )}
            {[...f.layers].reverse().map((l) => (
              <div
                key={l.id}
                className={"pe-layer " + (l.id === f.active ? "active" : "")}
              >
                <ToolButton
                  label={l.visible ? "Скрыть " + l.name : "Показать " + l.name}
                  disabled={locked}
                  onClick={() =>
                    action(() => session.patch(l.id, { visible: !l.visible }))
                  }
                >
                  {l.visible ? <Eye size={17} /> : <EyeOff size={17} />}
                </ToolButton>
                <button
                  className="pe-layer-select"
                  disabled={locked}
                  aria-pressed={l.id === f.active}
                  onClick={() =>
                    action(() => {
                      session.frame = { ...session.frame, active: l.id };
                    })
                  }
                >
                  <span
                    className="pe-color-chip"
                    style={{ background: l.color }}
                  />
                  <span>
                    {l.name}
                    <small>
                      {blendLabels[l.blend].label} ·{" "}
                      {Math.round(l.opacity * 100)}%
                    </small>
                  </span>
                </button>
              </div>
            ))}
          </div>
          <button
            disabled={
              locked || !hasSelection(f.selection) || f.layers.length >= 12
            }
            onClick={() => action(() => session.addLayer(color, material))}
          >
            <Plus size={16} /> Слой из выделения
          </button>
          <button
            disabled={locked || f.layers.length >= 12}
            onClick={() =>
              action(() => session.addLayer(color, material, true))
            }
          >
            Пустой слой для кисти
          </button>
          {active && (
            <div className="pe-properties">
              <label>
                Название слоя
                <input
                  key={active.id + ":" + active.name}
                  defaultValue={active.name}
                  disabled={busy}
                  onBlur={(e) => {
                    const name = e.target.value.trim() || "Область";
                    if (name !== active.name)
                      action(() => session.patch(active.id, { name }));
                  }}
                />
              </label>
              <PaintRange
                label="Непрозрачность слоя"
                value={Math.round(active.opacity * 100)}
                max={100}
                onChange={(v) => {
                  if (!locked) {
                    session.patch(active.id, { opacity: v / 100 }, true);
                    refresh();
                  }
                }}
                onCommit={() => {
                  session.commit();
                  refresh();
                }}
              />
              <label>
                Режим наложения
                <select
                  value={active.blend}
                  disabled={locked}
                  onChange={(e) =>
                    action(() =>
                      session.patch(active.id, {
                        blend: e.target.value as PaintBlend,
                      }),
                    )
                  }
                >
                  {Object.entries(blendLabels).map(([v, b]) => (
                    <option key={v} value={v}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="pe-hint">{blendLabels[active.blend].hint}</p>
              {f.editing ? (
                <div className="pe-buttons">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => action(() => session.applyArea())}
                  >
                    Применить область
                  </button>
                  <button onClick={() => action(() => session.cancelArea())}>
                    Отмена области
                  </button>
                </div>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => action(() => session.editArea())}
                >
                  Редактировать область
                </button>
              )}
              <div className="pe-buttons">
                <ToolButton
                  label="Дублировать слой"
                  disabled={locked}
                  onClick={() => action(() => session.duplicate())}
                >
                  <Copy size={17} />
                </ToolButton>
                <ToolButton
                  label="Слой выше"
                  disabled={locked || f.layers.at(-1)?.id === active.id}
                  onClick={() => action(() => shift(1))}
                >
                  <ArrowUp size={17} />
                </ToolButton>
                <ToolButton
                  label="Слой ниже"
                  disabled={locked || f.layers[0]?.id === active.id}
                  onClick={() => action(() => shift(-1))}
                >
                  <ArrowDown size={17} />
                </ToolButton>
                <ToolButton
                  label="Удалить слой"
                  disabled={locked}
                  onClick={() =>
                    action(() => {
                      const layers = f.layers.filter((l) => l.id !== active.id);
                      session.change({
                        ...f,
                        layers,
                        active: layers.at(-1)?.id ?? "",
                      });
                    })
                  }
                >
                  <Trash2 size={17} />
                </ToolButton>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="pe-properties">
          <p>{active ? "Цвет выбранного слоя" : "Цвет следующего слоя"}</p>
          <div className="pe-color-input">
            <input
              aria-label="Выбрать цвет"
              type="color"
              value={color}
              disabled={locked}
              onChange={(e) => onColorPreview(e.target.value)}
              onBlur={() => {
                session.commit();
                refresh();
              }}
              onPointerUp={() => {
                session.commit();
                refresh();
              }}
            />
            <input
              aria-label="HEX цвета"
              value={hex}
              disabled={locked}
              onChange={(e) => setHex(e.target.value)}
              onBlur={() => {
                if (hex !== color) onColor(hex);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
            />
          </div>
          <button disabled={locked} onClick={onCatalog}>
            Выбрать краску из каталога
          </button>
          {active?.material && (
            <p className="pe-hint">{active.material.snapshot.label}</p>
          )}
          <p className="pe-hint">
            Изменение цвета не расходует материал со склада. Для сохранения
            теней попробуйте режим «Цвет» на вкладке «Слои».
          </p>
          <div className="pe-palette">
            {[
              "#e5a276",
              "#c75b42",
              "#d7b690",
              "#383840",
              "#34576b",
              "#63846c",
              "#f0e6d2",
              "#875a47",
            ].map((c) => (
              <button
                key={c}
                aria-label={"Цвет " + c}
                disabled={locked}
                style={{ background: c }}
                onClick={() => onColor(c)}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
