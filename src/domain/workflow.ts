import { now, uid, type State } from "./model";
import { safeUrl, type Customer, type RunNote } from "./workspace";
export function updateCustomer(s: State, runId: string, c: Customer) {
  if (c.chatUrl.trim() && !safeUrl(c.chatUrl))
    throw new Error("Укажите полную ссылку http:// или https://");
  const r = s.runs.find((r) => r.id === runId);
  if (!r) throw new Error("Производство не найдено");
  r.customer = {
    name: c.name.trim(),
    chatUrl: c.chatUrl.trim(),
    requests: c.requests.trim(),
  };
}
export function saveNote(
  s: State,
  target: "project" | "run",
  ownerId: string,
  text: string,
  id?: string,
  source: RunNote["source"] = "internal",
  attachmentIds?: string[],
) {
  if (!text.trim() && !attachmentIds?.length)
    throw new Error("Заметка не может быть пустой");
  const old =
    target === "project"
      ? s.projectNotes.find((n) => n.id === id && n.projectId === ownerId)
      : s.runNotes.find((n) => n.id === id && n.runId === ownerId);
  if (id && !old) throw new Error("Заметка уже удалена. Обновите список.");
  if (old) {
    old.text = text.trim();
    if (attachmentIds) old.attachmentIds = [...attachmentIds];
    old.updatedAt = now();
    if ("source" in old) old.source = source;
    return;
  }
  const n = {
    id: uid(),
    ...(attachmentIds ? { attachmentIds: [...attachmentIds] } : {}),
    text: text.trim(),
    createdAt: now(),
    updatedAt: now(),
  };
  if (target === "project") s.projectNotes.push({ ...n, projectId: ownerId });
  else s.runNotes.push({ ...n, runId: ownerId, source });
}
export function addRunTask(
  s: State,
  runId: string,
  text: string,
  sourceNoteId?: string,
) {
  if (!text.trim()) throw new Error("Введите задачу");
  const task = {
    id: uid(),
    runId,
    text: text.trim(),
    done: false,
    order:
      Math.max(
        -1,
        ...s.runTasks.filter((t) => t.runId === runId).map((t) => t.order),
      ) + 1,
    createdAt: now(),
    updatedAt: now(),
    ...(sourceNoteId ? { sourceNoteId } : {}),
  };
  s.runTasks.push(task);
  return task;
}
