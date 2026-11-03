import assert from "node:assert/strict";
export async function advancedPaint({
  page,
  canvas,
  clickPixel,
  idle,
  log,
  out,
}) {
  const button = (name) => page.getByRole("button", { name, exact: true });
  const alpha = async (x, y) => {
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    return page
      .locator(".pe-overlay")
      .evaluate(
        (c, { x, y }) => c.getContext("2d").getImageData(x, y, 1, 1).data[3],
        { x, y },
      );
  };
  const numeric = async (label, value) => {
    const input = page.getByLabel(label + " — значение", { exact: true });
    await input.fill(String(value));
    await input.press("Tab");
  };
  const clear = async () => {
    await page.locator(".pe-v2").focus();
    await page.keyboard.press("Control+d");
  };
  await page
    .getByLabel("Подсветка выделения", { exact: true })
    .selectOption("mask");
  await button("Свободное лассо · L").click();
  await button("Новое").click();
  const picture = await canvas.boundingBox();
  const screen = (x, y) => ({
    x: picture.x + (x / 600) * picture.width,
    y: picture.y + (y / 720) * picture.height,
  });
  let p = screen(60, 380);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (const [x, y] of [
    [140, 380],
    [140, 480],
    [60, 480],
  ]) {
    p = screen(x, y);
    await page.mouse.move(p.x, p.y, { steps: 5 });
  }
  await page.mouse.up();
  assert.ok((await alpha(100, 420)) > 0);
  assert.equal(await alpha(300, 400), 0);
  await clear();
  await page
    .locator(".pe-v2")
    .dispatchEvent("keydown", { key: "ц", code: "KeyW", bubbles: true });
  assert.equal(
    await button("Волшебная палочка · W").getAttribute("aria-pressed"),
    "true",
  );
  log("freehand lasso and Russian keyboard layout");
  await button("Волшебная палочка · W").click();
  await button("Новое").click();
  await clickPixel(300, 400);
  await idle();
  assert.ok((await alpha(300, 400)) > 0);
  assert.equal(await alpha(50, 50), 0);
  await numeric("Допуск ΔE", 100);
  await idle();
  assert.ok((await alpha(50, 50)) > 0);
  await numeric("Допуск ΔE", 0);
  await idle();
  assert.equal(await alpha(50, 50), 0);
  assert.ok((await alpha(300, 400)) > 0);
  await numeric("Допуск ΔE", 90);
  await numeric("Допуск ΔE", 0);
  await idle();
  assert.equal(await alpha(50, 50), 0);
  await clear();
  log("wand recalculation and latest result");
  await button("Редактировать область").click();
  await page.locator(".pe-selection-menu summary").click();
  await button("Обработать край…").click();
  await numeric("Растушёвка, px", 8);
  await idle();
  assert.ok((await alpha(179, 400)) > 0);
  await numeric("Растушёвка, px", 0);
  await idle();
  assert.equal(await alpha(179, 400), 0);
  await button("Отмена края").click();
  await button("Отмена области").first().click();
  await button("Редактировать область").click();
  await button("Добавить в выделение").click();
  await button("Пересечь").click();
  await clickPixel(300, 400);
  assert.ok((await alpha(300, 400)) > 0);
  assert.equal(await alpha(220, 400), 0);
  await button("Отмена области").first().click();
  log("feather reversibility and brush intersection");
  await button("Убрать из выделения").click();
  await button("Редактировать область").click();
  await clickPixel(300, 400);
  await button("Применить область").first().click();
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.deepEqual(
    await canvas.evaluate((c) => [
      ...c.getContext("2d").getImageData(300, 400, 1, 1).data,
    ]),
    [102, 97, 93, 255],
  );
  await page.locator(".pe-v2").focus();
  await page.keyboard.press("Control+z");
  await button("Отмена области").first().click();
  await button("Масштаб 100%").click();
  await page.waitForTimeout(100);
  await button("Волшебная палочка · W").click();
  await button("Новое").click();
  await clickPixel(300, 400);
  await idle();
  assert.ok((await alpha(300, 400)) > 0);
  assert.equal(await alpha(50, 50), 0);
  await clear();
  const rect = await canvas.boundingBox(),
    anchor = { x: rect.x + 300, y: rect.y + 400 };
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -138.629436);
  await page.keyboard.up("Control");
  await page.waitForTimeout(100);
  const after = await canvas.boundingBox();
  const deviation = {
    x: ((anchor.x - after.x) / after.width) * 600 - 300,
    y: ((anchor.y - after.y) / after.height) * 720 - 400,
  };
  log("zoom deviation " + JSON.stringify(deviation));
  assert.ok(Math.abs(deviation.x) < 2);
  assert.ok(Math.abs(deviation.y) < 2);
  await page.keyboard.down("Space");
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 40, anchor.y - 30, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await clickPixel(300, 400);
  await idle();
  assert.ok((await alpha(300, 400)) > 0);
  await clear();
  await button("Вписать изображение").click();
  await page.waitForTimeout(100);
  log("zoom and pan coordinates");
  await button("Кисть слоя · B").click();
  const b = await canvas.boundingBox(),
    x = b.x + (80 / 600) * b.width,
    y = b.y + (80 / 720) * b.height;
  const read = () =>
    canvas.evaluate((c) => [
      ...c.getContext("2d").getImageData(80, 80, 1, 1).data,
    ]);
  const before = await read();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await page.waitForTimeout(80);
  assert.deepEqual(await read(), before);
  log("focus loss cancels paint");
  await page.evaluate(async () => {
    const { db } = await import("/src/data/db.ts");
    window.__originalBulkPut = db.assets.bulkPut.bind(db.assets);
    db.assets.bulkPut = async () => {
      throw new DOMException("QA forced quota", "QuotaExceededError");
    };
  });
  await button("Цвета").click();
  await page.getByLabel("HEX цвета", { exact: true }).fill("#cd8040");
  await page.getByLabel("HEX цвета", { exact: true }).press("Enter");
  await page.waitForFunction(() =>
    document
      .querySelector(".pe-save-status")
      ?.textContent.startsWith("Ошибка сохранения"),
  );
  await page.evaluate(async () => {
    const { db } = await import("/src/data/db.ts");
    db.assets.bulkPut = window.__originalBulkPut;
    delete window.__originalBulkPut;
  });
  await button("Готово").click();
  await page.locator(".pe-v2").waitFor({ state: "detached" });
  await button("Редактировать окраску").click();
  await canvas.waitFor();
  await page.waitForTimeout(200);
  assert.deepEqual(
    await canvas.evaluate((c) => [
      ...c.getContext("2d").getImageData(300, 400, 1, 1).data,
    ]),
    [205, 128, 64, 255],
  );
  log("save failure and retry");
  const bench = await page.evaluate(async () => {
    const { canvas, paintComposite } = await import("/src/paint/canvas.ts"),
      { labPixels } = await import("/src/paint/core/color.ts"),
      { selectColor, growMask } = await import("/src/paint/core/selection.ts");
    const width = 2048,
      height = 1536,
      b = canvas(width, height),
      ctx = b.getContext("2d");
    ctx.fillStyle = "#777777";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#dddddd";
    ctx.fillRect(0, 0, 512, height);
    const px = ctx.getImageData(0, 0, width, height).data;
    let t = performance.now();
    const labs = labPixels(px),
      labMs = performance.now() - t;
    t = performance.now();
    const mask = selectColor(
        px,
        width,
        height,
        { x: 1000, y: 700 },
        { tolerance: 12, contiguous: true, diagonal: false },
        labs,
      ),
      wandMs = performance.now() - t;
    t = performance.now();
    growMask(mask, width, height, 20);
    const growMs = performance.now() - t;
    const layers = Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      name: "bench",
      mask,
      color: "#e5a276",
      opacity: 0.5,
      visible: true,
      blend: "color",
    }));
    t = performance.now();
    paintComposite(b, layers);
    return {
      width,
      height,
      layers: 4,
      labMs: Math.round(labMs),
      wandMs: Math.round(wandMs),
      growMs: Math.round(growMs),
      compositeMs: Math.round(performance.now() - t),
    };
  });
  log("benchmark " + JSON.stringify(bench));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await button("Вписать изображение").click();
  await page.waitForTimeout(150);
  const layout = await page.locator("dialog:has(.pe-v2)").evaluate((d) => ({
    width: d.clientWidth,
    scroll: d.scrollWidth,
    stage: d.querySelector(".pe-stage").clientHeight,
  }));
  assert.ok(layout.width >= layout.scroll);
  assert.ok(layout.stage > 500);
  await page.screenshot({ path: out + "/paint-1920.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  return bench;
}
