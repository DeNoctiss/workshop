import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import { db, replaceAll, mutate, readState, snapshot } from "../src/data/db";
import { fixture } from "./fixture";
import {
  start,
  finish,
  stock,
  setStage,
  startLaunch,
} from "../src/domain/engine";
import { encodeBackup, decodeBackup } from "../src/data/backup";
import { uid, type Asset } from "../src/domain/model";
beforeEach(async () => {
  await db.states.clear();
  await db.assets.clear();
});
describe("хранение и архивы", () => {
  it("полный ZIP восстанавливает историю, резервы и Blob", async () => {
    const { s, p, printer } = fixture();
    start(s, p.id, 1, printer.id);
    const assets: Asset[] = [
      {
        id: uid(),
        projectId: p.id,
        group: "main",
        caption: "Тест",
        order: 0,
        cover: true,
        blob: new Blob(["image"], { type: "image/webp" }),
        thumb: new Blob(["thumb"], { type: "image/webp" }),
      },
    ];
    const restored = decodeBackup(await encodeBackup(s, assets));
    await replaceAll(restored.state, restored.assets);
    const actual = await snapshot();
    expect(actual.state.runs).toHaveLength(1);
    expect(await actual.assets[0].blob.text()).toBe("image");
    expect(stock(actual.state, s.materials[0].id).reserved).toBe(200);
  });
  it("поврежденный ZIP не меняет базу", async () => {
    const { s } = fixture();
    await replaceAll(s, []);
    const before = await readState();
    expect(() => decodeBackup(new Uint8Array([1, 2, 3]))).toThrow();
    expect(await readState()).toEqual(before);
  });
  it("два одновременных запуска не резервируют одни материалы дважды", async () => {
    const { s, p, printer } = fixture();
    await replaceAll(s, []);
    const results = await Promise.allSettled([
      mutate((d) => {
        start(d, p.id, 1, printer.id);
      }),
      mutate((d) => {
        start(d, p.id, 1, printer.id);
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await readState()).runs).toHaveLength(1);
  });
  it("двойное завершение выполняется один раз", async () => {
    const { s, p, m, printer } = fixture();
    const r = start(s, p.id, 1, printer.id);
    await replaceAll(s, []);
    const results = await Promise.allSettled([
      mutate((d) => finish(d, r.id, "completed", { [m.id]: 200 }, "plan")),
      mutate((d) => finish(d, r.id, "completed", { [m.id]: 200 }, "plan")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(stock(await readState(), m.id).physical).toBe(100);
  });
  it("ошибка транзакции откатывает изменения", async () => {
    const { s } = fixture();
    await replaceAll(s, []);
    const before = await readState();
    await expect(
      mutate((d) => {
        d.materials[0].name = "Изменено";
        throw new Error("rollback");
      }),
    ).rejects.toThrow();
    expect(await readState()).toEqual(before);
  });
  it("устаревшая форма не перезаписывает изменения другой вкладки", async () => {
    const { s } = fixture();
    await replaceAll(s, []);
    const rev = (await readState()).revision;
    await mutate((d) => {
      d.materials[0].name = "Новое";
    });
    await expect(
      mutate((d) => {
        d.materials[0].name = "Старое";
      }, rev),
    ).rejects.toThrow("другой вкладке");
  });
  it("данные остаются после переоткрытия базы", async () => {
    const { s } = fixture();
    await replaceAll(s, []);
    db.close();
    await db.open();
    expect((await readState()).projects[0].title).toBe("Фигурка");
  });
  it("невалидная замена не очищает данные", async () => {
    const { s } = fixture();
    await replaceAll(s, []);
    const before = await readState();
    await expect(
      replaceAll({ ...s, schemaVersion: 9 } as any, []),
    ).rejects.toThrow();
    expect(await readState()).toEqual(before);
  });
});

it("этап сохраняется в IndexedDB и после повторного чтения", async () => {
  const { s, p, printer } = fixture();
  const run = start(s, p.id, 1, printer.id);
  await replaceAll(s, []);
  await mutate((d) => setStage(d, run.id, "printing"));
  expect((await readState()).runs[0].stage).toBe("printing");
  await mutate((d) => setStage(d, run.id, "painting"));
  expect((await readState()).runs[0].stage).toBe("painting");
});
it("неудачная серия запусков не меняет сохранённую базу", async () => {
  const { s, p, printer } = fixture();
  await replaceAll(s, []);
  const before = await readState();
  await expect(
    mutate((d) => startLaunch(d, p.id, 3, printer.id, "separate")),
  ).rejects.toThrow();
  expect(await readState()).toEqual(before);
});
it("настройка видимости цвета совместима со старой базой и ZIP", async () => {
  const { s, m } = fixture();
  await replaceAll(s, []);
  expect((await readState()).materials[0].colorEnabled).toBeUndefined();
  await mutate((d) => {
    d.materials[0].colorEnabled = false;
  });
  const exported = decodeBackup(await encodeBackup(await readState(), []));
  await replaceAll(exported.state, exported.assets);
  expect((await readState()).materials[0].colorEnabled).toBe(false);
  expect((await readState()).materials[0].color).toBe(m.color);
});
