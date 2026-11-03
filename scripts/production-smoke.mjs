import { preview } from "vite";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.QA_PLAYWRIGHT || "playwright");
const server = await preview({
  preview: { host: "127.0.0.1", port: 5183, strictPort: true },
});
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
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(r.status() + ": " + r.url());
});
try {
  await page.goto("http://127.0.0.1:5183/");
  await page
    .getByRole("button", { name: "Загрузить пример", exact: true })
    .click();
  await page
    .getByText("Демонстрационная мастерская загружена", { exact: true })
    .waitFor();
  const id = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("masterskaya-v1");
        r.onsuccess = () => {
          const d = r.result,
            g = d.transaction("states").objectStore("states").get("main");
          g.onsuccess = () => {
            resolve(g.result.projects[0].id);
            d.close();
          };
          g.onerror = () => reject(g.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
  await page.goto("http://127.0.0.1:5183/#/board/" + id);
  await page.getByRole("button", { name: "Перекраска", exact: true }).click();
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 100;
    const x = c.getContext("2d");
    x.fillStyle = "#eeeeee";
    x.fillRect(0, 0, 100, 100);
    x.fillStyle = "#888888";
    x.fillRect(20, 20, 60, 60);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator(".pe-chooser input[type=file]")
    .setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(data, "base64"),
    });
  const c = page.getByLabel("Изображение для выделения и перекраски");
  await c.waitFor();
  await page.waitForTimeout(250);
  await c.click({ position: { x: 60, y: 60 } });
  await page
    .getByRole("button", { name: "Слой из выделения", exact: true })
    .first()
    .click();
  assert.equal(await page.locator(".pe-layer").count(), 1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  assert.ok((await download).suggestedFilename().endsWith(".png"));
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.locator(".pe-v2").waitFor({ state: "detached" });
  await page.goto("http://127.0.0.1:5183/#/materials");
  await page.getByRole("link", { name: "Что докупить", exact: true }).click();
  await page.getByRole("heading", { name: "Закупки", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      production: true,
      worker: true,
      pngDownload: true,
      shoppingRoute: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
