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
    const id = "live-openfreemap-test";
    const worker = navigator.serviceWorker.controller;
    const channel = new MessageChannel();
    const downloaded = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OpenFreeMap area download timed out.")), 45000);
      channel.port1.onmessage = event => {
        const message = event.data || {};
        if (message.type === "OFFLINE_AREA_COMPLETE") {
          clearTimeout(timeout);
          resolve(message.area);
        } else if (message.type === "OFFLINE_AREA_ERROR") {
          clearTimeout(timeout);
          reject(new Error(message.error));
        }
      };
    });
    worker.postMessage({
      type: "DOWNLOAD_OFFLINE_AREA",
      area: {
        id, name: "Browser test area",
        bounds: { west: 0.1, south: 0.1, east: 0.2, north: 0.2 },
        minZoom: 5, maxZoom: 5
      }
    }, [channel.port2]);
    const area = await downloaded;
    const areas = await window.offlineHarness.listOfflineAreas();
    const cache = await caches.open(area.cacheName);
    const keys = await cache.keys();
    const tile = keys.find(request => new URL(request.url).pathname.endsWith(".pbf"));
    if (!tile) throw new Error("Offline area did not cache a vector tile.");

    await window.offlineHarness.enqueueOfflineChange({
      pinId: "browser-offline-pin", action: "save", expectedVersion: null,
      entry: { id: "browser-offline-pin", title: "Created offline", version: 0 }, createdAt: 1,
    });
    await window.offlineHarness.enqueueOfflineChange({
      pinId: "browser-offline-pin", action: "save", expectedVersion: 0,
      entry: { id: "browser-offline-pin", title: "Edited again offline", version: 0 }, createdAt: 2,
    });
    return {
      area, areas, tileUrl: tile.url,
      queue: await window.offlineHarness.listQueuedChanges()
    };
  });
  assert.ok(beforeOffline.area.tileCount > 0);
  assert.equal(beforeOffline.areas.some(area => area.id === "live-openfreemap-test"), true);
  assert.equal(beforeOffline.queue.length, 1);
  assert.equal(beforeOffline.queue[0].expectedVersion, null);
  assert.equal(beforeOffline.queue[0].entry.title, "Edited again offline");

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.offlineHarnessReady === true);
  const offlineResult = await page.evaluate(async tileUrl => {
    const queue = await window.offlineHarness.listQueuedChanges();
    const response = await fetch(tileUrl);
    return { title: document.title, queue, tileStatus: response.status, tile: await response.arrayBuffer(), controller: !!navigator.serviceWorker.controller };
  }, beforeOffline.tileUrl);
  assert.match(offlineResult.title, /offline browser test/i);
  assert.equal(offlineResult.queue.length, 1, "IndexedDB edit queue survives a page reload");
  assert.equal(offlineResult.queue[0].entry.title, "Edited again offline");
  assert.equal(offlineResult.tileStatus, 200, "a downloaded OpenFreeMap vector tile is served without network access");
  assert.ok(offlineResult.tile.byteLength > 0);
  assert.equal(offlineResult.controller, true);

  await context.setOffline(false);
  await page.evaluate(async () => {
    await window.offlineHarness.removeQueuedChange("browser-offline-pin");
    await window.offlineHarness.removeOfflineAreaRecord("live-openfreemap-test");
    await caches.delete("map-canvas-area-live-openfreemap-test");
  });
  process.stdout.write("PASS: OpenFreeMap area download, IndexedDB edit persistence and offline vector-tile retrieval\n");
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
