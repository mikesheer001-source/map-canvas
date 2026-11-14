import { createEnhancements, createSettingsControls, FEATURE_DEFAULTS, FEATURE_STORAGE_KEY, readFeatureSettings, saveFeatureSettings } from "./enhancements.js?v=shared-map-20261114";
const $ = (id) => document.getElementById(id);
const LOCAL_MAP_KEY = "map-canvas:manual-map-v1";
const SHARED_MAP_URL = "https://map-canvas.mikesheer001.chatgpt.site/api/shared-map";
const DETAIL_ZOOM = 16.8;
const SNAPSHOT_KEY = "map-canvas:shared-snapshot-v2";
const ICONS = ["📍","🏨","☕","🍜","🏋️","🎨","📸","📝","🏖️","🛒","⭐"];
let enhanced = null;
let settingsUI = null;
const state = {
  hostels: [], entries: [], query: "", filter: "all", sort: "default",
  provider: "openfreemap", map: null, library: null, markers: [],
  leafletGroup: null, current: null, draft: null, placing: null, visiblePins: [], emojiMarkers: [],
  labelMarkers: [], mapMoving: false, pinEventsAttached: false, styleReady: false,
  pendingPhoto: null, showLabels: true, saving: false, listOpen: false,
  category: "all", undo: [], redo: [], historyBusy: false, gpsMarker: null,
  pendingPin: new URLSearchParams(location.search).get("pin"), localReady: false,
  revision: null, readEpoch: 0, syncInFlight: false,
  features: {...FEATURE_DEFAULTS}, remotelyDeletedIds: new Set()
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

const THEME_EMOJIS=[
  [/\b(hostel|hotel|guest\s?house|homestay|accommodation|lodging|inn|resort|motel)\b/i,"🏨"],
  [/\b(caf[eé]|coffee|espresso|latte|tea\s?house|coffeehouse)\b/i,"☕"],
  [/\b(ice\s?cream|gelato|dessert|bakery|cake|pastry|donut|doughnut)\b/i,"🍰"],
  [/\b(pizza|pizzeria)\b/i,"🍕"],
  [/\b(burger|hamburger|sandwich)\b/i,"🍔"],
  [/\b(ph[oở]|ramen|noodle|sushi|asian food|vietnamese food)\b/i,"🍜"],
  [/\b(restaurant|food|eatery|diner|bistro|buffet|grill|steakhouse)\b/i,"🍽️"],
  [/\b(gym|fitness|workout|exercise|weightlifting|bodybuilding)\b/i,"🏋️"],
  [/\b(yoga|pilates|meditation)\b/i,"🧘"],
  [/\b(stadium|football|soccer|sport|tennis|basketball|badminton|volleyball)\b/i,"⚽"],
  [/\b(swim|pool|waterpark|aquatic)\b/i,"🏊"],
  [/\b(museum|gallery|exhibition|art)\b/i,"🎨"],
  [/\b(monument|historic|history|heritage|temple|pagoda|shrine|church|cathedral)\b/i,"🏛️"],
  [/\b(park|garden|forest|nature|botanical|hiking|trail)\b/i,"🌳"],
  [/\b(beach|island|coast|seaside)\b/i,"🏖️"],
  [/\b(lake|river|waterfall|viewpoint|scenic|lookout)\b/i,"🏞️"],
  [/\b(shop|shopping|store|mall|market|boutique|supermarket)\b/i,"🛍️"],
  [/\b(pharmacy|drugstore|chemist)\b/i,"💊"],
  [/\b(hospital|clinic|doctor|medical|dentist|dental)\b/i,"🏥"],
  [/\b(salon|haircut|barber|spa|massage|beauty)\b/i,"💇"],
  [/\b(bar|pub|cocktail|nightclub|club|nightlife|karaoke)\b/i,"🎵"],
  [/\b(cinema|movie|theater|theatre|film)\b/i,"🎬"],
  [/\b(bookstore|bookshop|library|books)\b/i,"📚"],
  [/\b(school|university|college|education|class)\b/i,"🎓"],
  [/\b(airport|flight|airline)\b/i,"✈️"],
  [/\b(train|railway|metro|subway|station)\b/i,"🚆"],
  [/\b(bus|coach|shuttle)\b/i,"🚌"],
  [/\b(ferry|boat|pier|marina|harbor|harbour)\b/i,"⛴️"],
  [/\b(motorbike|motorcycle|scooter|bicycle|bike|rental)\b/i,"🛵"],
  [/\b(bank|atm|exchange|finance)\b/i,"🏦"],
  [/\b(photo|photography|camera)\b/i,"📸"],
  [/\b(note|memo|reminder)\b/i,"📝"]
];
function pinEmoji(entry){
  // An explicitly selected non-default icon wins over automatic categorization.
  const custom=String(entry?.icon||"");
  if(custom!=="📍"&&ICONS.includes(custom))return custom;
  const theme=[entry?.category,entry?.layer,entry?.title].filter(Boolean)
    .join(" ").normalize("NFD").replace(/\p{M}/gu,"");
  for(const [pattern,emoji] of THEME_EMOJIS)if(pattern.test(theme))return emoji;
  if(entry?.source==="hostel")return "🏨";
  return "📍";
}
function clearEmojiMarkers(){
  for(const marker of state.emojiMarkers){try{marker.remove();}catch{}}
  state.emojiMarkers=[];
}
function renderEmojiMarkers(entries){
  clearEmojiMarkers();
  if(!state.map||state.library!=="maplibre")return;
  for(const entry of entries){
    if(!Number.isFinite(Number(entry.lat))||!Number.isFinite(Number(entry.lng)))continue;
    const el=text("div",pinEmoji(entry),"emoji-pin");
    el.setAttribute("aria-hidden","true");
    el.title=entry.title||"Map pin";
    el.style.pointerEvents="none";
    const marker=new window.maplibregl.Marker({
      element:el,anchor:"center",subpixelPositioning:true
    }).setLngLat([Number(entry.lng),Number(entry.lat)]).addTo(state.map);
    state.emojiMarkers.push(marker);
  }
}

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

function setMapEntries(items){
  if(!Array.isArray(items)||items.length>500)throw new Error("Invalid map file");
  const ids=new Set();
  state.entries=items.map((e,i)=>{
    if(!e||typeof e!=="object"||typeof e.id!=="string"||!e.id||
      ids.has(e.id)||!Number.isFinite(Number(e.lat))||
      !Number.isFinite(Number(e.lng))||Math.abs(Number(e.lat))>85||
      Math.abs(Number(e.lng))>180)
      throw new Error("Invalid pin at row "+(i+1));
    ids.add(e.id);
    return {...e,lat:Number(e.lat),lng:Number(e.lng),
      icon:e.icon||"📍",color:validColor(e.color)?e.color:"#245c48",
      source:e.source||"local"};
  });
  state.hostels=[];
  render();
}
function readMapCache(){
  try{const raw=localStorage.getItem(SNAPSHOT_KEY);
    return raw?JSON.parse(raw):null;}catch{return null;}
}
function storeMapSnapshot(items){
  setMapEntries(items);
  try{localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(items));}catch{}
}
async function requestShared(path, options={}){
  let response;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{response=await fetch(SHARED_MAP_URL+path,{cache:"no-store",...options,signal:controller.signal});}
  catch{throw new Error("Could not reach the shared map. Check your connection and retry.");}
  finally{clearTimeout(timeout);}
  let data;
  try{data=await response.json();}catch{throw new Error("The shared map returned an invalid response. Retry.");}
  if(response.status===409)throw new Error("The map changed on another device. Refresh and retry.");
  if(!response.ok)throw new Error(data.error||"Could not save to the shared map. Retry.");
  return data;
}
function jsonOptions(method,body){
  return {method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)};
}
async function loadHostels(){
  if(state.syncInFlight||state.saving)return;
  state.syncInFlight=true;
  const epoch=state.readEpoch;
  try{
    const data=await requestShared("/pins");
    if(epoch!==state.readEpoch||state.saving)return;
    if(state.localReady&&state.revision===data.revision)return;
    const selectedVersion=state.current?.version;
    state.revision=data.revision;
    state.localReady=true;
    storeMapSnapshot(data.entries);
    if(state.current&&!$("detailPanel").classList.contains("hidden")){
      const selected=state.entries.find(entry=>entry.id===state.current.id);
      if(!selected){hideDetail();notify("This pin was deleted from the shared map.");}
      else if(selected.version!==selectedVersion)choose(selected,false);
    }
  }finally{state.syncInFlight=false;}
  $("syncState").textContent="Shared map synced";
  $("statusText").textContent="Shared map · changes appear on all devices";
  $("statusPip").classList.add("connected");
}
async function reloadShared(silent){
  try{await loadHostels();if(!silent)notify("Shared map refreshed.");}
  catch(error){
    state.localReady=false;
    $("syncState").textContent="Connection lost · retry";
    $("statusText").textContent="Showing saved map · reconnect to edit";
    $("statusPip").classList.remove("connected");
    render();
    if(!silent)notify(error.message,true);
  }
}
function downloadLegacyEdits(){
  const saved=localStorage.getItem(LOCAL_MAP_KEY);
  if(!saved)return;
  const url=URL.createObjectURL(new Blob([saved],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download="map-canvas-previous-browser-edits.json";
  link.click();setTimeout(()=>URL.revokeObjectURL(url),4000);
}
async function importPins(imported,mode){
  if(!state.localReady||state.saving)throw new Error("Connect to the shared map and retry.");
  if(state.syncInFlight)throw new Error("The shared map is syncing. Retry the import.");
  await loadHostels();
  state.saving=true;state.readEpoch++;
  try{
    const entries=[];
    for(const entry of imported)entries.push(await uploadEntryPhotos(entry));
    const data=await requestShared("/import",jsonOptions("POST",{entries,mode,expectedRevision:state.revision}));
    state.revision=data.revision;storeMapSnapshot(data.entries);
    state.undo=[];state.redo=[];updateHistoryButtons();
    return data;
  }finally{state.saving=false;updateHistoryButtons();}
}
function filterEntries() {
  const needle = (state.features.search?state.query:"").toLowerCase().trim();
  const shown = allEntries().filter((e) =>
    (!state.features.filters || state.category === "all" || e.category === state.category)
    && (!state.features.filters || state.filter === "all" || state.filter === e.kind)
    && [e.title, e.notes, e.category, e.price, e.rating]
      .some((x) => String(x || "").toLowerCase().includes(needle)));
  if (state.features.filters && state.sort === "price") shown.sort((a,b) =>
    (Number(String(a.price).replace(/[^\d.]/g, "")) || Infinity)
    - (Number(String(b.price).replace(/[^\d.]/g, "")) || Infinity));
  if (state.features.filters && state.sort === "title") shown.sort((a,b) => a.title.localeCompare(b.title));
  if (state.features.filters && state.sort === "rating") shown.sort((a,b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
  return enhanced ? enhanced.visible(shown) : shown;
}
function render() {
  enhanced?.selections();
  const shown = filterEntries();
  renderCategories();
  updateHistoryButtons();
  $("pinCount").textContent = allEntries().length + " pins · shared map";
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
    const ico = text("span", pinEmoji(entry), "entry-ico");
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
  lines.append(text("strong", pinEmoji(entry) + " " + entry.title));
  const extra = [entry.price, entry.rating ? "★ " + entry.rating : ""].filter(Boolean).join(" · ");
  if (extra) lines.append(text("small", extra));
  else if (entry.kind === "note" && entry.notes) lines.append(text("small", entry.notes.slice(0, 55)));
  label.append(lines);
  root.append(label);
  return root;
}
function updateLabels() {
  clearLabelMarkers();
  const expanded = state.showLabels && state.features.labels && mapZoom() >= DETAIL_ZOOM &&
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
  attr($("toggleLabels"), "aria-pressed", state.showLabels && state.features.labels);
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
    if(enhanced?.isDrawing() || enhanced?.consumeDragClick())return;
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
  clearEmojiMarkers();
  if (!state.map) return;
  if (state.library === "maplibre") {
    if (!state.styleReady) return;
    const data = pinGeoJSON(entries);
    const source = state.map.getSource(PIN_SOURCE);
    // Every feature stays separate at every zoom. Native GeoJSON remains
    // underneath emoji markers for precise hit-testing and pin dragging.
    if (source) source.setData(data);
    else state.map.addSource(PIN_SOURCE,{type:"geojson",data,cluster:false});
    if (!state.map.getLayer(PIN_DOTS)) {
      state.map.addLayer({
        id:PIN_DOTS,source:PIN_SOURCE,type:"circle",
        paint:{
          "circle-radius":["case",["==",["get","id"],state.current?.id||""],10,8],
          "circle-color":["get","color"],
          "circle-opacity":0.008
        }
      });
    } else {
      state.map.setPaintProperty(PIN_DOTS,"circle-radius",
        ["case",["==",["get","id"],state.current?.id||""],10,8]);
    }
    if (!state.map.getLayer(PIN_TOUCH)) {
      state.map.addLayer({
        id:PIN_TOUCH,source:PIN_SOURCE,type:"circle",
        paint:{"circle-radius":20,"circle-color":"#fff","circle-opacity":0.005}
      });
    }
    attachMapPinClicks(state.map);
    renderEmojiMarkers(entries);
  } else if (state.library === "leaflet") {
    for (const marker of state.markers) { try { marker.remove(); }catch {} }
    state.markers = [];
    for (const entry of entries) {
      if (!Number.isFinite(Number(entry.lat)) || !Number.isFinite(Number(entry.lng))) continue;
      const owned=!!getKey(entry.id)&&state.localReady;
      const emoji=pinEmoji(entry);
      const marker=window.L.marker([Number(entry.lat),Number(entry.lng)],{
        draggable:owned,keyboard:true,bubblingMouseEvents:false,
        icon:window.L.divIcon({
          className:"leaflet-emoji-marker",
          html:'<span class="emoji-pin-inner">'+emoji+'</span>',
          iconSize:[34,34],iconAnchor:[17,17]
        })
      }).addTo(state.map);
      if(owned)enhanced?.leafletDrag(marker,entry);
      marker.on("click",()=>{
        if(enhanced?.isDrawing())return;
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
function openFreeMapStyle(){
  return state.features.darkTheme
    ?"https://tiles.openfreemap.org/styles/dark"
    :"https://tiles.openfreemap.org/styles/liberty";
}
function changeProvider(provider) {
  if (!["openfreemap","openstreetmap"].includes(provider)) return;
  state.provider = provider;
  document.documentElement.dataset.mapProvider=provider;
  paintProvider();
  $("basemapSwitch").classList.add("hidden");
  attr($("basemapButton"),"aria-expanded",false);
  if (state.library === "maplibre") {
    clearNotice();
    state.styleReady = false;
    clearLabelMarkers();
    state.map.setStyle(provider === "openfreemap"
      ? openFreeMapStyle() : osmStyle);
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
  state.map.on("click",(e)=>{
    if(enhanced?.handleTap({lng:e.latlng.lng,lat:e.latlng.lat}))return;
    if(state.placing)placeAt({lat:e.latlng.lat,lng:e.latlng.lng});
  });
  state.map.on("movestart",()=>{state.mapMoving=true;clearLabelMarkers();});
  state.map.on("moveend",()=>{state.mapMoving=false;updateLabels();enhanced?.renderOverlay();});
  state.map.on("move",()=>enhanced?.renderOverlay());
  state.map.on("mousemove",e=>enhanced?.updateHover({lng:e.latlng.lng,lat:e.latlng.lat}));
  state.map.on("zoomend",updateLabels);
  state.library="leaflet";
  state.styleReady=true;
  state.provider="openstreetmap";
  document.documentElement.dataset.mapProvider="openstreetmap";
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
      style:openFreeMapStyle(),
      attributionControl:true,maxZoom:19
    });
    state.map=map;state.library="maplibre";
    map.addControl(new lib.NavigationControl({showCompass:false}),"bottom-right");
    let started=false;
    map.on("load",()=>{started=true;state.styleReady=true;clearNotice();renderMarkers(filterEntries());});
    map.on("style.load",()=>{state.styleReady=true;renderMarkers(filterEntries());});
    map.on("movestart",()=>{state.mapMoving=true;clearLabelMarkers();});
    map.on("moveend",()=>{state.mapMoving=false;updateLabels();enhanced?.renderOverlay();});
    map.on("move",()=>enhanced?.renderOverlay());
    map.on("mousemove",e=>enhanced?.updateHover(e.lngLat));
    map.on("zoomend",updateLabels);
    map.on("click",(event)=>{
      if(enhanced?.handleTap(event.lngLat))return;
      if(state.placing)placeAt(event.lngLat);
    });
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
  enhanced?.galleryDetail(entry,detail);
  if (entry.notes) detail.append(text("p",entry.notes,"detail-notes"));
  if (entry.source==="hostel") detail.append(text("small","Prices from Nov 12–14, 2026; verify current rates.","muted"));
  const actions=text("div","","detail-actions");
  if (entry.link?.startsWith("https://")) {
    const anchor=text("a","Google Maps ↗","secondary");
    anchor.href=entry.link;anchor.rel="noopener noreferrer";anchor.target="_blank";actions.append(anchor);
  }
  actions.append(button("Share link",()=>sharePin(entry),"secondary"));
  actions.append(button("Edit",()=>{hideDetail();openEditor(entry);},"secondary"));
  const deleteButton=button("Delete pin",()=>removeEntry(entry),"danger");
  deleteButton.id="deleteSelectedPin";
  deleteButton.disabled=!state.localReady;
  deleteButton.title="Delete from the shared map";
  actions.append(deleteButton);
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
  $("editorTitle").textContent=allEntries().some(e=>e.id===entry.id)?"Edit map entry":"New map entry";
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
  $("saveNote").textContent="Saves to the shared map on all devices.";
  $("saveEntry").disabled=false;
  enhanced?.editorOpen(entry);
  $("editor").showModal();
}
function closeEditor() {$("editor").close();state.draft=null;}
function getKey(){return "local";}
function saveKey(){}
function randomKey(){return crypto.randomUUID();}
async function submitChange(action,entry){
  if(!state.localReady)throw new Error("Connect to the shared map and retry.");
  state.readEpoch++;
  const path="/pins/"+encodeURIComponent(entry.id);
  let data;
  if(action==="delete"){
    data=await requestShared(path,jsonOptions("DELETE",{expectedVersion:entry.version}));
    storeMapSnapshot(allEntries().filter(pin=>pin.id!==entry.id));
  }else if(action==="save"){
    const value=await uploadEntryPhotos(entry);
    const expectedVersion=Number.isInteger(entry.version)?entry.version:null;
    data=await requestShared(path,jsonOptions("PUT",{entry:value,expectedVersion}));
    const items=allEntries().slice();
    const index=items.findIndex(pin=>pin.id===entry.id);
    if(index<0)items.push(data.entry);else items[index]=data.entry;
    storeMapSnapshot(items);
  }else throw new Error("Invalid action");
  return data;
}
async function uploadEntryPhotos(entry){
  async function upload(value){
    if(typeof value!=="string"||!value.startsWith("data:image/"))return value;
    const blob=await (await fetch(value)).blob();
    const form=new FormData();form.append("photo",blob,"photo.jpg");
    const result=await requestShared("/photo",{method:"POST",body:form});
    return result.photo;
  }
  return {...entry,photo:await upload(entry.photo),
    gallery:await Promise.all((entry.gallery||[]).map(upload))};
}
async function saveEntry(event) {
  event.preventDefault();if(state.saving||!state.draft)return;
  const entry={...state.draft,
    title:$("title").value.trim(),category:$("category").value.trim(),kind:state.draft.kind,
    notes:$("notes").value.trim(),price:$("price").value.trim(),rating:$("rating").value.trim(),
    icon:$("pinIcon").value,color:$("pinColor").value
  };
  try{enhanced?.collectEditor(entry);}catch(error){notify(error.message,true);return;}
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
  finally{state.saving=false;$("saveEntry").textContent="Save pin";$("saveEntry").disabled=false;updateHistoryButtons();}
}
async function removeEntry(entry){
  if(state.saving)return;
  state.saving=true;
  const control=$("deleteSelectedPin");
  if(control){control.disabled=true;control.textContent="Deleting…";}
  try{
    const before=allEntries().find(e=>e.id===entry.id);
    const result=await submitChange("delete",entry);
    if(before)recordChange({before,after:null,version:result.version});
    hideDetail();
    notify("Pin deleted from the shared map. Use Undo to restore it.");
  }catch(error){notify(error.message,true);}
  finally{state.saving=false;if(control){control.disabled=false;control.textContent="Delete pin";}updateHistoryButtons();}
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
  if (!state.draft) {
    state.pendingPhoto=file;
    const draft={id:crypto.randomUUID(),title:"Picture",kind:"photo",category:"",price:"",
      rating:"",notes:"",photo:"",version:"",layer:"Pictures",group:"",
      gallery:[],canvas:{type:"image",width:210},icon:"📸",color:"#245c48"};
    startPlacement("photo",draft);return;
  }
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
  change.version=change.version??change.after?.version;
  state.undo.push(change);
  if(state.undo.length>30)state.undo.shift();
  state.redo=[];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  for(const [id,available] of [["undoBtn",state.undo.length],["redoBtn",state.redo.length]]) {
    const el=$(id);
    if(el)el.disabled=state.historyBusy||state.saving||!available;
  }
}
async function replayHistory(direction) {
  if(state.historyBusy||state.saving)return;
  const from=direction==="undo"?state.undo:state.redo;
  const to=direction==="undo"?state.redo:state.undo;
  if(!from.length)return;
  const item=from[from.length-1];
  const desired=direction==="undo"?item.before:item.after;
  const id=(item.after||item.before).id;
  const current=state.entries.find(e=>e.id===id)||null;
  state.historyBusy=true;updateHistoryButtons();
  try {
    if(current&&current.version!==item.version)
      throw new Error("This pin changed on another device. Refresh and review it first.");
    if(desired) {
      const result=await submitChange("save",{...desired,version:item.version});
      item.version=result.entry.version;
    } else if(current) {
      const result=await submitChange("delete",current);
      item.version=result.version;
    } else throw new Error("This pin is already deleted.");
    from.pop();to.push(item);
    const next=[...from].reverse().find(change=>(change.after||change.before).id===id);
    const adjacent=direction==="undo"
      ?next?.after?.version===item.before?.version
      :next?.before?.version===item.after?.version;
    if(next&&adjacent)next.version=item.version;
    notify(direction==="undo"?"Change undone.":"Change redone.");
  } catch(e){notify("Cannot "+direction+": "+e.message,true);}
  finally{state.historyBusy=false;updateHistoryButtons();}
}
function setupOffline() {
  const status=$("offlineState");
  const refresh=()=>{
    status.textContent=navigator.onLine?"":"Offline · cached map data only";
    status.classList.toggle("hidden",navigator.onLine);
  };
  window.addEventListener("online",refresh);
  window.addEventListener("offline",refresh);
  refresh();
  if("serviceWorker" in navigator && location.protocol==="https:")
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
}


const FEATURE_TARGETS={
  search:[".searchwrap"],filters:[".filters","#categoryFilter","#sort"],
  layers:[".collection-selects",".layers-panel"],
  importExport:[".io-actions"],addPins:["#addButton"],
  canvasObjects:[],galleries:["#galleryControls"],
  undoRedo:["#undoBtn","#redoBtn"],labels:["#toggleLabels"],
  gps:["#locateButton"],
  basemaps:["#basemapButton"],navigation:["#zoomIn","#zoomOut","#fitPins"],
};
function applyFeatureSettings(changedKey=null){
  for(const [key,selectors] of Object.entries(FEATURE_TARGETS)){
    for(const selector of selectors)
      document.querySelectorAll(selector).forEach(node=>
        node.classList.toggle("feature-hidden",!state.features[key]));
  }
  if(!state.features.basemaps){
    $("basemapSwitch").classList.add("hidden");
    $("basemapButton").setAttribute("aria-expanded","false");
  }
  if(!state.features.gps && state.gpsMarker){
    state.gpsMarker.remove();state.gpsMarker=null;
  }
  const dark=!!state.features.darkTheme;
  const requestedTheme=dark?"dark":"light";
  const oldTheme=document.documentElement.dataset.theme||"light";
  document.documentElement.dataset.theme=requestedTheme;
  document.documentElement.dataset.mapProvider=state.provider;
  const themeButton=$("themeToggle");
  if(themeButton){
    themeButton.textContent=dark?"☀":"☾";
    themeButton.title=dark?"Switch to light theme":"Switch to dark theme";
    themeButton.setAttribute("aria-pressed",String(dark));
    themeButton.setAttribute("aria-label",dark?"Light mode":"Dark mode");
  }
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=dark?"#121c1b":"#f9faf7";
  if(oldTheme!==requestedTheme && state.map && state.library==="maplibre" && state.provider==="openfreemap"){
    state.styleReady=false;
    clearLabelMarkers();
    state.map.setStyle(openFreeMapStyle());
  }
  updateLabels();
  render();
}
function setFeatureSetting(key,value,persist=true){
  if(key && Object.hasOwn(FEATURE_DEFAULTS,key))state.features[key]=value===true;
  if(persist)settingsUI?.status(saveFeatureSettings(state.features));
  if(persist || key===null){
    applyFeatureSettings(key);
    settingsUI?.sync();
  }
}

function wire() {
  $("refreshBtn").addEventListener("click",()=>reloadShared(false));
  $("downloadLegacyBtn").addEventListener("click",downloadLegacyEdits);
  $("themeToggle").addEventListener("click",()=>setFeatureSetting("darkTheme",!state.features.darkTheme));
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
    enhanced?.clearMeasurement();
  });
  $("zoomIn").addEventListener("click",()=>state.map?.zoomIn());
  $("zoomOut").addEventListener("click",()=>state.map?.zoomOut());
  $("fitPins").addEventListener("click",fitPins);
  $("toggleLabels").addEventListener("click",()=>setFeatureSetting("labels",!state.features.labels));
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
  state.features=readFeatureSettings();
  enhanced=createEnhancements({state,DETAIL_ZOOM,PIN_SOURCE,
    allEntries,filterEntries,pinGeoJSON,render,notify,safeImage,openEditor,
    startPlacement,placeAt,choose,getKey,saveKey,randomKey,submitChange,recordChange,
    reloadShared,importPins,mapZoom});
  wire();
  // An optional feature must never prevent the base map from initializing.
  try{enhanced.init();}catch(error){
    console.error("Canvas tools could not initialize:",error);
    notify("Some map tools failed to load. Refresh to get the newest version.",true);
  }
  settingsUI=createSettingsControls({state,onChange:setFeatureSetting});
  settingsUI.init();
  applyFeatureSettings();
  window.addEventListener("storage",event=>{
    if(event.key===FEATURE_STORAGE_KEY){
      state.features=readFeatureSettings();
      applyFeatureSettings();
      settingsUI.sync();
    }
  });
  setupOffline();
  try {
    if(localStorage.getItem(LOCAL_MAP_KEY)){
      $("downloadLegacyBtn").classList.remove("hidden");
      $("legacyHelp").classList.remove("hidden");
    }
  }catch{}
  try {await loadHostels();}catch(error){
    const cached=readMapCache();
    if(cached){try{setMapEntries(cached);notify("Offline: using saved browser map.");}
      catch(e){notify(e.message,true);}}
    else {
      try{
        const response=await fetch("./data/public-map.json",{cache:"no-store"});
        if(response.ok)setMapEntries(await response.json());
      }catch{}
      notify("Shared map unavailable: "+error.message,true);
    }
    state.localReady=false;
    $("syncState").textContent="Connection lost · retry";
    $("statusText").textContent="Showing saved map · reconnect to edit";
  }
  render();
  await initMap();
  render();
  applyDeepLink();
  setInterval(()=>reloadShared(true),5000);
  window.addEventListener("online",()=>reloadShared(true));
}
// Read-only development inspection. Unavailable on public GitHub Pages.
if (["127.0.0.1","localhost"].includes(location.hostname)) {
  window.__mapCanvasTest = {
    getMap: () => state.map,
    getLibrary: () => state.library,
    getEntries: () => allEntries(),
    getPins: () => state.visiblePins,
    getFeatures: () => ({...state.features}),
    getDeletedPins: () => [],
    getLocalPins: () => allEntries()
  };
}
main().catch((error)=>notify(error.message,true));
