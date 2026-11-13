import { createEnhancements } from "./enhancements.js";
const $ = (id) => document.getElementById(id);
const config = window.MAP_CANVAS_CONFIG || {};
const SHEETS_URL = String(config.sheetWebAppUrl || "").trim();
const DETAIL_ZOOM = 16.8;
const CLUSTER_MAX_ZOOM = 16;
const SNAPSHOT_KEY = "map-canvas:shared-snapshot-v2";
const ICONS = ["📍","🏨","☕","🍜","🏋️","🎨","📸","📝","🏖️","🛒","⭐"];
let enhanced = null;
const state = {
  hostels: [], entries: [], query: "", filter: "all", sort: "default",
  provider: "openfreemap", map: null, library: null, markers: [],
  leafletGroup: null, current: null, draft: null, placing: null, visiblePins: [],
  labelMarkers: [], mapMoving: false, pinEventsAttached: false, styleReady: false,
  pendingPhoto: null, showLabels: true, saving: false, listOpen: false,
  category: "all", undo: [], redo: [], historyBusy: false, gpsMarker: null,
  pendingPin: new URLSearchParams(location.search).get("pin"), sheetConnected: false
};
const attr = (el, name, value) => el.setAttribute(name, String(value));
const text = (tag, value, className) => {
  const el = document.createElement(tag);
  el.textContent = value == null ? "" : String(value);
  if (className) el.className = className;
  return el;
};
const button = (label, action, klass) => {
  const el = text("button", label, klass || "");
  el.type = "button"; el.addEventListener("click", action);
  return el;
};
const allEntries = () => state.entries.concat(state.hostels);
const coord = (n) => Number.isFinite(Number(n)) ? Number(n) : null;
const safeImage = (value) => {
  if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]{20,38000}$/.test(value)) return value;
  try { const u = new URL(value); return u.protocol === "https:" ? u.href : ""; }
  catch { return ""; }
};
let toastTimer;
function notify(message, danger) {
  const el = $("toast");
  el.textContent = message;
  el.style.background = danger ? "#893e36" : "#184f3f";
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 5500);
}
function announce(message) {
  $("mapNotice").textContent = message;
  $("mapNotice").classList.remove("hidden");
}
function clearNotice() { $("mapNotice").classList.add("hidden"); }

async function loadHostels() {
  const response = await fetch("./data/hostels.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Hostel map data is unavailable.");
  state.hostels = await response.json();
  state.hostels = state.hostels.map(e => ({...e,icon:e.icon||"🏨",color:e.color||"#245c48"}));
}
function sheetRequest() {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(SHEETS_URL)) {
    return Promise.reject(new Error("Google Sheets connection not yet configured."));
  }
  return new Promise((resolve, reject) => {
    const callback = "mapCanvasCb_" + Math.random().toString(36).slice(2, 16);
    let script;
    const timer = setTimeout(() => finish(new Error("Google Sheets did not respond.")), 15000);
    function finish(error, result) {
      clearTimeout(timer);
      delete window[callback];
      script?.remove();
      error ? reject(error) : resolve(result);
    }
    window[callback] = (data) => {
      if (!data || data.ok !== true || !Array.isArray(data.entries)) {
        finish(new Error(data?.error || "The shared sheet returned invalid data."));
      } else finish(null, data);
    };
    script = document.createElement("script");
    script.referrerPolicy = "no-referrer";
    script.onerror = () => finish(new Error("Could not reach Google Sheets."));
    script.src = SHEETS_URL + "?callback=" + encodeURIComponent(callback) + "&v=" + Date.now();
    document.head.appendChild(script);
  });
}
async function reloadShared(silent) {
  if (!SHEETS_URL) {
    state.sheetConnected = false;
    try {
      const cached = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
      if (Array.isArray(cached)) state.entries = cached;
    } catch {}
    $("syncState").textContent = navigator.onLine ? "Sheet not connected" : "Offline snapshot";
    $("statusText").textContent = "Hostel data preview · shared edits not connected";
    $("statusPip").classList.remove("connected");
    render();
    return;
  }
  $("syncState").textContent = "Syncing…";
  try {
    const result = await sheetRequest();
    if (Array.isArray(result.hostels) && result.hostels.length) state.hostels = result.hostels;
    const items = result.entries;
    state.entries = items.filter((e) => e && typeof e.id === "string"
      && Number.isFinite(coord(e.lat)) && Number.isFinite(coord(e.lng)))
      .map((entry) => ({
        id: entry.id, kind: ["place", "note", "photo"].includes(entry.kind) ? entry.kind : "place",
        title: String(entry.title || "Untitled"), category: String(entry.category || ""),
        lat: Number(entry.lat), lng: Number(entry.lng), price: String(entry.price || ""),
        rating: String(entry.rating || ""), notes: String(entry.notes || ""),
        photo: safeImage(String(entry.photo || "")), version: String(entry.version || ""),
        icon: ICONS.includes(entry.icon) ? entry.icon : "📍",
        color: validColor(entry.color) ? entry.color : "#245c48",
        source: "shared",
        layer: String(entry.layer || "").slice(0,40),
        group: String(entry.group || "").slice(0,100),
        gallery: Array.isArray(entry.gallery)?entry.gallery.filter(x=>typeof x==="string" && x.startsWith("https://") && safeImage(x)).slice(0,12):[],
        canvas: entry.canvas && typeof entry.canvas==="object" &&
          ["image","text","line","arrow","circle"].includes(entry.canvas.type) ? entry.canvas : null
      }));
    state.sheetConnected = true;
    try {localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(state.entries));} catch {}
    $("syncState").textContent = "● Sheet connected";
    $("statusText").textContent = "Live shared map · no sign-in";
    $("statusPip").classList.add("connected");
    render();
    applyDeepLink();
    if (!silent) notify("Shared map refreshed.");
  } catch (error) {
    state.sheetConnected = false;
    if (!state.entries.length) {
      try {
        const cached = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
        if (Array.isArray(cached)) state.entries = cached;
      } catch {}
    }
    render();
    $("syncState").textContent = "Sync unavailable";
    $("statusText").textContent = "Could not refresh the shared sheet";
    $("statusPip").classList.remove("connected");
    if (!silent) notify(error.message, true);
  }
}
function filterEntries() {
  const needle = state.query.toLowerCase().trim();
  const shown = allEntries().filter((e) =>
    (state.category === "all" || e.category === state.category)
    && (state.filter === "all" || state.filter === e.kind)
    && [e.title, e.notes, e.category, e.price, e.rating]
      .some((x) => String(x || "").toLowerCase().includes(needle)));
  if (state.sort === "price") shown.sort((a,b) =>
    (Number(String(a.price).replace(/[^\d.]/g, "")) || Infinity)
    - (Number(String(b.price).replace(/[^\d.]/g, "")) || Infinity));
  if (state.sort === "title") shown.sort((a,b) => a.title.localeCompare(b.title));
  if (state.sort === "rating") shown.sort((a,b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
  return enhanced ? enhanced.visible(shown) : shown;
}
function render() {
  enhanced?.selections();
  const shown = filterEntries();
  renderCategories();
  updateHistoryButtons();
  $("pinCount").textContent = allEntries().length + " pins on the shared canvas";
  $("resultCount").textContent = shown.length + (shown.length === 1 ? " entry" : " entries");
  $("mapSub").textContent = shown.length + " pins · " +
    (mapZoom() < DETAIL_ZOOM ? "Zoom in for details" : "Labels and photos visible");
  document.querySelectorAll(".filter").forEach((f) => {
    const selected = f.dataset.filter === state.filter;
    f.classList.toggle("is-active", selected);
    attr(f, "aria-pressed", selected);
  });
  const list = $("entries");
  list.replaceChildren();
  for (const entry of shown) {
    const row = document.createElement("button");
    row.type = "button"; row.className = "entry" + (state.current?.id === entry.id ? " is-active" : "");
    const ico = text("span", entry.icon || (entry.kind === "note" ? "📝" : entry.kind === "photo" ? "📸" : "📍"), "entry-ico");
    ico.style.color = validColor(entry.color) ? entry.color : pinColor(entry.kind);
    if (entry.kind === "photo" && entry.photo) {
      const img = document.createElement("img"); img.alt = "";
      img.src = entry.photo; ico.replaceChildren(img);
    }
    const wrap = text("span", "", "entry-main");
    wrap.append(text("strong", entry.title), text("small", entry.category || entry.kind));
    row.append(ico, wrap);
    if (entry.price) {
      const price = text("span", entry.price, "entry-price");
      if (entry.source === "hostel") price.append(text("small", "/ night"));
      row.append(price);
    }
    row.addEventListener("click", () => choose(entry, true));
    list.append(row);
  }
  if (!shown.length) list.append(text("p", "No matching entries.", "empty-results muted"));
  renderMarkers(shown);
  enhanced?.renderOverlay();
}

// Pin dots are native map features. Rendering them in the same renderer as the
// streets makes their coordinates exact throughout pan, pinch-zoom, and rotation.
const PIN_SOURCE = "canvas-geo-pins";
const PIN_HALO = "canvas-pin-halo";
const PIN_DOTS = "canvas-pin-dots";
const PIN_TOUCH = "canvas-pin-touch-targets";
function pinColor(kind) {
  return kind === "note" ? "#b77c27" : kind === "photo" ? "#845cac" : "#245c48";
}
function pinGeoJSON(entries) {
  return {
    type: "FeatureCollection",
    features: entries.filter((e) => Number.isFinite(Number(e.lat)) &&
      Number.isFinite(Number(e.lng)) && Math.abs(Number(e.lat)) <= 85 &&
      Math.abs(Number(e.lng)) <= 180).map((e) => ({
      type: "Feature",
      id: e.id,
      geometry: { type: "Point", coordinates: [Number(e.lng), Number(e.lat)] },
      properties: { id: e.id, kind: e.kind || "place", color: validColor(e.color) ? e.color : pinColor(e.kind) }
    }))
  };
}
function clearLabelMarkers() {
  for (const marker of state.labelMarkers || []) {
    try { marker.remove(); } catch {}
  }
  state.labelMarkers = [];
}
function makeCard(entry) {
  const root = document.createElement("div");
  root.className = "canvas-pin map-detail-card";
  root.style.pointerEvents = "none";
  const label = text("span", "", "pin-label");
  if (entry.photo) {
    const img = document.createElement("img");
    img.src = entry.photo;
    img.referrerPolicy = "no-referrer";
    img.alt = "";
    label.append(img);
  }
  const lines = document.createElement("span");
  lines.append(text("strong", (entry.icon || "📍") + " " + entry.title));
  const extra = [entry.price, entry.rating ? "★ " + entry.rating : ""].filter(Boolean).join(" · ");
  if (extra) lines.append(text("small", extra));
  else if (entry.kind === "note" && entry.notes) lines.append(text("small", entry.notes.slice(0, 55)));
  label.append(lines);
  root.append(label);
  return root;
}
function updateLabels() {
  clearLabelMarkers();
  const expanded = state.showLabels && mapZoom() >= DETAIL_ZOOM &&
    !state.mapMoving;
  if (expanded && state.map && state.library === "maplibre") {
    for (const entry of state.visiblePins || []) {
      if (!Number.isFinite(Number(entry.lat)) || !Number.isFinite(Number(entry.lng))) continue;
      const root = makeCard(entry);
      const marker = new window.maplibregl.Marker({
        element: root,
        anchor: "center",
        subpixelPositioning: true
      }).setLngLat([Number(entry.lng),Number(entry.lat)]).addTo(state.map);
      state.labelMarkers.push(marker);
    }
  }
  if (expanded && state.map && state.library === "leaflet") {
    for (const entry of state.visiblePins || []) {
      if (!Number.isFinite(Number(entry.lat)) || !Number.isFinite(Number(entry.lng))) continue;
      const label = makeCard(entry).querySelector(".pin-label");
      const icon = window.L.divIcon({
        className: "canvas-label-leaflet",
        html: label.outerHTML,
        iconSize: [0,0],
        iconAnchor: [0,0]
      });
      state.labelMarkers.push(window.L.marker([entry.lat,entry.lng],{
        icon,interactive:false,keyboard:false
      }).addTo(state.map));
    }
  }
  attr($("toggleLabels"), "aria-pressed", state.showLabels);
  $("mapSub").textContent = filterEntries().length + " pins · " +
    (mapZoom() < DETAIL_ZOOM ? "Zoom in for details" : expanded ? "Labels and photos visible" : "Labels hidden");
}
function attachMapPinClicks(map) {
  if (state.pinEventsAttached) return;
  state.pinEventsAttached = true;
  map.on("click", PIN_TOUCH, (event) => {
    const id = event.features?.[0]?.properties?.id;
    const entry = allEntries().find((item) => item.id === id);
    if (!entry) return;
    if(enhanced?.consumeDragClick())return;
    if (state.placing) placeAt({lng:entry.lng,lat:entry.lat});
    else choose(entry,false);
  });
  map.on("mouseenter", PIN_TOUCH, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", PIN_TOUCH, () => { map.getCanvas().style.cursor = ""; });
  enhanced?.attachPinDrag(map,PIN_TOUCH);
}
function renderMarkers(entries) {
  state.visiblePins = entries;
  clearLabelMarkers();
  if (!state.map) return;
  if (state.library === "maplibre") {
    if (!state.styleReady) return;
    const data = pinGeoJSON(entries);
    const source = state.map.getSource(PIN_SOURCE);
    if (source) {
      source.setData(data);
    } else {
      state.map.addSource(PIN_SOURCE, {type:"geojson",data,cluster:true,clusterRadius:54,clusterMaxZoom:CLUSTER_MAX_ZOOM});
    }
    if (!state.map.getLayer("canvas-clusters")) {
      state.map.addLayer({id:"canvas-clusters",source:PIN_SOURCE,type:"circle",
        filter:["has","point_count"],
        paint:{"circle-color":"#174f42","circle-radius":["step",["get","point_count"],19,10,24,30,30],
          "circle-stroke-width":3,"circle-stroke-color":"#ffffff"}});
      state.map.addLayer({id:"canvas-cluster-count",source:PIN_SOURCE,type:"symbol",
        filter:["has","point_count"],layout:{"text-field":["get","point_count_abbreviated"],
          "text-size":13},paint:{"text-color":"#ffffff"}});
    }
    if (!state.map.getLayer(PIN_HALO)) {
      state.map.addLayer({
        id:PIN_HALO,source:PIN_SOURCE,type:"circle",filter:["!",["has","point_count"]],
        paint:{"circle-radius":11,"circle-color":"#ffffff",
          "circle-opacity":0.97,"circle-blur":0.1}
      });
    }
    if (!state.map.getLayer(PIN_DOTS)) {
      state.map.addLayer({
        id:PIN_DOTS,source:PIN_SOURCE,type:"circle",filter:["!",["has","point_count"]],
        paint:{
          "circle-radius": ["case", ["==",["get","id"],state.current?.id || ""],9,7],
          "circle-color":["get","color"],
          "circle-stroke-color":"#ffffff","circle-stroke-width":1.2
        }
      });
    } else {
      state.map.setPaintProperty(PIN_DOTS,"circle-radius",
        ["case", ["==",["get","id"],state.current?.id || ""],9,7]);
    }
    if (!state.map.getLayer(PIN_TOUCH)) {
      state.map.addLayer({
        id:PIN_TOUCH,source:PIN_SOURCE,type:"circle",filter:["!",["has","point_count"]],
        paint:{"circle-radius":18,"circle-color":"#ffffff","circle-opacity":0.005}
      });
    }
    attachMapPinClicks(state.map);
    if (!state.clusterClickAttached) {
      state.clusterClickAttached = true;
      state.map.on("click","canvas-clusters",(event)=>{
        const feature=event.features?.[0];
        if (!feature) return;
        state.map.getSource(PIN_SOURCE).getClusterExpansionZoom(
          feature.properties.cluster_id,(err,zoom)=>{
            if (!err) state.map.easeTo({center:feature.geometry.coordinates,zoom:Math.min(zoom,19)});
          });
      });
      state.map.on("mouseenter","canvas-clusters",()=>{state.map.getCanvas().style.cursor="pointer";});
      state.map.on("mouseleave","canvas-clusters",()=>{state.map.getCanvas().style.cursor="";});
    }
  } else if (state.library === "leaflet") {
    for (const marker of state.markers) { try { marker.remove(); }catch {} }
    state.markers = [];
    for (const entry of entries) {
      if (!Number.isFinite(Number(entry.lat)) || !Number.isFinite(Number(entry.lng))) continue;
      const owned=!!getKey(entry.id)&&state.sheetConnected;
      const color=validColor(entry.color)?entry.color:pinColor(entry.kind);
      const marker = owned
        ?window.L.marker([Number(entry.lat),Number(entry.lng)],{
          draggable:true,
          icon:window.L.divIcon({className:"draggable-leaflet-pin",
            html:'<span class="leaflet-dot" style="background:'+color+'"></span>',
            iconSize:[24,24],iconAnchor:[12,12]})
        }).addTo(state.map)
        :window.L.circleMarker([Number(entry.lat),Number(entry.lng)],{
          radius:8,color:"#ffffff",weight:3,fillColor:color,
          fillOpacity:1,bubblingMouseEvents:false
        }).addTo(state.map);
      if(owned)enhanced?.leafletDrag(marker,entry);
      marker.on("click",()=>{
        if (state.placing) placeAt({lat:entry.lat,lng:entry.lng});
        else choose(entry,false);
      });
      state.markers.push(marker);
    }
  }
  updateLabels();
  enhanced?.renderOverlay();
}

function mapZoom() { return state.map ? state.map.getZoom() : 15; }
const osmStyle = {
  version:8, sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap contributors"}},
  layers:[{id:"osm-base",type:"raster",source:"osm"}]
};
function paintProvider() {
  for (const el of $("basemapSwitch").querySelectorAll("[data-basemap]")) {
    attr(el,"aria-pressed",el.dataset.basemap === state.provider);
  }
}
function changeProvider(provider) {
  if (!["openfreemap","openstreetmap"].includes(provider)) return;
  state.provider = provider;
  paintProvider();
  $("basemapSwitch").classList.add("hidden");
  attr($("basemapButton"),"aria-expanded",false);
  if (state.library === "maplibre") {
    clearNotice();
    state.styleReady = false;
    clearLabelMarkers();
    state.map.setStyle(provider === "openfreemap"
      ? "https://tiles.openfreemap.org/styles/liberty" : osmStyle);
  } else if (provider === "openfreemap") {
    announce("OpenFreeMap needs WebGL. This browser is using the OpenStreetMap fallback.");
    state.provider = "openstreetmap"; paintProvider();
  }
}
function mapFocus(entry) {
  if (!state.map) return;
  if (state.library === "maplibre") state.map.flyTo({center:[entry.lng,entry.lat],zoom:Math.max(mapZoom(),17.3),speed:1.2});
  else state.map.flyTo([entry.lat,entry.lng],Math.max(mapZoom(),17.3));
}
function fitPins() {
  const valid = allEntries().filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
  if (!valid.length || !state.map) return;
  if (state.library === "maplibre") {
    const minLng = Math.min(...valid.map((x) => x.lng)), minLat = Math.min(...valid.map((x) => x.lat));
    const maxLng = Math.max(...valid.map((x) => x.lng)), maxLat = Math.max(...valid.map((x) => x.lat));
    state.map.fitBounds([[minLng,minLat],[maxLng,maxLat]],{padding:60,maxZoom:16,duration:650});
  } else {
    state.map.fitBounds(valid.map((x) => [x.lat,x.lng]),{padding:[35,35],maxZoom:16});
  }
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve,ms));
async function fallbackLeaflet(reason) {
  $("map").replaceChildren();
  if (!document.querySelector('link[data-leaflet]')) {
    const link = document.createElement("link");link.rel="stylesheet";link.dataset.leaflet="1";
    link.href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";document.head.append(link);
  }
  if (!window.L) {
    await new Promise((resolve,reject) => {
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
      script.onload=resolve;script.onerror=reject;document.head.append(script);
    });
  }
  const L=window.L;
  state.map=L.map("map",{zoomControl:false}).setView([21.0345,105.85],15);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
    attribution:"© OpenStreetMap contributors",maxZoom:19
  }).addTo(state.map);
  state.map.on("click",(e)=>{if(state.placing)placeAt({lat:e.latlng.lat,lng:e.latlng.lng});});
  state.map.on("movestart",()=>{state.mapMoving=true;clearLabelMarkers();});
  state.map.on("moveend",()=>{state.mapMoving=false;updateLabels();});
  state.map.on("zoomend",updateLabels);
  state.library="leaflet";
  state.styleReady=true;
  state.provider="openstreetmap";
  paintProvider();renderMarkers(filterEntries());updateLabels();
  announce("Using OpenStreetMap fallback" + (reason ? ": " + reason : "") + ".");
}
async function initMap() {
  announce("Loading street map…");
  try {
    const lib = await import("https://unpkg.com/maplibre-gl@6.18.0/dist/maplibre-gl.mjs");
    window.maplibregl=lib;
    const map=new lib.Map({
      container:"map",center:[105.8503,21.0345],zoom:15.5,
      style:"https://tiles.openfreemap.org/styles/liberty",
      attributionControl:true,maxZoom:19
    });
    state.map=map;state.library="maplibre";
    map.addControl(new lib.NavigationControl({showCompass:false}),"bottom-right");
    let started=false;
    map.on("load",()=>{started=true;state.styleReady=true;clearNotice();renderMarkers(filterEntries());});
    map.on("style.load",()=>{state.styleReady=true;renderMarkers(filterEntries());});
    map.on("movestart",()=>{state.mapMoving=true;clearLabelMarkers();});
    map.on("moveend",()=>{state.mapMoving=false;updateLabels();});
    map.on("zoomend",updateLabels);
    map.on("click",(event)=>{ if(state.placing)placeAt(event.lngLat); });
    map.on("error",(event)=>{
      if (!started) announce("Map tiles may be unavailable. Try the OpenStreetMap layer.");
      console.warn("Map provider error",event.error?.message||event);
    });
    await Promise.race([
      new Promise((resolve,reject)=>{map.once("load",resolve);map.once("error",reject);}),
      delay(12000).then(()=>{if(!started)throw new Error("Map timed out");})
    ]);
  } catch(error) {
    try {state.map?.remove();}catch {}
    state.map=null;state.library=null;
    try {await fallbackLeaflet(error.message?.slice(0,60));}
    catch {announce("Map tiles couldn't load. Check your connection and refresh.");}
  }
}
function choose(entry, focus) {
  if (state.placing) { placeAt({lng:entry.lng,lat:entry.lat}); return; }
  state.current=entry;render();
  if (entry.id) history.replaceState(null,"",pinUrl(entry.id));
  if (focus) {showMobileMap();mapFocus(entry);}
  const detail=$("detailPanel");detail.replaceChildren();
  const head=text("div","","detail-head");
  const name=text("h2",entry.title);
  head.append(name,button("✕",hideDetail));
  detail.append(head);
  if (entry.photo) {
    const img=document.createElement("img");
    img.alt=entry.title;img.src=entry.photo;img.referrerPolicy="no-referrer";img.className="detail-photo";
    detail.append(img);
  }
  const pills=text("div","","detail-pills");
  for (const word of [entry.price,entry.rating&&"★ "+entry.rating,entry.breakfast==="Yes"&&"Breakfast included"].filter(Boolean)) pills.append(text("span",word));
  detail.append(pills);
  if (entry.notes) detail.append(text("p",entry.notes,"detail-notes"));
  if (entry.source==="hostel") detail.append(text("small","Prices from Nov 12–14, 2026; verify current rates.","muted"));
  const actions=text("div","","detail-actions");
  if (entry.link?.startsWith("https://")) {
    const anchor=text("a","Google Maps ↗","secondary");
    anchor.href=entry.link;anchor.rel="noopener noreferrer";anchor.target="_blank";actions.append(anchor);
  }
  actions.append(button("Share link",()=>sharePin(entry),"secondary"));
  const ownerKey=getKey(entry.id);
  if (entry.source!=="hostel" && ownerKey) {
    actions.append(button("Edit",()=>{hideDetail();openEditor(entry);},"secondary"));
    actions.append(button("Delete",()=>removeEntry(entry),"secondary"));
  }
  detail.append(actions);
  $("overlay").classList.remove("hidden");
  detail.classList.remove("hidden");
}
function hideDetail() {
  state.current=null;
  if (new URLSearchParams(location.search).has("pin")) history.replaceState(null,"",pinUrl(null));
  $("detailPanel").classList.add("hidden");$("overlay").classList.add("hidden");render();
}
function toggleList(open) {
  state.listOpen=open;
  $("sidebar").classList.toggle("list-open",open);
  $("mapArea").classList.toggle("list-hidden",open);
  $("mobileMapButton").classList.toggle("hidden",!open);
  if (!open) setTimeout(()=>state.map?.resize?.()||state.map?.invalidateSize?.(),50);
}
function showMobileMap(){toggleList(false);}
function startPlacement(kind, draft) {
  hideDetail();
  state.placing={kind:kind||"place", draft:draft||null};
  $("placementBar").classList.remove("hidden");
  $("cancelPlace").focus();
  showMobileMap();
}
async function placeAt({lng,lat}) {
  if (!state.placing) return;
  const p=state.placing;state.placing=null;
  $("placementBar").classList.add("hidden");
  const draft=p.draft||{
    id:crypto.randomUUID(),title:"",kind:p.kind,category:"",price:"",rating:"",
    notes:"",photo:"",version:""
  };
  draft.lat=Number(lat);draft.lng=Number(lng);
  if (state.pendingPhoto) {
    try {draft.photo=await shrinkPhoto(state.pendingPhoto);}catch(e){notify(e.message,true);}
    state.pendingPhoto=null;
  }
  openEditor(draft);
}
function openEditor(entry) {
  state.draft={...entry};
  $("editorTitle").textContent=entry.version?"Edit map entry":"New map entry";
  $("title").value=entry.title||"";
  $("category").value=entry.category||"";
  $("price").value=entry.price||"";
  $("rating").value=entry.rating||"";
  $("notes").value=entry.notes||"";
  $("pinIcon").value=ICONS.includes(entry.icon)?entry.icon:"📍";
  $("pinColor").value=validColor(entry.color)?entry.color:"#245c48";
  $("imageUrl").value=entry.photo?.startsWith("https://")?entry.photo:"";
  $("coords").textContent=entry.lat.toFixed(5)+", "+entry.lng.toFixed(5);
  const img=$("photoPreview");
  if (entry.photo) {img.src=entry.photo;img.classList.remove("hidden");}
  else {img.removeAttribute("src");img.classList.add("hidden");}
  for(const b of document.querySelectorAll(".type")) {
    b.classList.toggle("is-active",b.dataset.kind===entry.kind);
    attr(b,"aria-pressed",b.dataset.kind===entry.kind);
  }
  $("saveNote").textContent=!SHEETS_URL
    ? "Shared saving is unavailable until the Google Sheets backend is connected. Do not enter private information."
    : "Public: anything saved here is visible to everyone.";
  $("saveEntry").disabled=!SHEETS_URL;
  $("editor").showModal();
}
function closeEditor() {$("editor").close();state.draft=null;}
const keyName=(id)=>"mc-ownership:"+id;
function getKey(id) {try{return localStorage.getItem(keyName(id));}catch{return null;}}
function saveKey(id,key) {try{localStorage.setItem(keyName(id),key);}catch{}}
function randomKey() {
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
}
async function submitChange(action,entry,key) {
  if (!SHEETS_URL)throw new Error("Shared sheet isn't connected.");
  const body={action,entry,key};
  await fetch(SHEETS_URL,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=UTF-8"},
    body:JSON.stringify(body),redirect:"follow"});
  await delay(1300);
  let last=null;
  for (let i=0;i<3;i++) {
    const data=await sheetRequest();
    last=data;
    const found=data.entries.find((row)=>row.id===entry.id);
    if ((action==="save" && found && found.version!==entry.version)||
        (action==="delete" && !found)) {
      await reloadShared(true);
      return;
    }
    await delay(1250);
  }
  throw new Error("The change couldn't be confirmed. Refresh to see if it saved.");
}
async function saveEntry(event) {
  event.preventDefault();if(state.saving||!state.draft)return;
  const entry={...state.draft,
    title:$("title").value.trim(),category:$("category").value.trim(),kind:state.draft.kind,
    notes:$("notes").value.trim(),price:$("price").value.trim(),rating:$("rating").value.trim(),
    icon:$("pinIcon").value,color:$("pinColor").value
  };
  const imageUrl=$("imageUrl").value.trim();
  if (imageUrl && !safeImage(imageUrl)) {notify("Use an HTTPS image URL.",true);return;}
  if (imageUrl) entry.photo=imageUrl;
  if (!entry.title) {notify("Add a title first.",true);return;}
  if (entry.kind==="photo" && !entry.photo) {notify("Add a photo first.",true);return;}
  state.saving=true;$("saveEntry").disabled=true;$("saveEntry").textContent="Saving…";
  const existing=getKey(entry.id);const key=existing||randomKey();
  if (!existing)saveKey(entry.id,key);
  try {
    const before = state.entries.find(x=>x.id===entry.id) || null;
    await submitChange("save",entry,key);
    recordChange({before,after:state.entries.find(x=>x.id===entry.id)||entry});
    closeEditor();notify("Saved to the shared map.");
  }catch(error){notify(error.message,true);}
  finally{state.saving=false;$("saveEntry").textContent="Save to shared map";$("saveEntry").disabled=!SHEETS_URL;}
}
async function removeEntry(entry) {
  if (!confirm("Delete this public entry?"))return;
  const key=getKey(entry.id);
  if (!key){notify("Only the browser that added this entry can delete it.",true);return;}
  try {await submitChange("delete",entry,key);recordChange({before:entry,after:null});hideDetail();notify("Entry removed.");}
  catch(error){notify(error.message,true);}
}
async function shrinkPhoto(file) {
  if (!file?.type.startsWith("image/"))throw new Error("Choose an image.");
  if (file.size>12*1024*1024)throw new Error("Choose a photo below 12 MB.");
  const url=URL.createObjectURL(file);
  try {
    const img=new Image();
    img.src=url;await img.decode();
    let edge=560,quality=.75;
    for(let i=0;i<15;i++){
      const scale=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight));
      const c=document.createElement("canvas");
      c.width=Math.max(1,Math.round(img.naturalWidth*scale));
      c.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=c.getContext("2d");
      ctx.fillStyle="white";ctx.fillRect(0,0,c.width,c.height);
      ctx.drawImage(img,0,0,c.width,c.height);
      const result=c.toDataURL("image/jpeg",quality);
      if(result.length<36500)return result;
      edge=Math.max(100,Math.round(edge*.80));quality=Math.max(.36,quality-.035);
    }
    throw new Error("Photo is too detailed. Paste an image URL instead.");
  }finally{URL.revokeObjectURL(url);}
}
async function addImageFile(file) {
  if (!state.draft) {state.pendingPhoto=file;startPlacement("photo");return;}
  try {
    const result=await shrinkPhoto(file);
    state.draft.photo=result;$("imageUrl").value="";
    $("photoPreview").src=result;$("photoPreview").classList.remove("hidden");
  }catch(error){notify(error.message,true);}
}

function validColor(color) {return /^#[0-9a-fA-F]{6}$/.test(String(color||""));}
function renderCategories() {
  const select=$("categoryFilter");
  if (!select) return;
  const categories=[...new Set(allEntries().map(e=>e.category).filter(Boolean))].sort();
  const signature=categories.join("\u0001");
  if (select.dataset.signature!==signature) {
    select.dataset.signature=signature;
    select.replaceChildren(new Option("All categories","all"));
    for (const cat of categories) select.add(new Option(cat,cat));
  }
  if (state.category!=="all"&&!categories.includes(state.category)) state.category="all";
  select.value=state.category;
}
function pinUrl(id) {
  const url=new URL(location.href);
  if(id)url.searchParams.set("pin",id);
  else url.searchParams.delete("pin");
  return url.pathname+url.search+url.hash;
}
async function sharePin(entry) {
  const url=new URL(pinUrl(entry.id),location.href).href;
  try {
    if (navigator.share) await navigator.share({title:entry.title,url});
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);notify("Pin link copied.");
    } else {prompt("Copy this pin link:",url);}
  } catch(e) {if(e.name!=="AbortError")notify("Could not share this link.",true);}
}
function applyDeepLink() {
  if(!state.pendingPin)return;
  const entry=allEntries().find(e=>e.id===state.pendingPin);
  if(entry){state.pendingPin=null;choose(entry,true);}
}
function locateUser() {
  if (!navigator.geolocation) {notify("Location is unavailable in this browser.",true);return;}
  $("locateButton").disabled=true;
  navigator.geolocation.getCurrentPosition(({coords})=>{
    $("locateButton").disabled=false;
    const {latitude:lat,longitude:lng}=coords;
    if(state.library==="maplibre"){
      state.gpsMarker?.remove();
      const el=text("div","", "gps-dot");
      state.gpsMarker=new window.maplibregl.Marker({element:el})
        .setLngLat([lng,lat]).addTo(state.map);
      state.map.flyTo({center:[lng,lat],zoom:Math.max(mapZoom(),16)});
    } else if(state.library==="leaflet"){
      state.gpsMarker?.remove();
      state.gpsMarker=window.L.circleMarker([lat,lng],{radius:8,color:"#fff",weight:3,
        fillColor:"#2486df",fillOpacity:1}).addTo(state.map);
      state.map.flyTo([lat,lng],Math.max(mapZoom(),16));
    }
    notify("Showing your location. Location is not saved or shared.");
  },error=>{
    $("locateButton").disabled=false;
    notify(error.code===1?"Location permission denied.":"Unable to determine your location.",true);
  },{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}
function recordChange(change) {
  state.undo.push(change);
  if(state.undo.length>30)state.undo.shift();
  state.redo=[];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  for(const [id,available] of [["undoBtn",state.undo.length],["redoBtn",state.redo.length]]) {
    const el=$(id);
    if(el)el.disabled=state.historyBusy||state.saving||!SHEETS_URL||!available;
  }
}
async function replayHistory(direction) {
  if(state.historyBusy||state.saving||!SHEETS_URL)return;
  const from=direction==="undo"?state.undo:state.redo;
  const to=direction==="undo"?state.redo:state.undo;
  if(!from.length)return;
  const item=from[from.length-1];
  const desired=direction==="undo"?item.before:item.after;
  const id=(item.after||item.before).id;
  const current=state.entries.find(e=>e.id===id)||null;
  const key=getKey(id);
  if(!key){notify("This browser does not have the edit key.",true);return;}
  state.historyBusy=true;updateHistoryButtons();
  try {
    if(desired) {
      const entry={...desired,version:current?.version||""};
      await submitChange("save",entry,key);
    } else if(current) {
      await submitChange("delete",current,key);
    }
    from.pop();to.push(item);
    notify(direction==="undo"?"Change undone on shared map.":"Change redone on shared map.");
  } catch(e){notify("Cannot "+direction+": "+e.message,true);}
  finally{state.historyBusy=false;updateHistoryButtons();}
}
function setupOffline() {
  const status=$("offlineState");
  const refresh=()=>{
    status.textContent=navigator.onLine?"":"Offline · cached map data only";
    status.classList.toggle("hidden",navigator.onLine);
  };
  window.addEventListener("online",()=>{refresh();reloadShared(true);});
  window.addEventListener("offline",refresh);
  refresh();
  if("serviceWorker" in navigator && location.protocol==="https:")
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

function wire() {
  $("refreshBtn").addEventListener("click",()=>reloadShared(false));
  $("categoryFilter").addEventListener("change",e=>{state.category=e.target.value;render();});
  $("locateButton").addEventListener("click",locateUser);
  $("undoBtn").addEventListener("click",()=>replayHistory("undo"));
  $("redoBtn").addEventListener("click",()=>replayHistory("redo"));
  $("search").addEventListener("input",(e)=>{state.query=e.target.value;render();});
  $("sort").addEventListener("change",(e)=>{state.sort=e.target.value;render();});
  document.querySelectorAll(".filter").forEach((el)=>
    el.addEventListener("click",()=>{state.filter=el.dataset.filter;render();}));
  $("addButton").addEventListener("click",()=>startPlacement("place"));
  $("cancelPlace").addEventListener("click",()=>{
    state.placing=null;$("placementBar").classList.add("hidden");
  });
  $("zoomIn").addEventListener("click",()=>state.map?.zoomIn());
  $("zoomOut").addEventListener("click",()=>state.map?.zoomOut());
  $("fitPins").addEventListener("click",fitPins);
  $("toggleLabels").addEventListener("click",()=>{state.showLabels=!state.showLabels;updateLabels();});
  $("basemapButton").addEventListener("click",()=>{
    const open=$("basemapSwitch").classList.toggle("hidden")===false;
    attr($("basemapButton"),"aria-expanded",open);
  });
  document.querySelectorAll("[data-basemap]").forEach((el)=>
    el.addEventListener("click",()=>changeProvider(el.dataset.basemap)));
  $("overlay").addEventListener("click",hideDetail);
  $("listButton").addEventListener("click",()=>toggleList(true));
  $("mobileMapButton").addEventListener("click",()=>toggleList(false));
  $("closeEditor").addEventListener("click",closeEditor);
  $("cancelEdit").addEventListener("click",closeEditor);
  $("editForm").addEventListener("submit",saveEntry);
  $("uploadPhoto").addEventListener("click",()=>$("photoFile").click());
  $("photoFile").addEventListener("change",(e)=>{if(e.target.files?.[0])addImageFile(e.target.files[0]);e.target.value="";});
  $("imageUrl").addEventListener("change",(e)=>{
    if(!state.draft)return;
    const url=safeImage(e.target.value);
    if(url){state.draft.photo=url;$("photoPreview").src=url;$("photoPreview").classList.remove("hidden");}
  });
  $("movePin").addEventListener("click",()=>{
    if(!state.draft)return;
    const moving={...state.draft};closeEditor();startPlacement(moving.kind,moving);
  });
  document.querySelectorAll(".type").forEach((el)=>el.addEventListener("click",()=>{
    if(!state.draft)return;
    state.draft.kind=el.dataset.kind;
    for(const item of document.querySelectorAll(".type")){
      item.classList.toggle("is-active",item===el);attr(item,"aria-pressed",item===el);
    }
  }));
  window.addEventListener("paste",(event)=>{
    if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;
    const file=Array.from(event.clipboardData?.items||[])
      .find((x)=>x.type.startsWith("image/"))?.getAsFile();
    if(file){event.preventDefault();addImageFile(file);}
  });
  window.addEventListener("keydown",(event)=>{
    if(event.key==="Escape"){
      $("basemapSwitch").classList.add("hidden");
      if(state.placing) {$("placementBar").classList.add("hidden");state.placing=null;}
      if(!$("detailPanel").classList.contains("hidden"))hideDetail();
    }
  });
}
async function main() {
  wire();
  setupOffline();
  try {await loadHostels();}catch(error){notify(error.message,true);}
  render();
  await initMap();
  render();
  await reloadShared(true);
  applyDeepLink();
}
// Read-only development inspection. Unavailable on public GitHub Pages.
if (["127.0.0.1","localhost"].includes(location.hostname)) {
  window.__mapCanvasTest = {
    getMap: () => state.map,
    getLibrary: () => state.library,
    getEntries: () => allEntries(),
    getPins: () => state.visiblePins
  };
}
main().catch((error)=>notify(error.message,true));
