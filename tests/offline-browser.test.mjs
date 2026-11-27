import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "tests/offline-harness.html" : pathname.replace(/^\/+/, "");
    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(root + sep)) throw new Error("Invalid path");
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
const base = "http://127.0.0.1:" + address.port;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.offlineHarnessReady === true);

  const beforeOffline = await page.evaluate(async () => {
    for (const item of await window.offlineHarness.listQueuedChanges()) {
      await window.offlineHarness.removeQueuedChange(item.pinId);
    }
    const areaCache = await caches.open("map-canvas-area-test");
    await areaCache.put(
      "https://tiles.openfreemap.org/planet/0/0/0.pbf",
      new Response("cached-vector-tile", { headers: { "Content-Type": "application/x-protobuf" } })
    );
    await window.offlineHarness.enqueueOfflineChange({
      pinId: "browser-offline-pin", action: "save", expectedVersion: null,
      entry: { id: "browser-offline-pin", title: "Created offline", version: 0 }, createdAt: 1,
    });
    await window.offlineHarness.enqueueOfflineChange({
      pinId: "browser-offline-pin", action: "save", expectedVersion: 0,
      entry: { id: "browser-offline-pin", title: "Edited again offline", version: 0 }, createdAt: 2,
    });
    return await window.offlineHarness.listQueuedChanges();
  });
  assert.equal(beforeOffline.length, 1);
  assert.equal(beforeOffline[0].expectedVersion, null);
  assert.equal(beforeOffline[0].entry.title, "Edited again offline");

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.offlineHarnessReady === true);
  const offlineResult = await page.evaluate(async () => {
    const queue = await window.offlineHarness.listQueuedChanges();
    const response = await fetch("https://tiles.openfreemap.org/planet/0/0/0.pbf");
    return { title: document.title, queue, tile: await response.text(), controller: !!navigator.serviceWorker.controller };
  });
  assert.match(offlineResult.title, /offline browser test/i);
  assert.equal(offlineResult.queue.length, 1, "IndexedDB edit queue survives a page reload");
  assert.equal(offlineResult.queue[0].entry.title, "Edited again offline");
  assert.equal(offlineResult.tile, "cached-vector-tile", "a saved OpenFreeMap vector tile is served without network access");
  assert.equal(offlineResult.controller, true);

  await context.setOffline(false);
  await page.evaluate(async () => {
    await window.offlineHarness.removeQueuedChange("browser-offline-pin");
    await caches.delete("map-canvas-area-test");
  });
  process.stdout.write("PASS: IndexedDB offline edits survive reload and cached vector tiles are served offline\n");
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
