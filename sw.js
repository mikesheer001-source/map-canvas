const SHELL = "map-canvas-shell-v20";
const VIEWED = "map-canvas-viewed-v18";
const BASE = "map-canvas-offline-base-v1";
const AREA_PREFIX = "map-canvas-area-";
const corePaths = [
  "./index.html", "./app.js?v=offline-20261115", "./enhancements.js?v=photo-grid-20261115",
  "./offline.js", "./manifest.webmanifest", "./style.css?v=offline-20261115",
  "./data/public-map.json", "./favicon.svg", "./apple-touch-icon.png",
  "./vendor/maplibre-gl.mjs", "./vendor/maplibre-gl.css", "./vendor/pmtiles.mjs"
];
const scope = new URL(self.registration.scope);
const shellURLs = new Set(corePaths.map(path => new URL(path, scope).href));
const shellDocument = new URL("./index.html", scope).href;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(
    [...shellURLs].map(url => new Request(url, {cache:"reload"}))
  )).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith("map-canvas-shell-") && key !== SHELL)
    .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

async function networkOr(request, cacheName, fallback = request.url) {
  try { return await fetch(request); }
  catch { return await caches.match(fallback, {cacheName}) || Response.error(); }
}

async function viewedMapResource(request) {
  const cache = await caches.open(VIEWED);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) {
    try {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - 180)).map(key => cache.delete(key)));
    } catch {
      // Rendering can continue if the optional cache runs out of space.
    }
  }
  return response;
}

async function savedImageOrNetwork(request) {
  for (const cacheName of await caches.keys()) {
    if (!cacheName.startsWith(AREA_PREFIX)) continue;
    const image = await caches.match(request.url, {cacheName});
    if (image && (image.type !== "opaque" || request.mode === "no-cors")) return image;
  }
  return fetch(request);
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.href.startsWith(scope.href)) {
    if (request.mode === "navigate" && (url.pathname === scope.pathname || url.pathname === new URL(shellDocument).pathname)) {
      event.respondWith(networkOr(request, SHELL, shellDocument));
      return;
    }
    if (shellURLs.has(url.href)) {
      event.respondWith(caches.match(request, {cacheName:SHELL}).then(saved => saved || fetch(request)));
      return;
    }
    if (url.pathname.startsWith(new URL("./data/offline/", scope).pathname)) {
      event.respondWith(networkOr(request, BASE));
      return;
    }
  }
  if (url.protocol === "https:" && /^(tiles\.openfreemap\.org|unpkg\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) {
    event.respondWith(viewedMapResource(request));
    return;
  }
  if (request.destination === "image") event.respondWith(savedImageOrNetwork(request));
});
