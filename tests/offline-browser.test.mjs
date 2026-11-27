import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml"
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
  } catch { response.writeHead(404); response.end("Not found"); }
});
const style = {
  version: 8,
  sources: { openfreemap: { type: "vector", tiles: ["https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"] } },
  sprite: "https://tiles.openfreemap.org/sprites/test",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  layers: [{ id: "test-label", type: "symbol", layout: { "text-font": ["Noto Sans Regular"] } }]
};
const proxyServer = createServer((request, response) => {
  const headers = {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "public, max-age=3600"
  };
  if (request.method === "OPTIONS") { response.writeHead(204, headers); response.end(); return; }
  const target = new URL(request.url, "http://127.0.0.1").searchParams.get("url");
  if (!target) { response.writeHead(400, headers); response.end("missing url"); return; }
  const url = new URL(target);
  let body, type = "application/octet-stream";
  if (url.pathname.startsWith("/styles/")) { body = JSON.stringify(style); type = "application/json"; }
  else if (url.pathname.endsWith(".json")) { body = "{}"; type = "application/json"; }
  else if (url.pathname.endsWith(".png")) { body = Buffer.from([137,80,78,71,13,10,26,10]); type = "image/png"; }
  else if (url.pathname.endsWith(".pbf")) { body = Buffer.from("offline-test-tile"); type = "application/x-protobuf"; }
  else { response.writeHead(404, headers); response.end("not found"); return; }
  response.writeHead(200, { ...headers, "Content-Type": type, "ETag": '"offline-test"' });
  response.end(body);
});

await Promise.all([
  new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady)),
  new Promise(resolveReady => proxyServer.listen(0, "127.0.0.1", resolveReady))
]);
const base = "http://127.0.0.1:" + server.address().port;
const proxyOrigin = "http://127.0.0.1:" + proxyServer.address().port;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.offlineHarnessReady === true);

  const beforeOffline = await page.evaluate(async proxy => {
    for (const item of await window.offlineHarness.listQueuedChanges()) await window.offlineHarness.removeQueuedChange(item.pinId);
    const id = "browser-proxy-test";
    const channel = new MessageChannel();
    const downloaded = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Mock-proxy offline area download timed out.")), 15000);
      channel.port1.onmessage = event => {
        const message = event.data || {};
        if (message.type === "OFFLINE_AREA_COMPLETE") { clearTimeout(timeout); resolve(message.area); }
        else if (message.type === "OFFLINE_AREA_ERROR") { clearTimeout(timeout); reject(new Error(message.error)); }
      };
    });
    navigator.serviceWorker.controller.postMessage({
      type: "DOWNLOAD_OFFLINE_AREA",
      area: { id, proxyOrigin: proxy, name: "Browser test area",
        bounds: { west: 0.1, south: 0.1, east: 0.2, north: 0.2 }, minZoom: 5, maxZoom: 5 }
    }, [channel.port2]);
    const area = await downloaded;
    const areas = await window.offlineHarness.listOfflineAreas();
    const cache = await caches.open(area.cacheName);
    const keys = await cache.keys();
    const tile = keys.find(request => new URL(request.url).pathname.endsWith(".pbf"));
    if (!tile) throw new Error("Offline area did not cache a vector tile.");
    const cachedTile = await cache.match(tile);
    const cachedTileBytes = await cachedTile.clone().arrayBuffer();
    await window.offlineHarness.enqueueOfflineChange({
      pinId: "browser-offline-pin", action: "save", expectedVersion: null,
      entry: { id: "browser-offline-pin", title: "Created offline", version: 0 }, createdAt: 1
    });
    await window.offlineHarness.enqueueOfflineChange({
      pinId: "browser-offline-pin", action: "save", expectedVersion: 0,
      entry: { id: "browser-offline-pin", title: "Edited again offline", version: 0 }, createdAt: 2
    });
    return { area, areas, tileUrl: tile.url, cachedTileBytes: cachedTileBytes.byteLength,
      cachedTileType: cachedTile.type, queue: await window.offlineHarness.listQueuedChanges() };
  }, proxyOrigin);

  assert.ok(beforeOffline.area.tileCount > 0);
  assert.ok(beforeOffline.cachedTileBytes > 0, "downloaded CacheStorage response is empty: " + beforeOffline.cachedTileType);
  assert.equal(beforeOffline.areas.some(area => area.id === "browser-proxy-test"), true);
  assert.equal(beforeOffline.queue.length, 1);
  assert.equal(beforeOffline.queue[0].expectedVersion, null);
  assert.equal(beforeOffline.queue[0].entry.title, "Edited again offline");

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.offlineHarnessReady === true);
  const offlineResult = await page.evaluate(async tileUrl => {
    const queue = await window.offlineHarness.listQueuedChanges();
    const directCache = await caches.match(tileUrl);
    const directCacheBytes = directCache ? await directCache.clone().arrayBuffer() : new ArrayBuffer(0);
    const offlineUrl = new URL("/__offline_map_resource", location.origin);
    offlineUrl.searchParams.set("url", tileUrl);
    const response = await fetch(offlineUrl.href);
    return { title: document.title, queue, status: response.status, type: response.type,
      cacheHit: response.headers.get("X-Offline-Cache-Hit"), cacheBytes: response.headers.get("X-Offline-Cache-Bytes"),
      directCacheBytes: directCacheBytes.byteLength, directCacheType: directCache?.type,
      tile: await response.arrayBuffer(), controller: !!navigator.serviceWorker.controller };
  }, beforeOffline.tileUrl);
  assert.match(offlineResult.title, /offline browser test/i);
  assert.equal(offlineResult.queue.length, 1);
  assert.equal(offlineResult.queue[0].entry.title, "Edited again offline");
  assert.equal(offlineResult.status, 200);
  assert.ok(offlineResult.directCacheBytes > 0, "offline CacheStorage entry missing/empty: " + offlineResult.directCacheType);
  assert.ok(offlineResult.tile.byteLength > 0,
    "offline response was empty: " + offlineResult.type + " " + offlineResult.status +
    " cacheHit=" + offlineResult.cacheHit + " cacheBytes=" + offlineResult.cacheBytes +
    " directCacheBytes=" + offlineResult.directCacheBytes);
  assert.equal(offlineResult.controller, true);

  await context.setOffline(false);
  await page.evaluate(async () => {
    await window.offlineHarness.removeQueuedChange("browser-offline-pin");
    await window.offlineHarness.removeOfflineAreaRecord("browser-proxy-test");
    await caches.delete("map-canvas-area-browser-proxy-test");
  });
  process.stdout.write("PASS: proxied offline-area download, IndexedDB edit persistence and offline vector-tile retrieval\n");
} finally {
  await browser?.close();
  await Promise.all([
    new Promise(resolveClose => server.close(resolveClose)),
    new Promise(resolveClose => proxyServer.close(resolveClose))
  ]);
}
