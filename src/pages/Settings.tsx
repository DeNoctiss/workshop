import { useState, useEffect } from "react";
import { Download, Upload, ShieldCheck } from "lucide-react";
import { useApp } from "../components/context";
import { Header, Field, Num, date } from "../components/ui";
import { emptyState, type Settings as SettingsType } from "../domain/model";
import { mutate, replaceAll, snapshot } from "../data/db";
import { encodeBackup, decodeBackup, download } from "../data/backup";
export async function exportBackup() {
  const { state, assets } = await snapshot();
  download(
    await encodeBackup(state, assets),
    "masterskaya-" + new Date().toISOString().slice(0, 10) + ".zip",
  );
  await mutate((s) => {
    s.settings.backupAt = new Date().toISOString();
    s.settings.backupRevision = state.settings.changes;
  });
}
export function Settings() {
  const { state, act, confirm } = useApp();
  const [size, setSize] = useState(""),
    [storage, setStorage] = useState("");
  useEffect(() => {
    navigator.storage
      ?.estimate()
      .then((v) =>
        setSize(
          `${((v.usage || 0) / 1048576).toFixed(1)} МБ из ~${((v.quota || 0) / 1048576).toFixed(0)} МБ`,
        ),
      );
  }, []);
  const patch = (value: Partial<SettingsType>) =>
    void act(() => mutate((s) => Object.assign(s.settings, value)));
  return (
    <>
      <Header
        title="Настройки"
        description="Хранение, резервные копии и мягкие напоминания."
      />
      <div className="settings-grid">
        <section className="panel">
          <h2>Резервная копия</h2>
          <p>
            ZIP содержит проекты, материалы, принтеры, историю, резервы и все
            фотографии, доски, личный каталог, заметки и задачи.
          </p>
          <div className="actions">
            <button
              className="primary"
              onClick={() =>
                void act(
                  exportBackup,
                  "Резервная копия подготовлена к скачиванию",
                )
              }
            >
              <Download size={17} />
              Скачать ZIP
            </button>
            <label className="button">
              <Upload size={17} />
              Восстановить ZIP
              <input
                className="file-input"
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void act(async () => {
                      const data = decodeBackup(
                        new Uint8Array(await file.arrayBuffer()),
                      );
                      confirm(
                        "Заменить текущую базу?",
                        `В копии: ${data.state.projects.length} проектов, ${data.state.materials.length} материалов и ${data.assets.length} фото, ${data.state.boards.length} досок, ${data.state.projectNotes.length + data.state.runNotes.length} заметок и ${data.state.runTasks.length} задач. Текущие данные будут заменены целиком. Сначала сохраните свою ZIP-копию.`,
                        () => replaceAll(data.state, data.assets),
                      );
                    });
                }}
              />
            </label>
          </div>
          <p className="muted">
            Последняя выгрузка: {date(state.settings.backupAt)}. Импорт до 150
            МБ ZIP / 300 МБ распакованных данных. Объединение баз не
            поддерживается.
          </p>
        </section>
        <section className="panel">
          <h2>Локальное хранилище</h2>
          <p>
            Данные остаются в этом браузере. Очистка данных сайта удаляет
            локальную базу. Для другого устройства или домена перенесите ZIP.
          </p>
          <strong>{size || "Размер недоступен"}</strong>
          <div className="actions">
            <button
              onClick={() =>
                void act(async () => {
                  const ok = await navigator.storage?.persist?.();
                  setStorage(
                    ok
                      ? "Браузер предоставил устойчивое хранение."
                      : "Браузер не предоставил устойчивое хранение. Продолжайте делать ZIP-копии.",
                  );
                })
              }
            >
              <ShieldCheck size={17} />
              Запросить устойчивое хранение
            </button>
          </div>
          <p>{storage}</p>
        </section>
        <section className="panel">
          <h2>Напоминания о сверке</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={state.settings.inventoryEnabled}
              onChange={(e) => patch({ inventoryEnabled: e.target.checked })}
            />
            Напоминать об инвентаризации
          </label>
          <SettingNumber
            label="Каждые N дней"
            value={state.settings.inventoryDays}
            save={(v) => patch({ inventoryDays: v })}
          />
          <SettingNumber
            label="Или после N завершённых запусков"
            value={state.settings.inventoryRuns}
            save={(v) => patch({ inventoryRuns: v })}
          />
          <p className="muted">
            Что наступит раньше. Напоминание появляется внутри приложения; при
            закрытом сайте уведомлений нет. Откройте колокольчик в шапке.
          </p>
          <button
            onClick={() =>
              patch({
                snoozeUntil: new Date(Date.now() + 3 * 86400000).toISOString(),
              })
            }
          >
            Отложить сверку на 3 дня
          </button>
        </section>
        <section className="panel">
          <h2>Напоминания о копии</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={state.settings.backupEnabled}
              onChange={(e) => patch({ backupEnabled: e.target.checked })}
            />
            Напоминать о резервном копировании
          </label>
          <SettingNumber
            label="Каждые N дней"
            value={state.settings.backupDays}
            save={(v) => patch({ backupDays: v })}
          />
          <SettingNumber
            label="Или после N изменений"
            value={state.settings.backupChanges}
            save={(v) => patch({ backupChanges: v })}
          />
        </section>
        <section className="panel">
          <h2>Оформление и единицы</h2>
          <Field label="Тема">
            <select
              value={state.settings.theme}
              onChange={(e) =>
                patch({ theme: e.target.value as "light" | "dark" })
              }
            >
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </Field>
          <p>
            Валюта: рубли. Единица выбирается у каждого материала.
            Автоматического перевода граммов в миллилитры нет.
          </p>
        </section>
        <section className="panel danger-panel">
          <h2>Очистка мастерской</h2>
          <p>
            Удалит все локальные записи и фото. Восстановление возможно из вашей
            ZIP-копии.
          </p>
          <button
            className="danger-text"
            onClick={() =>
              confirm(
                "Очистить всю мастерскую?",
                "Операция удалит проекты, склад, запуски и фотографии этого приложения. Убедитесь, что скачали ZIP.",
                () => replaceAll(emptyState(), []),
              )
            }
          >
            Очистить локальную базу
          </button>
        </section>
      </div>
    </>
  );
}
function SettingNumber({
  label,
  value,
  save,
}: {
  label: string;
  value: number;
  save: (v: number) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="setting-number">
      <Field label={label}>
        <Num value={v} min={1} step={1} onChange={setV} />
      </Field>
      <button
        disabled={!Number.isInteger(v) || v < 1 || v === value}
        onClick={() => save(v)}
      >
        Сохранить
      </button>
    </div>
  );
}
