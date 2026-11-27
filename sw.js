/* Offline app shell, viewed resources and explicitly saved OpenFreeMap areas. */
const SHELL = "map-canvas-shell-v30";
const TILES = "map-canvas-viewed-v19";
const PHOTO_CACHE = "map-canvas-photos-v1";
const AREA_PREFIX = "map-canvas-area-";
const OFFLINE_DB = "map-canvas-offline-v1";
const MAX_TILES = 3000;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PARALLEL = 4;
const cancelledAreas = new Set();
const CORE = [
  "./", "./index.html",
  "./app.js?v=offline-sync-20261127",
  "./offline-store.mjs?v=offline-areas-20261127",
  "./offline-tiles.mjs?v=offline-areas-20261127",
  "./enhancements.js?v=settings-layout-20261119",
  "./style.css?v=offline-areas-20261127",
  "./data/public-map.json", "./favicon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    key !== SHELL && key !== TILES && key !== PHOTO_CACHE && !key.startsWith(AREA_PREFIX)
  ).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tileX(longitude, zoom) {
  const count = 2 ** zoom;
  return clamp(Math.floor((longitude + 180) / 360 * count), 0, count - 1);
}

function tileY(latitude, zoom) {
  const count = 2 ** zoom;
  const lat = clamp(latitude, -85.05112878, 85.05112878) * Math.PI / 180;
  return clamp(Math.floor((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * count), 0, count - 1);
}

function enumerateTiles(bounds, minZoom, maxZoom) {
  if (!bounds || !["west", "south", "east", "north"].every(key => Number.isFinite(Number(bounds[key])))) {
    throw new Error("Choose a valid visible map area.");
  }
  const west = Number(bounds.west), south = Number(bounds.south);
  const east = Number(bounds.east), north = Number(bounds.north);
  if (south >= north || south < -90 || north > 90 ||
      west < -180 || west > 180 || east < -180 || east > 180 ||
      !Number.isInteger(minZoom) || !Number.isInteger(maxZoom) ||
      minZoom < 0 || maxZoom > 18 || minZoom > maxZoom) {
    throw new Error("The selected area or zoom range is invalid.");
  }
  const ranges = west <= east ? [[west, east]] : [[west, 180], [-180, east]];
  const tiles = [];
  const seen = new Set();
  for (let z = minZoom; z <= maxZoom; z++) {
    const y0 = tileY(north, z), y1 = tileY(south, z);
    for (const range of ranges) {
      const x0 = tileX(range[0], z), x1 = tileX(range[1], z);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const key = z + "/" + x + "/" + y;
          if (seen.has(key)) continue;
          seen.add(key);
          tiles.push({ z, x, y });
          if (tiles.length > MAX_TILES) throw new Error("This area exceeds the 3,000-tile limit. Reduce the area or zoom range.");
        }
      }
    }
  }
  return tiles;
}

function providerUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "tiles.openfreemap.org") {
    throw new Error("Offline area downloads are limited to OpenFreeMap vector tiles.");
  }
  return url.href;
}

function addAsset(assets, url, kind) {
  const href = providerUrl(url);
  const previous = assets.get(href);
  assets.set(href, previous === "tile" || kind === "tile" ? "tile" : (previous || kind));
}

function validateProxyOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter the URL of the independent Map Canvas tile proxy."); }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("The tile proxy URL must use HTTPS.");
  }
  return url.origin;
}

async function fetchProvider(url, proxyOrigin) {
  const proxyUrl = new URL("/proxy", proxyOrigin);
  proxyUrl.searchParams.set("url", url);
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(proxyUrl.href, { cache: "no-store" });
    if (![429, 503].includes(response.status) || attempt === 2) break;
    await delay(500 * (attempt + 1));
  }
  if (!response.ok) throw new Error("Map Canvas tile proxy returned HTTP " + response.status + ".");
  return response;
}

function tileUrl(template, tile) {
  return String(template).replaceAll("{z}", String(tile.z)).replaceAll("{x}", String(tile.x))
    .replaceAll("{y}", String(tile.y)).replaceAll("{s}", "a").replaceAll("{ratio}", "");
}

async function collectStyleAssets(styleUrl, tiles, assets, proxyOrigin) {
  addAsset(assets, styleUrl, "style");
  const styleResponse = await fetchProvider(styleUrl, proxyOrigin);
  const style = await styleResponse.json();

  for (const source of Object.values(style.sources || {})) {
    let tileSource = source;
    if (source.url) {
      const metadataUrl = providerUrl(source.url);
      addAsset(assets, metadataUrl, "metadata");
      tileSource = await (await fetchProvider(metadataUrl, proxyOrigin)).json();
    }
    for (const template of tileSource.tiles || []) {
      for (const tile of tiles) addAsset(assets, tileUrl(template, tile), "tile");
    }
  }

  const sprites = Array.isArray(style.sprite) ? style.sprite.map(item => item.url) : [style.sprite].filter(Boolean);
  for (const sprite of sprites) {
    const base = providerUrl(sprite);
    for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) addAsset(assets, base + suffix, "style");
  }

  if (typeof style.glyphs === "string" && style.glyphs.includes("{fontstack}") && style.glyphs.includes("{range}")) {
    const fontStacks = new Set();
    for (const layer of style.layers || []) {
      const fonts = layer.layout?.["text-font"];
      if (Array.isArray(fonts) && fonts.length) fontStacks.add(fonts.join(","));
      else if (typeof fonts === "string" && fonts) fontStacks.add(fonts);
    }
    const ranges = ["0-255", "256-511", "7680-7935"];
    for (const font of fontStacks) {
      for (const range of ranges) {
        const glyphUrl = style.glyphs.replace("{fontstack}", encodeURIComponent(font)).replace("{range}", range);
        addAsset(assets, glyphUrl, "style");
      }
    }
  }
}

function openOfflineDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("pending")) db.createObjectStore("pending", { keyPath: "pinId" });
      if (!db.objectStoreNames.contains("areas")) db.createObjectStore("areas", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline storage."));
  });
}

async function saveAreaRecord(area) {
  const db = await openOfflineDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("areas", "readwrite");
    tx.objectStore("areas").put(area);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

async function deleteAreaRecord(id) {
  const db = await openOfflineDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("areas", "readwrite");
    tx.objectStore("areas").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

function send(port, value) {
  try { port?.postMessage(value); } catch {}
}

async function downloadOfflineArea(area, port) {
  const id = String(area?.id || "");
  const cacheName = AREA_PREFIX + id;
  try {
    if (!/^[a-z0-9_-]{1,80}$/i.test(id)) throw new Error("Invalid offline area ID.");
    const minZoom = Number(area.minZoom), maxZoom = Number(area.maxZoom);
    if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom)) throw new Error("Choose whole-number zoom levels.");
    const proxyOrigin = validateProxyOrigin(area.proxyOrigin);
    const tiles = enumerateTiles(area.bounds, minZoom, maxZoom);
    if (!tiles.length) throw new Error("The selected area contains no map tiles.");

    const assets = new Map();
    const styles = [
      "https://tiles.openfreemap.org/styles/liberty",
      "https://tiles.openfreemap.org/styles/dark"
    ];
    for (const styleUrl of styles) await collectStyleAssets(styleUrl, tiles, assets, proxyOrigin);
    const tileCount = [...assets.values()].filter(kind => kind === "tile").length;
    if (tileCount > MAX_TILES) throw new Error("This style needs more than 3,000 vector tiles. Reduce the area or zoom range.");
    if (!tileCount) throw new Error("The selected OpenFreeMap style did not provide vector tiles.");

    await caches.delete(cacheName);
    const cache = await caches.open(cacheName);
    const jobs = [...assets.entries()];
    let next = 0, completed = 0, totalBytes = 0;
    let failure = null;
    const workers = Array.from({ length: MAX_PARALLEL }, async () => {
      while (!failure) {
        if (cancelledAreas.has(id)) {
          failure = failure || new Error("Offline area download cancelled.");
          return;
        }
        const index = next++;
        if (index >= jobs.length) return;
        const [url, kind] = jobs[index];
        try {
          const response = await fetchProvider(url, proxyOrigin);
          const bytes = await response.arrayBuffer();
          totalBytes += bytes.byteLength;
          if (totalBytes > MAX_BYTES) {
            failure = failure || new Error("This download reached the 50 MB limit. Choose a smaller area or zoom range.");
            return;
          }
          if (failure) return;
          const headers = new Headers(response.headers);
          headers.delete("Content-Length");
    headers.delete("Content-Encoding");
          await cache.put(url, new Response(bytes.slice(0), {
            status: response.status, statusText: response.statusText, headers
          }));
          completed++;
          send(port, {
            type: "OFFLINE_AREA_PROGRESS", id, completed, total: jobs.length,
            tileCount, bytes: totalBytes, currentKind: kind
          });
        } catch (error) {
          failure = failure || error;
          return;
        }
      }
    });
    await Promise.all(workers);
    if (failure) throw failure;
    if (cancelledAreas.has(id)) throw new Error("Offline area download cancelled.");

    const saved = {
      id,
      name: String(area.name || "Offline area").slice(0, 80),
      bounds: area.bounds,
      minZoom, maxZoom, tileCount, bytes: totalBytes,
      cacheName, proxyOrigin, style: "OpenFreeMap Liberty + Dark",
      downloadedAt: Date.now()
    };
    await saveAreaRecord(saved);
    send(port, { type: "OFFLINE_AREA_COMPLETE", area: saved });
  } catch (error) {
    await caches.delete(cacheName).catch(() => {});
    send(port, { type: "OFFLINE_AREA_ERROR", id, error: error?.message || "Offline area download failed." });
  } finally {
    cancelledAreas.delete(id);
    try { port?.close(); } catch {}
  }
}

async function removeOfflineArea(id, port) {
  if (!/^[a-z0-9_-]{1,80}$/i.test(String(id || ""))) {
    send(port, { type: "OFFLINE_AREA_DELETE_ERROR", error: "Invalid offline area ID." });
    return;
  }
  try {
    await caches.delete(AREA_PREFIX + id);
    await deleteAreaRecord(id);
    send(port, { type: "OFFLINE_AREA_DELETED", id });
  } catch (error) {
    send(port, { type: "OFFLINE_AREA_DELETE_ERROR", id, error: error?.message || "Could not delete offline area." });
  } finally {
    try { port?.close(); } catch {}
  }
}

self.addEventListener("message", event => {
  const message = event.data || {};
  if (message.type === "DOWNLOAD_OFFLINE_AREA") {
    event.waitUntil(downloadOfflineArea(message.area || {}, event.ports[0]));
  } else if (message.type === "CANCEL_OFFLINE_AREA") {
    cancelledAreas.add(String(message.id || ""));
  } else if (message.type === "DELETE_OFFLINE_AREA") {
    event.waitUntil(removeOfflineArea(message.id, event.ports[0]));
  }
});

async function serveOfflineMapResource(requestUrl) {
  let target;
  try { target = new URL(requestUrl.searchParams.get("url") || ""); }
  catch { return new Response("Invalid offline map resource URL.", { status: 400 }); }
  if (target.protocol !== "https:" || target.hostname !== "tiles.openfreemap.org" ||
      target.username || target.password || (target.port && target.port !== "443")) {
    return new Response("Only OpenFreeMap resources are available offline.", { status: 400 });
  }
  target.hash = "";
  const cached = await caches.match(target.href);
  if (cached) {
    const bytes = await cached.arrayBuffer();
    const headers = new Headers(cached.headers);
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    headers.set("X-Offline-Cache-Hit", "yes");
    headers.set("X-Offline-Cache-Bytes", String(bytes.byteLength));
    return new Response(new Uint8Array(bytes), { status: cached.status, statusText: cached.statusText, headers });
  }
  try {
    const upstream = await fetch(target.href);
    const bytes = await upstream.arrayBuffer();
    const headers = new Headers(upstream.headers);
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    headers.set("X-Offline-Cache-Hit", "no");
    headers.set("X-Offline-Cache-Bytes", String(bytes.byteLength));
    if (upstream.ok) {
      const cache = await caches.open(TILES);
      await cache.put(target.href, new Response(new Uint8Array(bytes.slice(0)), { status: upstream.status, statusText: upstream.statusText, headers }));
      const keys = await cache.keys();
      if (keys.length > 180) await Promise.all(keys.slice(0, keys.length - 180).map(key => cache.delete(key)));
    }
    return new Response(new Uint8Array(bytes), { status: upstream.status, statusText: upstream.statusText, headers });
  } catch {
    return new Response("This OpenFreeMap resource is not saved for offline use.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname === "/__offline_map_resource") {
    event.respondWith(serveOfflineMapResource(url));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(fetch(request, { cache: "no-store" }).then(response => {
      if (response.ok && url.pathname.match(/(?:\/|\.html|\.js|\.mjs|\.css|\.json|\.svg)$/)) {
        caches.open(SHELL).then(cache => cache.put(request, response.clone())).catch(() => {});
      }
      return response;
    }).catch(async () => await caches.match(request) || await caches.match("./index.html")));
    return;
  }

  if (url.protocol === "https:" && /^(tiles\.openfreemap\.org|unpkg\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) {
        // Rebuild the response from cached bytes so a proxy-origin URL in the
        // stored CORS response cannot make the browser discard the body when
        // replaying it for the original OpenFreeMap tile URL.
        const bytes = await cached.arrayBuffer();
        const headers = new Headers(cached.headers);
        headers.delete("Content-Length");
    headers.delete("Content-Encoding");
        return new Response(new Uint8Array(bytes), { status: cached.status, statusText: cached.statusText, headers });
      }
      const response = await fetch(request);
      if (response.ok && response.type !== "opaque") {
        const cacheName = url.hostname === "tiles.openfreemap.org" ? TILES : SHELL;
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
        if (cacheName === TILES) {
          const keys = await cache.keys();
          if(keys.length>180) await Promise.all(keys.slice(0, keys.length - 180).map(key => cache.delete(key)));
        }
      }
      return response;
    })());
    return;
  }

  // Cache only successfully CORS-readable images, with a strict entry-count cap.
  if (request.destination === "image" && url.protocol === "https:" &&
      url.hostname === "map-canvas-api.mikesheer001.workers.dev") {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(async response => {
      if (response.ok && response.type !== "opaque" &&
          (response.headers.get("Content-Type") || "").toLowerCase().startsWith("image/")) {
        const cache = await caches.open(PHOTO_CACHE);
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        if (keys.length > 120) await Promise.all(keys.slice(0, keys.length - 120).map(key => cache.delete(key)));
      }
      return response;
    })));
  }
});
