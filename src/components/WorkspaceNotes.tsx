import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  CheckSquare,
} from "lucide-react";
import { useApp } from "./context";
import { Field, Modal } from "./ui";
import { Paged } from "./Paged";
import { mutate, mutateWithAssets } from "../data/db";
import {
  AttachmentGallery,
  AttachmentDraft,
  useNoteUploads,
} from "./NoteAttachments";
import type { Asset } from "../domain/model";
import { now } from "../domain/model";
import { saveNote, addRunTask, updateCustomer } from "../domain/workflow";
import { emptyCustomer, safeUrl, type Customer } from "../domain/workspace";
export function CustomerFields({
  value,
  onChange,
}: {
  value: Customer;
  onChange: (c: Customer) => void;
}) {
  return (
    <div className="form-grid customer-fields">
      <Field label="Заказчик (необязательно)">
        <input
          maxLength={200}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="Имя или название"
        />
      </Field>
      <Field label="Ссылка на чат" hint="Полная ссылка https://…">
        <input
          value={value.chatUrl}
          onChange={(e) => onChange({ ...value, chatUrl: e.target.value })}
          placeholder="https://t.me/…"
        />
      </Field>
      <Field label="Пожелания к этому запуску">
        <textarea
          value={value.requests}
          onChange={(e) => onChange({ ...value, requests: e.target.value })}
          placeholder="Цвет, упаковка, особенности…"
        />
      </Field>
    </div>
  );
}
export function RunCustomer({ runId }: { runId: string }) {
  const { state, act, busy } = useApp(),
    r = state.runs.find((r) => r.id === runId)!;
  const [edit, setEdit] = useState<{
    customer: Customer;
    revision: number;
  } | null>(null);
  const c = r.customer ?? emptyCustomer(),
    url = safeUrl(c.chatUrl);
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>Заказчик</h2>
          <p>{c.name || "Для себя / заказчик не указан"}</p>
        </div>
        <div className="actions">
          {url && (
            <a
              className="button"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              Открыть чат
            </a>
          )}
          <button
            onClick={() =>
              setEdit({ customer: { ...c }, revision: state.revision })
            }
          >
            <Pencil size={16} />
            Изменить
          </button>
        </div>
      </div>
      {c.requests && <p className="prewrap">{c.requests}</p>}
      {edit && (
        <Modal title="Заказчик и пожелания" onClose={() => setEdit(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  () =>
                    mutate(
                      (s) => updateCustomer(s, runId, edit.customer),
                      edit.revision,
                    ),
                  "Данные заказчика сохранены",
                )
              )
                setEdit(null);
            }}
          >
            <CustomerFields
              value={edit.customer}
              onChange={(customer) => setEdit({ ...edit, customer })}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setEdit(null)}>
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                Сохранить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function NoteFeed({
  target,
  ownerId,
}: {
  target: "project" | "run";
  ownerId: string;
}) {
  const { state, act, confirm, busy } = useApp();
  const [edit, setEdit] = useState<{
    id?: string;
    text: string;
    source: "internal" | "customer_reported";
    revision: number;
    updatedAt?: string;
    attachmentIds: string[];
    files: Asset[];
  } | null>(null);
  const projectId =
    target === "project"
      ? ownerId
      : state.runs.find((r) => r.id === ownerId)!.projectId;
  const uploads = useNoteUploads(
    projectId,
    (files) =>
      setEdit((old) =>
        old
          ? {
              ...old,
              files: [...old.files, ...files],
              attachmentIds: [...old.attachmentIds, ...files.map((a) => a.id)],
            }
          : null,
      ),
    20 - (edit?.attachmentIds.length ?? 0),
  );
  const notes = (
    target === "project"
      ? state.projectNotes.filter((n) => n.projectId === ownerId)
      : state.runNotes.filter((n) => n.runId === ownerId)
  )
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="panel notes-feed">
      <div className="section-head">
        <div>
          <h2>
            {target === "project" ? "Заметки проекта" : "Заметки производства"}
          </h2>
          <p>
            {target === "project"
              ? "Общие решения и наблюдения по изделию."
              : "Только для этого запуска."}
          </p>
        </div>
        <button
          onClick={() =>
            setEdit({
              text: "",
              source: "internal",
              revision: state.revision,
              attachmentIds: [],
              files: [],
            })
          }
        >
          <Plus size={16} />
          Заметка
        </button>
      </div>
      {!notes.length && (
        <p className="muted">
          Запишите важные детали, чтобы вернуться к ним позже.
        </p>
      )}
      <Paged>
        {notes.map((n) => (
          <article className="feed-note" key={n.id}>
            <div className="note-meta">
              <time dateTime={n.createdAt}>
                {new Date(n.createdAt).toLocaleString("ru-RU")}
              </time>
              {n.updatedAt !== n.createdAt && (
                <span>
                  {" "}
                  · изменено {new Date(n.updatedAt).toLocaleString("ru-RU")}
                </span>
              )}
              {"source" in n && n.source === "customer_reported" && (
                <span className="badge blue">Записано со слов заказчика</span>
              )}
            </div>
            <p className="prewrap">{n.text}</p>
            <AttachmentGallery ids={n.attachmentIds ?? []} />
            <div className="actions">
              <button
                onClick={() =>
                  setEdit({
                    id: n.id,
                    text: n.text,
                    attachmentIds: n.attachmentIds ?? [],
                    files: [],
                    updatedAt: n.updatedAt,
                    source: "source" in n ? n.source : "internal",
                    revision: state.revision,
                  })
                }
              >
                <Pencil size={15} />
                Править
              </button>
              {target === "run" && !!n.text.trim() && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        mutate((s) => {
                          addRunTask(s, ownerId, n.text, n.id);
                        }),
                      "Задача добавлена",
                    )
                  }
                >
                  <CheckSquare size={15} />В задачу
                </button>
              )}
              <button
                className="icon ghost danger-text"
                aria-label="Удалить заметку"
                onClick={() =>
                  confirm(
                    "Удалить заметку?",
                    "Удаление не влияет на производство и склад.",
                    () =>
                      mutate((s) => {
                        if (target === "project")
                          s.projectNotes = s.projectNotes.filter(
                            (x) => x.id !== n.id,
                          );
                        else {
                          s.runNotes = s.runNotes.filter((x) => x.id !== n.id);
                          s.runTasks.forEach((t) => {
                            if (t.sourceNoteId === n.id) delete t.sourceNoteId;
                          });
                        }
                      }),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </Paged>
      {edit && (
        <Modal
          title={edit.id ? "Редактировать заметку" : "Новая заметка"}
          onClose={() => setEdit(null)}
        >
          <form
            onPaste={uploads.paste}
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  () =>
                    mutateWithAssets(
                      (s) => {
                        const old =
                          target === "project"
                            ? s.projectNotes.find((n) => n.id === edit.id)
                            : s.runNotes.find((n) => n.id === edit.id);
                        if (edit.id && old?.updatedAt !== edit.updatedAt)
                          throw new Error(
                            "Заметка изменилась в другой вкладке. Откройте её заново.",
                          );
                        saveNote(
                          s,
                          target,
                          ownerId,
                          edit.text,
                          edit.id,
                          edit.source,
                          edit.attachmentIds,
                        );
                      },
                      edit.files.filter((a) =>
                        edit.attachmentIds.includes(a.id),
                      ),
                    ),
                  "Заметка сохранена",
                )
              )
                setEdit(null);
            }}
          >
            <Field label="Текст">
              <textarea
                rows={6}
                value={edit.text}
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              />
            </Field>
            {uploads.error && (
              <p role="alert" className="danger-text">
                {uploads.error}
              </p>
            )}
            <div className="note-upload-bar">
              {uploads.input}
              <span className="muted">
                Или вставьте скриншот сюда через Ctrl / ⌘ + V. JPG, PNG, WebP до
                15 МБ.
              </span>
            </div>
            <AttachmentDraft
              ids={edit.attachmentIds}
              files={edit.files}
              remove={(id) =>
                setEdit({
                  ...edit,
                  attachmentIds: edit.attachmentIds.filter((x) => x !== id),
                  files: edit.files.filter((x) => x.id !== id),
                })
              }
            />
            {target === "run" && (
              <Field label="Источник">
                <select
                  value={edit.source}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      source: e.target.value as typeof edit.source,
                    })
                  }
                >
                  <option value="internal">Моя заметка</option>
                  <option value="customer_reported">
                    Записано со слов заказчика
                  </option>
                </select>
              </Field>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setEdit(null)}>
                Отмена
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  uploads.preparing ||
                  (!edit.text.trim() && !edit.attachmentIds.length)
                }
              >
                Сохранить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function RunTasks({ runId }: { runId: string }) {
  const { state, act, confirm, busy } = useApp();
  const [text, setText] = useState(""),
    [edit, setEdit] = useState<{
      id: string;
      text: string;
      revision: number;
    } | null>(null);
  const tasks = state.runTasks
    .filter((t) => t.runId === runId)
    .slice()
    .sort((a, b) => a.order - b.order);
  const move = (i: number, d: number) =>
    void act(() =>
      mutate((s) => {
        const a = s.runTasks.find((t) => t.id === tasks[i].id)!,
          b = s.runTasks.find((t) => t.id === tasks[i + d].id)!;
        [a.order, b.order] = [b.order, a.order];
        a.updatedAt = b.updatedAt = now();
      }),
    );
  return (
    <section className="panel">
      <div className="section-head">
        <h2>Задачи производства</h2>
        <span className="badge">
          {tasks.filter((t) => t.done).length} из {tasks.length}
        </span>
      </div>
      <form
        className="task-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act(
              () =>
                mutate((s) => {
                  addRunTask(s, runId, text);
                }),
              "Задача добавлена",
            )
          )
            setText("");
        }}
      >
        <input
          aria-label="Новая задача"
          placeholder="Например, проверить швы перед грунтовкой"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button disabled={busy || !text.trim()}>
          <Plus size={16} />
          Добавить
        </button>
      </form>
      <Paged>
        {tasks.map((t, i) => (
          <div className={"task-row " + (t.done ? "done" : "")} key={t.id}>
            <label className="check">
              <input
                type="checkbox"
                checked={t.done}
                disabled={busy}
                onChange={() =>
                  void act(() =>
                    mutate((s) => {
                      const task = s.runTasks.find((x) => x.id === t.id)!;
                      task.done = !task.done;
                      task.updatedAt = now();
                    }),
                  )
                }
              />
              <span>{t.text}</span>
            </label>
            <div className="actions">
              <button
                className="icon ghost"
                aria-label="Задача выше"
                disabled={busy || i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                className="icon ghost"
                aria-label="Задача ниже"
                disabled={busy || i === tasks.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={16} />
              </button>
              <button
                className="icon ghost"
                aria-label="Править задачу"
                onClick={() =>
                  setEdit({ id: t.id, text: t.text, revision: state.revision })
                }
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon ghost danger-text"
                aria-label="Удалить задачу"
                onClick={() =>
                  confirm(
                    "Удалить задачу?",
                    "Этап и остатки не изменятся.",
                    () =>
                      mutate((s) => {
                        s.runTasks = s.runTasks.filter((x) => x.id !== t.id);
                      }),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </Paged>
      {edit && (
        <Modal title="Задача" onClose={() => setEdit(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act(
                  () =>
                    mutate((s) => {
                      const t = s.runTasks.find((t) => t.id === edit.id)!;
                      t.text = edit.text.trim();
                      t.updatedAt = now();
                    }, edit.revision),
                  "Задача сохранена",
                )
              )
                setEdit(null);
            }}
          >
            <Field label="Что сделать">
              <textarea
                required
                value={edit.text}
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              />
            </Field>
            <div className="modal-actions">
              <button className="primary" disabled={busy || !edit.text.trim()}>
                Сохранить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
