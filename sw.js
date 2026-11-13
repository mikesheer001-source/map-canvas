/* Offline app shell and previously viewed map resources only.
 * No tile prefetching or offline-area downloads. Provider usage policies apply.
 */
const SHELL="map-canvas-shell-v11",TILES="map-canvas-viewed-v11";
const CORE=["./","./index.html","./app.js?v=manual-20261114",
  "./enhancements.js?v=manual-20261114","./style.css?v=manual-20261114","./data/public-map.json","./favicon.svg"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(SHELL).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==SHELL&&k!==TILES)
    .map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(url.origin===self.location.origin){
    event.respondWith(fetch(req,{cache:"no-store"}).then(res=>{
      if(res.ok&&url.pathname.match(/(?:\/|\.html|\.js|\.css|\.json|\.svg)$/))
        caches.open(SHELL).then(c=>c.put(req,res.clone())).catch(()=>{});
      return res;
    }).catch(async()=>await caches.match(req)||await caches.match("./index.html")));
    return;
  }
  // Cache only resources naturally encountered while browsing; bounded LRU-ish cache.
  // Never download additional map tiles for offline coverage.
  const allowed=/^(tiles\.openfreemap\.org|unpkg\.com|cdn\.jsdelivr\.net)$/;
  if(url.protocol!=="https:"||!allowed.test(url.hostname))return;
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(async res=>{
    if(res.ok&&res.type!=="opaque"){
      const cache=await caches.open(TILES);
      await cache.put(req,res.clone());
      const keys=await cache.keys();
      if(keys.length>180)await Promise.all(keys.slice(0,keys.length-180).map(k=>cache.delete(k)));
    }
    return res;
  })));
});
