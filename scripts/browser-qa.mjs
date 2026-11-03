import { advancedPaint } from "./paint-qa-advanced.mjs";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.QA_PLAYWRIGHT || "playwright");
const out = process.env.QA_OUTPUT || "test-results";
await mkdir(out, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 5181, strictPort: true },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.QA_CHROMIUM
    ? { executablePath: process.env.QA_CHROMIUM }
    : {}),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-zygote",
    "--single-process",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: Number(process.env.QA_DPR || 1),
});
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const log = (msg) => console.log(new Date().toISOString(), msg);
try {
  await page.goto("http://127.0.0.1:5181/");
  await page.getByRole("heading", { name: "Проекты", exact: true }).waitFor();
  const projectId = await page.evaluate(async () => {
    const { demoState } = await import("/src/data/demo.ts"),
      { replaceAll } = await import("/src/data/db.ts");
    const s = demoState(),
      p = s.projects[0];
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 720;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e9e7e1";
    ctx.fillRect(0, 0, 600, 720);
    ctx.fillStyle = "#66615d";
    ctx.fillRect(180, 310, 240, 230);
    ctx.fillStyle = "#d0b9a0";
    ctx.beginPath();
    ctx.ellipse(300, 220, 110, 128, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#393633";
    ctx.fillRect(188, 100, 224, 65);
    ctx.fillStyle = "#302f30";
    ctx.fillRect(190, 540, 90, 130);
    ctx.fillRect(320, 540, 90, 130);
    for (const x of [260, 340]) {
      ctx.beginPath();
      ctx.arc(x, 222, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    const blob = await new Promise((resolve) => c.toBlob(resolve));
    s.materials[0].minimum = 100000;
    await replaceAll(s, [
      {
        id: crypto.randomUUID(),
        projectId: p.id,
        group: "main",
        caption: "Контрольное изображение",
        order: 0,
        cover: true,
        blob,
        thumb: blob,
      },
    ]);
    return p.id;
  });
  await page.goto("http://127.0.0.1:5181/#/board/" + projectId);
  await page.getByRole("button", { name: "Перекраска", exact: true }).click();
  await page
    .getByRole("button", { name: "Контрольное изображение", exact: true })
    .click();
  const canvas = page.getByLabel("Изображение для выделения и перекраски");
  await canvas.waitFor();
  await page.waitForTimeout(250);
  log("editor opened");
  const clickPixel = async (x, y) => {
    const b = await canvas.boundingBox();
    await page.mouse.click(
      b.x + (x / 600) * b.width,
      b.y + (y / 720) * b.height,
    );
  };
  const pixel = async () => {
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    return canvas.evaluate((c) => [
      ...c.getContext("2d").getImageData(300, 400, 1, 1).data,
    ]);
  };
  const idle = async () => {
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".pe-selection-bar")
          ?.textContent.includes("Вычисляем"),
    );
  };
  await clickPixel(300, 400);
  await idle();
  assert.deepEqual(await pixel(), [102, 97, 93, 255]);
  await page
    .getByRole("button", { name: "Слой из выделения", exact: true })
    .first()
    .click();
  assert.deepEqual(await pixel(), [212, 154, 118, 255]);
  log("selection then explicit paint");
  const opacity = page.getByRole("slider", {
    name: "Непрозрачность слоя",
    exact: true,
  });
  await opacity.focus();
  await opacity.press("Home");
  assert.deepEqual(await pixel(), [102, 97, 93, 255]);
  await opacity.press("End");
  assert.deepEqual(await pixel(), [212, 154, 118, 255]);
  await page.getByRole("button", { name: "Цвета", exact: true }).click();
  await page.getByLabel("HEX цвета", { exact: true }).fill("#e5a276");
  await page.getByLabel("HEX цвета", { exact: true }).press("Enter");
  assert.deepEqual(await pixel(), [229, 162, 118, 255]);
  log("opacity zero and HEX");
  await page.getByRole("button", { name: /^Слои/ }).click();
  await page
    .getByRole("button", { name: "Редактировать область", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Убрать из выделения", exact: true })
    .click();
  await clickPixel(300, 400);
  assert.deepEqual(await pixel(), [229, 162, 118, 255]);
  await page
    .getByRole("button", { name: "Отмена области", exact: true })
    .first()
    .click();
  assert.deepEqual(await pixel(), [229, 162, 118, 255]);
  await page
    .getByRole("button", { name: "Полигональное лассо · Shift L", exact: true })
    .click();
  await page.getByRole("button", { name: "Новое", exact: true }).click();
  await clickPixel(60, 380);
  await clickPixel(130, 380);
  await clickPixel(130, 480);
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Слой из выделения", exact: true })
    .first()
    .click();
  assert.equal(await page.locator(".pe-layer").count(), 2);
  await canvas.click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  assert.equal(await page.locator(".pe-layer").count(), 1);
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await page.locator(".pe-layer").count(), 2);
  log("edit cancel and polygon history");
  await page
    .getByRole("button", { name: "Вписать изображение", exact: true })
    .click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "/paint-light.png" });
  const bounds = await page.evaluate(() => {
    const d = document.querySelector("dialog:has(.pe-v2)"),
      s = document.querySelector(".pe-stage");
    return {
      width: d.clientWidth,
      scroll: d.scrollWidth,
      stage: s.clientHeight,
      canvas: document
        .querySelector(".pe-image")
        .getBoundingClientRect()
        .toJSON(),
    };
  });
  assert.ok(bounds.scroll <= bounds.width + 1, JSON.stringify(bounds));
  assert.ok(bounds.stage >= 170, JSON.stringify(bounds));
  log(JSON.stringify(bounds));
  await page.waitForFunction(
    () =>
      document.querySelector(".pe-save-status")?.textContent === "Сохранено",
  );
  const saved = await page.evaluate(async () => {
    const { readState } = await import("/src/data/db.ts");
    const s = await readState();
    return s.boards.flatMap((b) => b.nodes).find((n) => n.data.kind === "paint")
      ?.data.document;
  });
  assert.equal(saved.layers.length, 2);
  assert.equal(saved.schemaVersion, 2);
  log("autosave in database");
  const backupCheck = await page.evaluate(async () => {
    const { snapshot } = await import("/src/data/db.ts");
    const { encodeBackup, decodeBackup } = await import("/src/data/backup.ts");
    const data = await snapshot(),
      restored = decodeBackup(await encodeBackup(data.state, data.assets));
    const doc = restored.state.boards
      .flatMap((b) => b.nodes)
      .find((n) => n.data.kind === "paint").data.document;
    return {
      schema: doc.schemaVersion,
      maskCount: doc.layers.filter((l) =>
        restored.assets.some((a) => a.id === l.maskAssetId),
      ).length,
    };
  });
  assert.deepEqual(backupCheck, { schema: 2, maskCount: 2 });
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.locator(".pe-v2").waitFor({ state: "detached" });
  await page.reload();
  await page
    .getByRole("button", { name: "Редактировать окраску", exact: true })
    .click();
  await canvas.waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".pe-layer").length === 2,
  );
  log("reopened document");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + "/paint-dark-1280.png" });
  const composite = await page.evaluate(async () => {
    const { canvas, paintComposite } = await import("/src/paint/canvas.ts");
    const b = canvas(3, 1),
      ctx = b.getContext("2d"),
      im = ctx.createImageData(3, 1);
    im.data.set([80, 90, 100, 255, 100, 120, 140, 128, 0, 0, 0, 0]);
    ctx.putImageData(im, 0, 0);
    const original = [...ctx.getImageData(0, 0, 3, 1).data],
      checks = [];
    const layer = {
      id: "x",
      name: "x",
      mask: new Uint8Array(3).fill(255),
      color: "#e5a276",
      opacity: 1,
      visible: true,
      blend: "source-over",
    };
    for (const blend of ["source-over", "color", "multiply", "soft-light"]) {
      const target = canvas(3, 1);
      for (let i = 0; i < 3; i++) {
        paintComposite(b, [{ ...layer, blend, opacity: 1 }], target);
        paintComposite(b, [{ ...layer, blend, opacity: 0 }], target);
      }
      checks.push({
        blend,
        result: [...target.getContext("2d").getImageData(0, 0, 3, 1).data],
      });
    }
    return {
      original,
      after: [...ctx.getImageData(0, 0, 3, 1).data],
      normal: [
        ...paintComposite(b, [layer]).getContext("2d").getImageData(0, 0, 3, 1)
          .data,
      ],
      checks,
    };
  });
  assert.deepEqual(composite.original, composite.after);
  for (const c of composite.checks)
    assert.deepEqual(c.result, composite.original, c.blend);
  assert.deepEqual(composite.normal.slice(0, 4), [229, 162, 118, 255]);
  assert.equal(composite.normal[7], 128);
  assert.equal(composite.normal[11], 0);
  log("browser compositing checks");
  const benchmark = await advancedPaint({
    page,
    canvas,
    clickPixel,
    idle,
    log,
    out,
  });
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.goto("http://127.0.0.1:5181/#/shopping");
  await page
    .getByRole("button", { name: "Сформировать список", exact: true })
    .click();
  await page.locator(".purchase-item").first().waitFor();
  await page.screenshot({ path: out + "/shopping-list.png" });
  const before = await page.evaluate(async () => {
    const { readState } = await import("/src/data/db.ts");
    return (await readState()).movements.length;
  });
  await page
    .getByRole("checkbox", { name: /Куплено:/ })
    .first()
    .click();
  await page.waitForFunction(
    () => document.querySelector('input[aria-label^="Куплено:"]')?.checked,
  );
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(async () => {
      const { readState } = await import("/src/data/db.ts");
      return (await readState()).movements.length;
    }),
    before,
  );
  await page
    .getByRole("button", { name: "Оприходовать", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Подтвердить приход", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Оприходовать покупку" })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(async () => {
      const { readState } = await import("/src/data/db.ts");
      return (await readState()).movements.length;
    }),
    before + 1,
  );
  await page.screenshot({ path: out + "/shopping.png" });
  log("shopping checkbox and receipt");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      browser: browser.version(),
      benchmark,
      dpr: Number(process.env.QA_DPR || 1),
      bounds,
      errors,
    }),
  );
} catch (e) {
  console.error(e);
  console.error((await page.locator("body").innerText()).slice(-12000));
  await page.screenshot({ path: out + "/failure.png", fullPage: true });
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
