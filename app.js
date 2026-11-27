import { fetchRoutePin } from "./route-pins.mjs?v=routed-diamonds-20261128";
import { createEnhancements, createSettingsControls, FEATURE_DEFAULTS, FEATURE_STORAGE_KEY, PIN_PHOTO_MIN_ZOOM, readFeatureSettings, saveFeatureSettings, PIN_VISIBILITY_KEY, pinThemeVisible, readPinVisibility, savePinVisibility } from "./enhancements.js?v=pin-sizing-20261128";
import { enqueueOfflineChange, getQueuedChange, listQueuedChanges, removeQueuedChange, markQueuedConflict, listOfflineAreas, mergePendingChanges, stripOfflineFlags, formatOfflineBytes } from "./offline-store.mjs?v=offline-areas-20261127";
import { countOfflineTiles, OFFLINE_TILE_LIMITS } from "./offline-tiles.mjs?v=offline-areas-20261127";
import { TRANSITOUS_ENABLED, searchTransportOptions, renderTransportOptions, toLocalDateTimeISO, RESEARCH_CACHE_MS } from "./transport-options.mjs?v=transport-options-20261127";
import { createItinerary, cloneItinerary, createPinStop, createCustomStop, addStopToItinerary, removeStopFromItinerary, moveItineraryStop, addItineraryDay, removeItineraryDay, setItineraryDayDate, setItineraryName, setItineraryLegRoute, setItineraryLegOption, readSavedItineraries, saveSavedItineraries, deleteSavedItinerary, renderItineraryBuilder } from "./itinerary.mjs?v=itinerary-delete-20261127";
const $ = (id) => document.getElementById(id);
const LOCAL_MAP_KEY = "map-canvas:manual-map-v1";
const SHARED_MAP_URL = "https://map-canvas-api.mikesheer001.workers.dev/api/shared-map";
const DETAIL_ZOOM = 16.8;
const MAX_ROUTE_STOPS = 500;
const TRANSPORT_MODE_STYLES={
  bus:{label:"Bus",emoji:"🚌",color:"#d28a21",dash:[1.5,2]},
  train:{label:"Train",emoji:"🚆",color:"#8658b5",dash:[4,2]},
  flight:{label:"Flight",emoji:"✈️",color:"#397bd2",dash:[2,2]},
  ferry:{label:"Ferry",emoji:"⛴️",color:"#0b91a9",dash:[5,2]},
  driving:{label:"Driving",emoji:"🚗",color:"#23865b",dash:[]}
};
const TRANSPORT_ROUTE_STORAGE_KEY="map-canvas:multimodal-routes-v1";
const TRANSPORT_LAYER_IDS=Object.keys(TRANSPORT_MODE_STYLES).flatMap(mode=>[
  "canvas-transport-"+mode+"-hit","canvas-transport-"+mode
]);

function formatRouteDistance(meters){
  const value=Number(meters);
  if(!Number.isFinite(value)||value<0)return "—";
  if(value<1000)return Math.round(value)+" m";
  return (value/1000).toFixed(value>=100000?0:1)+" km";
}
function formatRouteDuration(seconds){
  const value=Number(seconds);
  if(!Number.isFinite(value)||value<0)return "—";
  const minutes=Math.round(value/60),hours=Math.floor(minutes/60),remainder=minutes%60;
  if(!hours)return minutes+" min";
  return hours+" hr"+(remainder?" "+remainder+" min":"");
}
const SNAPSHOT_KEY = "map-canvas:shared-snapshot-v2";
const REVISION_KEY = "map-canvas:shared-revision-v1";
const openDetails=new Map();
let offlineRegistration=null;
let offlineDownloadId=null;
let offlineAreaBounds=null;

const SENSITIVITY_KEY="map-canvas:popup-sensitivity";
const PHOTO_SIZE_KEY="map-canvas:photo-size";
const PIN_SIZE_KEY="map-canvas:pin-size";
const DETAIL_SIZE_KEY="map-canvas:detail-size";
const DETAIL_AUTO_CLOSE_KEY="map-canvas:detail-auto-close-seconds";
const DEFAULT_DETAIL_AUTO_CLOSE=30;
const normalizeDetailAutoClose=value=>value==null||value===""||!Number.isFinite(Number(value))?DEFAULT_DETAIL_AUTO_CLOSE:Math.max(0,Math.min(120,Math.round(Number(value)/5)*5));
let detailAutoClose=DEFAULT_DETAIL_AUTO_CLOSE;
try{detailAutoClose=normalizeDetailAutoClose(globalThis.localStorage?.getItem(DETAIL_AUTO_CLOSE_KEY));}catch{}
const normalizePinSize=value=>Math.max(50,Math.min(200,Number(value)||100));
const normalizePhotoSize=value=>Math.max(100,Math.min(800,Number(value)||100));
let popupSensitivity=2;
let photoSize=100;
let pinSize=100,detailSize=100;
try{pinSize=normalizePinSize(globalThis.localStorage?.getItem(PIN_SIZE_KEY));detailSize=normalizePinSize(globalThis.localStorage?.getItem(DETAIL_SIZE_KEY));}catch{}
try{popupSensitivity=Number(globalThis.localStorage?.getItem(SENSITIVITY_KEY))||2;}catch{}
try{photoSize=normalizePhotoSize(globalThis.localStorage?.getItem(PHOTO_SIZE_KEY));}catch{}
popupSensitivity=Math.max(0.5,Math.min(4,popupSensitivity));
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
  revision: null, readEpoch: 0, syncInFlight: false, syncingQueue: false,
  features: {...FEATURE_DEFAULTS}, hiddenPinThemes: new Set(), remotelyDeletedIds: new Set(),
  routeSelectedIds: [], routeSelecting: false, routeOptimizing: false, routeError: null,
  routeProgress: null, optimizedRoute: null, routeLayer: null, routeRequestId: 0, routeAbortController: null,
  transportRoutes: [], transportSelecting: false, transportDraft: null, transportBusy: false,
  transportError: null, transportLayer: null, transportInfoRouteId: null,
  transportResearchRequestId: 0, transportResearchAbortController: null, transportResearchRouteId: null,
  transportResearchBusy: false, transportResearchError: null,
  itineraries: [], itineraryDraft: null, itineraryActiveId: null, itineraryDirty: false, itineraryDeletePendingId: null,
  itineraryBusy: false, itineraryError: null, itineraryRequestId: 0
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
function isRoutePin(entry){return entry?.canvas?.type==="route"&&Array.isArray(entry.canvas.start)&&Array.isArray(entry.canvas.end);}
function routeMidpoint(start,end){return {lng:(start[0]+end[0])/2,lat:(start[1]+end[1])/2};}
function pinEmoji(entry){
  if(isRoutePin(entry))return "↔";
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
function isRecentPin(entry, now=Date.now()){
  const age=now-Number(entry.createdAt);
  return Number.isFinite(age)&&age>=0&&age<24*60*60*1000;
}
function pinPassesAgeFilter(entry){
  return !state.features.recentPinsOnly || isRecentPin(entry);
}
function pinPassesRouteFilter(entry){return state.features.showRoutePins || !isRoutePin(entry);}
function makeEmojiPin(entry,className){
  const emoji=pinEmoji(entry);
  const pin=text("span",emoji,className);
  pin.style.setProperty("--pin-size-factor",String(pinSize/100));
  pin.title=entry.title||"Map pin";
  if(isRoutePin(entry))pin.classList.add("route-pin");
  if(isRecentPin(entry)){pin.classList.add("recent-pin");pin.title+=" · Added within 24hrs";}
  if(!state.features.pinRatings||isRoutePin(entry))return pin;
  const rating=String(entry.rating??"").trim().match(/^([0-5](?:\.\d+)?)(?:\s*\(([\d,]+) reviews?\))?$/i);
  if(!rating || Number(rating[1])>5){
    pin.classList.add("has-rating");
    pin.textContent="";
    pin.append(text("span",emoji),text("span","N/A","pin-rating"));
    pin.title+=" · Google rating unavailable";
    return pin;
  }
  const count=(rating[2]||String(entry.notes??"").match(/^Listed rating: [\d.]+ \(([\d,]+) reviews?\)$/im)?.[1]||"").replaceAll(",","");
  const score=Number(rating[1]).toFixed(1);
  pin.className+=" has-rating";
  pin.textContent="";
  pin.append(text("span",emoji),text("span",count ? `${score}·${count}` : score,"pin-rating"));
  pin.title+=` · Google ${score}/5${count ? ` (${Number(count).toLocaleString("en-US")} ratings)` : ""}`;
  return pin;
}
function renderEmojiMarkers(entries){
  clearEmojiMarkers();
  if(!state.map||state.library!=="maplibre")return;
  for(const entry of entries){
    if(!Number.isFinite(Number(entry.lat))||!Number.isFinite(Number(entry.lng)))continue;
    const el=makeEmojiPin(entry,"emoji-pin");
    el.setAttribute("aria-hidden","true");
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
function readCachedRevision(){
  try{const value=Number(localStorage.getItem(REVISION_KEY));return Number.isSafeInteger(value)&&value>=0?value:null;}
  catch{return null;}
}
function storeMapSnapshot(items){
  setMapEntries(items);
  try{
    localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(items));
    if(Number.isSafeInteger(state.revision))localStorage.setItem(REVISION_KEY,String(state.revision));
  }catch{}
}
async function requestShared(path, options={}){
  let response;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{response=await fetch(SHARED_MAP_URL+path,{cache:"no-store",...options,signal:controller.signal});}
  catch{
    const error=new Error("Could not reach the shared map. Check your connection and retry.");
    error.offline=true;
    throw error;
  }finally{clearTimeout(timeout);}
  let data;
  try{data=await response.json();}catch{
    const error=new Error("The shared map returned an invalid response. Retry.");
    error.status=response.status;
    throw error;
  }
  if(response.status===409){
    const error=new Error("The map changed on another device. Your offline edit was kept as a conflict; review before retrying.");
    error.status=409;
    throw error;
  }
  if(!response.ok){
    const error=new Error(data.error||"Could not save to the shared map. Retry.");
    error.status=response.status;
    throw error;
  }
  return data;
}
function jsonOptions(method,body){
  return {method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)};
}
async function flushQueuedChanges(){
  let queued=[];
  try{queued=await listQueuedChanges();}catch{return {synced:0,attempted:false};}
  let synced=0,attempted=false;
  state.syncingQueue=queued.length>0;
  try{
    for(const change of queued){
      if(change.status==="conflict")continue;
      attempted=true;
      try{
        const path="/pins/"+encodeURIComponent(change.pinId);
        if(change.action==="save"){
          const value=await uploadEntryPhotos(stripOfflineFlags(change.entry));
          const result=await requestShared(path,jsonOptions("PUT",{
            entry:value,expectedVersion:change.expectedVersion
          }));
          if(Number.isSafeInteger(result.revision))state.revision=result.revision;
          const items=allEntries().slice();
          const index=items.findIndex(pin=>pin.id===change.pinId);
          if(index<0)items.push(result.entry);else items[index]=result.entry;
          storeMapSnapshot(items);
        }else{
          const result=await requestShared(path,jsonOptions("DELETE",{expectedVersion:change.expectedVersion}));
          if(Number.isSafeInteger(result.revision))state.revision=result.revision;
          storeMapSnapshot(allEntries().filter(pin=>pin.id!==change.pinId));
        }
        await removeQueuedChange(change.pinId);
        synced++;
      }catch(error){
        if(error.status===409||(error.status>=400&&error.status<500&&error.status!==503)){
          try{await markQueuedConflict(change.pinId,error.message);}catch{}
          continue;
        }
        break;
      }
    }
  }finally{state.syncingQueue=false;}
  return {synced,attempted};
}
async function loadHostels(){
  if(state.syncInFlight||state.saving)return;
  state.syncInFlight=true;
  const epoch=state.readEpoch;
  try{
    let data=await requestShared("/pins");
    if(epoch!==state.readEpoch||state.saving)return;
    state.localReady=true;
    let pending=[];
    try{pending=await listQueuedChanges();}catch{}
    let synced=0,refreshFailed=false;
    if(pending.length){
      const result=await flushQueuedChanges();
      synced=result.synced;
      if(result.attempted){
        try{data=await requestShared("/pins");}
        catch{refreshFailed=true;}
      }
    }
    if(epoch!==state.readEpoch||state.saving)return;
    if(!refreshFailed)state.revision=data.revision;
    try{localStorage.setItem(REVISION_KEY,String(state.revision??data.revision));}catch{}
    let remaining=[];
    try{remaining=await listQueuedChanges();}catch{}
    const serverEntries=refreshFailed?allEntries():data.entries;
    const visible=mergePendingChanges(serverEntries,remaining);
    storeMapSnapshot(visible);
    for(const [id,card] of [...openDetails]){
      const selected=state.entries.find(entry=>entry.id===id);
      if(!selected){hideDetail(id);notify("This pin was deleted from the shared map.");}
      else if(selected.version!==card.entry.version||selected.pendingSync!==card.entry.pendingSync)
        renderDetail(selected,card.node);
    }
    if(synced)notify("Synced "+synced+" offline edit"+(synced===1?"":"s")+" to the shared map.");
    $("syncState").textContent=remaining.length
      ?remaining.length+" edit"+(remaining.length===1?"":"s")+" waiting to sync"
      :"Shared map synced";
    $("statusText").textContent=remaining.some(item=>item.status==="conflict")
      ?"Offline edits need conflict review"
      :"Shared map · changes appear on all devices";
    $("statusPip").classList.toggle("connected",remaining.length===0);
    await refreshOfflineStatus();
  }finally{state.syncInFlight=false;state.syncingQueue=false;}
}
async function reloadShared(silent){
  try{await loadHostels();if(!silent)notify("Shared map refreshed.");}
  catch(error){
    const cached=readMapCache();
    state.localReady=Array.isArray(cached)||state.localReady;
    $("syncState").textContent=state.localReady?"Offline snapshot · retry sync":"Connection lost · retry";
    $("statusText").textContent=state.localReady?"Showing saved map · edits queue on this device":"No saved shared map yet · connect once to enable offline editing";
    $("statusPip").classList.remove("connected");
    render();
    await refreshOfflineStatus();
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
    for(const entry of imported){
      const previous=allEntries().find(pin=>pin.id===entry.id);
      entries.push(await uploadEntryPhotos({...entry,createdAt:previous ? (previous.createdAt??entry.createdAt) : (entry.createdAt??Date.now())}));
    }
    const data=await requestShared("/import",jsonOptions("POST",{entries,mode,expectedRevision:state.revision}));
    state.revision=data.revision;storeMapSnapshot(data.entries);
    for(const [id,card] of [...openDetails]){const pin=state.entries.find(e=>e.id===id);if(pin)renderDetail(pin,card.node);else hideDetail(id);}
    state.undo=[];state.redo=[];updateHistoryButtons();
    return data;
  }finally{state.saving=false;updateHistoryButtons();}
}
function filterEntries() {
  const needle = (state.features.search?state.query:"").toLowerCase().trim();
  const shown = allEntries().filter((e) =>
    pinThemeVisible(e,state.hiddenPinThemes)
    && pinPassesAgeFilter(e)
    && pinPassesRouteFilter(e)
    && (!state.features.filters || state.category === "all" || e.category === state.category)
    && (!state.features.filters || state.filter === "all" || state.filter === "place" ||
      (state.filter === "note" && (e.notes || e.kind === "note")) ||
      (state.filter === "photo" && (e.photo || e.gallery?.length || e.kind === "photo")))
    && [e.title, e.notes, e.category, e.price, e.rating]
      .some((x) => String(x || "").toLowerCase().includes(needle)));
  if (state.features.filters && state.sort === "price") shown.sort((a,b) =>
    (Number(String(a.price).replace(/[^\d.]/g, "")) || Infinity)
    - (Number(String(b.price).replace(/[^\d.]/g, "")) || Infinity));
  if (state.features.filters && state.sort === "title") shown.sort((a,b) => a.title.localeCompare(b.title));
  if (state.features.filters && state.sort === "rating") shown.sort((a,b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
  return enhanced ? enhanced.visible(shown) : shown;
}


function readSavedTransportRoutes(){
  try{
    const parsed=JSON.parse(localStorage.getItem(TRANSPORT_ROUTE_STORAGE_KEY)||"[]");
    if(!Array.isArray(parsed))return [];
    return parsed.filter(route=>route&&typeof route.id==="string"&&
      Object.hasOwn(TRANSPORT_MODE_STYLES,route.mode)&&
      route.geometry?.type==="LineString"&&Array.isArray(route.geometry.coordinates)&&
      route.geometry.coordinates.length>=2&&route.geometry.coordinates.length<=20000&&
      route.geometry.coordinates.every(point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])))&&
      Number.isFinite(Number(route.distanceMeters))&&Number.isFinite(Number(route.durationSeconds))&&route.from&&route.to).slice(-100);
  }catch{return [];}
}
function saveTransportRoutes(){
  try{localStorage.setItem(TRANSPORT_ROUTE_STORAGE_KEY,JSON.stringify(state.transportRoutes.slice(-100)));return true;}
  catch{notify("Routes are available for this session but could not be saved on this browser.",true);return false;}
}
function showTransportInfo(routeOrId){
  const route=typeof routeOrId==="string"?state.transportRoutes.find(item=>item.id===routeOrId):routeOrId;
  if(!route)return;
  state.transportInfoRouteId=route.id;
  $("transportInfoTitle").textContent=TRANSPORT_MODE_STYLES[route.mode]?.emoji+" "+route.modeLabel;
  $("transportInfoEndpoints").textContent=(route.from?.title||"Start")+" → "+(route.to?.title||"Destination");
  $("transportInfoDistance").textContent=formatRouteDistance(route.distanceMeters);
  $("transportInfoTime").textContent=formatRouteDuration(route.durationSeconds);
  $("transportInfoGeometry").textContent=route.geometryLabel||"Route geometry";
  $("transportInfoBasis").textContent=route.timeBasis||"Estimated travel time";
  $("transportInfo").classList.remove("hidden");
  const researchControls=$("transportResearchControls");
  if(researchControls)researchControls.hidden=!TRANSITOUS_ENABLED;
  if(TRANSITOUS_ENABLED)openTransportResearch(route);
  else{
    state.transportResearchRouteId=route.id;
    state.transportResearchBusy=false;
    state.transportResearchError=null;
    renderTransportOptions($("transportResearchResults"),route,null);
  }
}
function closeTransportInfo(){
  state.transportResearchRequestId++;
  state.transportResearchAbortController?.abort();
  state.transportResearchAbortController=null;
  state.transportResearchRouteId=null;
  state.transportResearchBusy=false;
  state.transportResearchError=null;
  state.transportInfoRouteId=null;
  $("transportInfo")?.classList.add("hidden");
}
function renderTransportResearch(route){
  if(!route||state.transportResearchRouteId!==route.id)return;
  renderTransportOptions($("transportResearchResults"),route,route.research,{
    busy:state.transportResearchBusy,error:state.transportResearchError
  });
  const refresh=$("transportResearchRefresh");
  if(refresh){refresh.disabled=state.transportResearchBusy;refresh.textContent=state.transportResearchBusy?"Researching…":"Refresh options";}
}
function setTransportResearchDefaults(){
  const dateInput=$("transportResearchDate"),timeInput=$("transportResearchTime");
  if(dateInput.value&&timeInput.value)return;
  const now=new Date(),pad=value=>String(value).padStart(2,"0");
  if(!dateInput.value)dateInput.value=now.getFullYear()+"-"+pad(now.getMonth()+1)+"-"+pad(now.getDate());
  if(!timeInput.value)timeInput.value=pad(now.getHours())+":"+pad(now.getMinutes());
}
async function openTransportResearch(route,force=false){
  if(!route||!state.transportInfoRouteId)return;
  const requestId=++state.transportResearchRequestId;
  state.transportResearchAbortController?.abort();
  state.transportResearchAbortController=null;
  state.transportResearchRouteId=route.id;
  setTransportResearchDefaults();
  let departureDateTime;
  try{
    departureDateTime=toLocalDateTimeISO($("transportResearchDate").value,$("transportResearchTime").value);
  }catch(error){
    state.transportResearchError=error.message||"Choose a valid departure date and time.";
    renderTransportResearch(route);return;
  }
  const savedAt=Date.parse(route.research?.researchedAt||"");
  if(!force&&route.research?.requestedFor===departureDateTime&&Number.isFinite(savedAt)&&Date.now()-savedAt<RESEARCH_CACHE_MS){
    state.transportResearchBusy=false;state.transportResearchError=null;renderTransportResearch(route);return;
  }
  const controller=new AbortController();
  state.transportResearchAbortController=controller;
  state.transportResearchBusy=true;state.transportResearchError=null;
  renderTransportResearch(route);
  try{
    const research=await searchTransportOptions(route,departureDateTime,{signal:controller.signal});
    if(requestId!==state.transportResearchRequestId||state.transportInfoRouteId!==route.id)return;
    route.research=research;
    state.transportResearchError=null;
    saveTransportRoutes();
  }catch(error){
    if(controller.signal.aborted||error?.name==="AbortError")return;
    if(requestId!==state.transportResearchRequestId||state.transportInfoRouteId!==route.id)return;
    state.transportResearchError=error.message||"Transport research is temporarily unavailable.";
  }finally{
    if(requestId===state.transportResearchRequestId){
      state.transportResearchAbortController=null;
      state.transportResearchBusy=false;
      renderTransportResearch(route);
    }
  }
}
function fitTransportRoute(route){
  const coords=route?.geometry?.coordinates;
  if(!coords?.length||!state.map)return;
  const valid=coords.filter(p=>Array.isArray(p)&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1])));
  if(!valid.length)return;
  const lngs=valid.map(p=>Number(p[0])),lats=valid.map(p=>Number(p[1]));
  let west=Math.min(...lngs),east=Math.max(...lngs),south=Math.min(...lats),north=Math.max(...lats);
  if(west===east){west-=0.001;east+=0.001;}if(south===north){south-=0.001;north+=0.001;}
  if(state.library==="maplibre")state.map.fitBounds([[west,south],[east,north]],{padding:72,maxZoom:15.5,duration:650});
  else if(state.library==="leaflet")state.map.fitBounds([[south,west],[north,east]],{padding:[45,45],maxZoom:16});
}
function transportRouteFeatureCollection(){
  return {type:"FeatureCollection",features:state.transportRoutes.map(route=>({
    type:"Feature",id:route.id,properties:{routeId:route.id,mode:route.mode,approximate:!!route.approximate},geometry:route.geometry
  }))};
}
function renderMultimodalRoutes(){
  if(!state.map||!state.styleReady)return;
  const data=transportRouteFeatureCollection();
  if(state.library==="maplibre"){
    const source=state.map.getSource("canvas-multimodal-routes");
    if(source)source.setData(data);
    else state.map.addSource("canvas-multimodal-routes",{type:"geojson",data});
    for(const [mode,config] of Object.entries(TRANSPORT_MODE_STYLES)){
      const filter=["==",["get","mode"],mode],hitId="canvas-transport-"+mode+"-hit",lineId="canvas-transport-"+mode;
      if(!state.map.getLayer(hitId))state.map.addLayer({
        id:hitId,type:"line",source:"canvas-multimodal-routes",filter,
        layout:{"line-cap":"round","line-join":"round"},
        paint:{"line-color":config.color,"line-width":15,"line-opacity":0.015}
      },state.map.getLayer(PIN_DOTS)?PIN_DOTS:undefined);
      if(!state.map.getLayer(lineId)){
        const paint={"line-color":config.color,"line-width":4.5,"line-opacity":0.95};
        if(config.dash.length)paint["line-dasharray"]=config.dash;
        state.map.addLayer({id:lineId,type:"line",source:"canvas-multimodal-routes",filter,
          layout:{"line-cap":"round","line-join":"round"},paint
        },state.map.getLayer(PIN_DOTS)?PIN_DOTS:undefined);
      }
    }
  }else if(state.library==="leaflet"&&window.L?.geoJSON){
    try{state.transportLayer?.remove();}catch{}
    state.transportLayer=window.L.geoJSON(data,{
      style:feature=>{
        const config=TRANSPORT_MODE_STYLES[feature.properties.mode]||TRANSPORT_MODE_STYLES.driving;
        return {color:config.color,weight:5,opacity:0.95,dashArray:config.dash.length?config.dash.map(n=>n*3).join(" "):null,lineCap:"round"};
      },
      onEachFeature:(feature,layer)=>layer.on("click",()=>showTransportInfo(feature.properties.routeId))
    }).addTo(state.map);
  }
}
function renderTransportRoutes(){
  const count=$("transportCount"),list=$("transportRoutes"),status=$("transportStatus"),add=$("transportAddRoute"),clear=$("transportClearRoutes");
  if(!count||!list||!status||!add||!clear)return;
  count.textContent=state.transportRoutes.length+" saved";
  add.textContent=state.transportSelecting?"Cancel selection":"Add route";
  add.disabled=state.transportBusy;clear.disabled=!state.transportRoutes.length||state.transportBusy;
  if(state.transportBusy)status.textContent="Looking up route geometry…";
  else if(state.transportSelecting&&!state.transportDraft?.from)status.textContent="Choose the origin pin on the map or in the list.";
  else if(state.transportSelecting)status.textContent="Origin: "+state.transportDraft.from.title+". Now choose the destination pin.";
  else if(state.transportError)status.textContent=state.transportError;
  else status.textContent="Choose a mode, add a route, then select two pins. Mapped routes are used when available; approximations are labelled.";
  list.replaceChildren();
  for(const route of [...state.transportRoutes].reverse()){
    const item=text("div","","transport-route-item");
    const open=button("",()=>{showTransportInfo(route);fitTransportRoute(route);},"transport-route-open");
    const mode=text("span",TRANSPORT_MODE_STYLES[route.mode].emoji,"transport-route-mode transport-mode-"+route.mode);
    const description=text("span","","transport-route-description");
    description.append(text("strong",(route.from?.title||"Start")+" → "+(route.to?.title||"Destination")));
    description.append(text("small",route.geometryLabel+" · "+formatRouteDistance(route.distanceMeters)));
    open.append(mode,description);
    const remove=button("×",()=>removeTransportRoute(route.id),"transport-route-remove");
    remove.setAttribute("aria-label","Remove "+route.modeLabel+" route");
    item.append(open,remove);list.append(item);
  }
}
function removeTransportRoute(id){
  state.transportRoutes=state.transportRoutes.filter(route=>route.id!==id);
  if(state.transportInfoRouteId===id)closeTransportInfo();
  saveTransportRoutes();renderTransportRoutes();renderMultimodalRoutes();renderItineraryBuilderUI();
}
function clearTransportRoutes(){
  state.transportRoutes=[];closeTransportInfo();saveTransportRoutes();renderTransportRoutes();renderMultimodalRoutes();renderItineraryBuilderUI();
}
function startTransportRoute(){
  if(state.transportBusy)return;
  if(state.transportSelecting){state.transportSelecting=false;state.transportDraft=null;state.transportError=null;renderTransportRoutes();render();return;}
  if(state.placing){state.placing?.controller?.abort();state.placing=null;$("routePinMode").disabled=false;$("placementBar").classList.add("hidden");}
  state.routeSelecting=false;
  state.transportDraft={mode:$("transportMode").value,from:null};
  state.transportSelecting=true;state.transportError=null;closeTransportInfo();
  renderTransportRoutes();render();
}
async function selectTransportPin(entry){
  if(!state.transportSelecting||!state.transportDraft)return;
  if(!Number.isFinite(Number(entry.lat))||!Number.isFinite(Number(entry.lng))){
    state.transportError="That pin has no valid map coordinates.";renderTransportRoutes();return;
  }
  if(!state.transportDraft.from){
    state.transportDraft.from={id:entry.id,title:entry.title,lat:Number(entry.lat),lng:Number(entry.lng)};
    state.transportError=null;renderTransportRoutes();render();return;
  }
  if(state.transportDraft.from.id===entry.id){state.transportError="Choose a different destination pin.";renderTransportRoutes();return;}
  const from=state.transportDraft.from,to={id:entry.id,title:entry.title,lat:Number(entry.lat),lng:Number(entry.lng)},mode=state.transportDraft.mode;
  state.transportSelecting=false;state.transportBusy=true;state.transportError=null;renderTransportRoutes();render();
  try{
    const {buildMultimodalRoute}=await import("./multimodal-routes.mjs?v=multimodal-routes-20261127");
    const route=await buildMultimodalRoute({mode,from,to,id:randomKey()});
    if(state.transportRoutes.length>=100)state.transportRoutes.shift();
    state.transportRoutes.push(route);saveTransportRoutes();state.transportDraft=null;
    renderTransportRoutes();render();showTransportInfo(route);fitTransportRoute(route);
  }catch(error){
    state.transportError=error.message||"Could not create this transport route.";
    notify(state.transportError,true);
  }finally{state.transportBusy=false;renderTransportRoutes();render();}
}

function updateItineraryDraft(updater){
  if(!state.itineraryDraft)return;
  try{state.itineraryDraft=updater(state.itineraryDraft);state.itineraryDirty=true;state.itineraryError=null;}
  catch(error){state.itineraryError=error.message||"Could not update this itinerary.";}
  renderItineraryBuilderUI();
}
function confirmDiscardItinerary(){return !state.itineraryDirty||window.confirm("Discard unsaved itinerary changes?");}
function startNewItinerary(){if(!confirmDiscardItinerary())return;state.itineraryDraft=createItinerary();state.itineraryActiveId=null;state.itineraryDeletePendingId=null;state.itineraryDirty=false;state.itineraryError=null;renderItineraryBuilderUI();}
function saveCurrentItinerary(){
  if(!state.itineraryDraft)return;
  const saved={...state.itineraryDraft,name:String(state.itineraryDraft.name||"").trim()||"Untitled itinerary",updatedAt:new Date().toISOString()};
  const next=state.itineraryActiveId?state.itineraries.map(x=>x.id===state.itineraryActiveId?saved:x):[...state.itineraries,saved];
  if(state.itineraryActiveId&&!state.itineraries.some(x=>x.id===state.itineraryActiveId))next.push(saved);
  const bounded=next.slice(-50);
  if(!saveSavedItineraries(bounded)){state.itineraryError="Could not save this itinerary in browser storage. Check available storage space.";renderItineraryBuilderUI();return;}
  state.itineraries=bounded;state.itineraryDraft=cloneItinerary(saved);state.itineraryActiveId=saved.id;state.itineraryDeletePendingId=null;state.itineraryDirty=false;state.itineraryError=null;notify("Itinerary saved in this browser.");renderItineraryBuilderUI();
}
function deleteCurrentItinerary(selectedId=state.itineraryActiveId){
  const id=selectedId||state.itineraryActiveId||state.itineraries.find(x=>x.id===state.itineraryDraft?.id)?.id;
  if(!id||!state.itineraries.some(x=>x.id===id))return;
  state.itineraryActiveId=id;
  if(state.itineraryDeletePendingId!==id){state.itineraryDeletePendingId=id;renderItineraryBuilderUI();return;}
  const result=deleteSavedItinerary(state.itineraries,id);
  if(!result.ok){state.itineraryError=result.reason==="storage"?"Could not update the saved itinerary list. Check available browser storage.":"That saved itinerary could not be found.";renderItineraryBuilderUI();return;}
  state.itineraries=result.itineraries;state.itineraryDraft=createItinerary();state.itineraryActiveId=null;state.itineraryDeletePendingId=null;state.itineraryDirty=false;state.itineraryError=null;renderItineraryBuilderUI();
}
function cancelDeleteItinerary(){state.itineraryDeletePendingId=null;renderItineraryBuilderUI();}
function selectSavedItinerary(id){
  if(!confirmDiscardItinerary())return;
  const found=state.itineraries.find(x=>x.id===id);if(!found)return;
  state.itineraryDraft=cloneItinerary(found);state.itineraryActiveId=found.id;state.itineraryDeletePendingId=null;state.itineraryDirty=false;state.itineraryError=null;renderItineraryBuilderUI();
}
async function createItineraryRoute(dayId,from,to,mode){
  if(state.itineraryBusy||!state.itineraryDraft)return;
  const draftId=state.itineraryDraft.id,requestId=++state.itineraryRequestId;state.itineraryBusy=true;state.itineraryError=null;renderItineraryBuilderUI();
  try{
    const {buildMultimodalRoute}=await import("./multimodal-routes.mjs?v=multimodal-routes-20261127");
    const route=await buildMultimodalRoute({mode,from:{id:from.sourcePinId||from.id,title:from.title,lat:Number(from.lat),lng:Number(from.lng)},to:{id:to.sourcePinId||to.id,title:to.title,lat:Number(to.lat),lng:Number(to.lng)},id:randomKey()});
    if(state.transportRoutes.length>=100)throw new Error("The saved route library is full. Remove a route before creating another.");
    state.transportRoutes.push(route);saveTransportRoutes();
    if(requestId===state.itineraryRequestId&&state.itineraryDraft?.id===draftId){
      state.itineraryDraft=setItineraryLegRoute(state.itineraryDraft,dayId,from.id,to.id,route);state.itineraryDirty=true;
    }
    renderTransportRoutes();renderMultimodalRoutes();
  }catch(error){state.itineraryError=error.message||"Could not create this itinerary route.";notify(state.itineraryError,true);}
  finally{if(requestId===state.itineraryRequestId){state.itineraryBusy=false;renderItineraryBuilderUI();}}
}
function renderItineraryBuilderUI(){
  const root=$("itineraryBuilderRoot");if(!root)return;
  const count=$("itineraryCount");if(count)count.textContent=state.itineraries.length+" saved";
  renderItineraryBuilder(root,{draft:state.itineraryDraft,saved:state.itineraries,activeId:state.itineraryActiveId,deletePendingId:state.itineraryDeletePendingId,dirty:state.itineraryDirty,busy:state.itineraryBusy,error:state.itineraryError,pins:allEntries(),routes:state.transportRoutes,actions:{
    selectSaved:selectSavedItinerary,newItinerary:startNewItinerary,save:saveCurrentItinerary,delete:deleteCurrentItinerary,cancelDelete:cancelDeleteItinerary,
    nameChange:name=>updateItineraryDraft(d=>setItineraryName(d,name)),
    addDay:()=>updateItineraryDraft(d=>addItineraryDay(d)),
    removeDay:id=>updateItineraryDraft(d=>removeItineraryDay(d,id)),
    dayDateChange:(id,date)=>updateItineraryDraft(d=>setItineraryDayDate(d,id,date)),
    addPin:(dayId,pinId)=>{const pin=allEntries().find(x=>x.id===pinId);if(!pin){state.itineraryError="That map pin is no longer available.";renderItineraryBuilderUI();return;}updateItineraryDraft(d=>addStopToItinerary(d,dayId,createPinStop(pin)));},
    addCustomStop:(id,name,lat,lng)=>updateItineraryDraft(d=>addStopToItinerary(d,id,createCustomStop(name,lat,lng))),
    removeStop:(id,stopId)=>updateItineraryDraft(d=>removeStopFromItinerary(d,id,stopId)),
    moveStop:(from,id,to,before)=>updateItineraryDraft(d=>moveItineraryStop(d,from,id,to,before)),
    selectRoute:(id,from,to,routeId)=>updateItineraryDraft(d=>setItineraryLegRoute(d,id,from,to,state.transportRoutes.find(r=>r.id===routeId)||null)),
    selectOption:(id,from,to,route,optionId)=>updateItineraryDraft(d=>setItineraryLegOption(d,id,from,to,route,optionId)),
    createRoute:createItineraryRoute
  }});
}


function clearRouteLayer(){
  if(state.library==="maplibre"&&state.map){
    try{if(state.map.getLayer("canvas-optimized-route"))state.map.removeLayer("canvas-optimized-route");}catch{}
    try{if(state.map.getSource("canvas-optimized-route"))state.map.removeSource("canvas-optimized-route");}catch{}
  }
  try{state.routeLayer?.remove();}catch{}
  state.routeLayer=null;
}
function clearRouteDisplay(){
  state.optimizedRoute=null;
  clearRouteLayer();
}
function toggleRoutePin(entry){
  if(!state.routeSelecting)return;
  if(!Number.isFinite(Number(entry.lat))||!Number.isFinite(Number(entry.lng))){
    notify("This pin has no valid map coordinates and cannot be routed.",true);
    return;
  }
  const index=state.routeSelectedIds.indexOf(entry.id);
  if(index>=0)state.routeSelectedIds.splice(index,1);
  else{
    if(state.routeSelectedIds.length>=MAX_ROUTE_STOPS){
      notify("A route can contain up to "+MAX_ROUTE_STOPS+" stops. Split larger selections into separate routes.",true);
      return;
    }
    state.routeSelectedIds.push(entry.id);
  }
  state.routeAbortController?.abort();
  state.routeRequestId++;
  state.routeOptimizing=false;
  state.routeError=null;
  state.routeProgress=null;
  clearRouteDisplay();
  render();
}
function renderRouteResult(){
  const result=$("routeResult");
  if(!result)return;
  result.replaceChildren();
  const route=state.optimizedRoute;
  result.classList.toggle("hidden",!route);
  if(!route)return;
  const metrics=text("div","","route-metrics");
  const distance=text("div","","route-metric");
  distance.append(text("strong",formatRouteDistance(route.distance)),text("small","Driving distance"));
  const duration=text("div","","route-metric");
  duration.append(text("strong",formatRouteDuration(route.duration)),text("small","Estimated driving time"));
  metrics.append(distance,duration);
  result.append(metrics);
  result.append(text("small",route.algorithm+" · no live traffic data","route-algorithm"));
  const list=document.createElement("ol");
  list.className="route-stop-list";
  for(const pin of route.ordered)list.append(text("li",pin.title||"Untitled pin"));
  result.append(list);
}
function updateRoutePlanner(){
  const toggle=$("routeSelectToggle"),status=$("routeStatus"),optimize=$("routeOptimize"),clear=$("routeClear");
  if(!toggle||!status||!optimize||!clear)return;
  const entries=new Map(allEntries().map(entry=>[entry.id,entry]));
  state.routeSelectedIds=state.routeSelectedIds.filter(id=>entries.has(id));
  toggle.textContent=state.routeSelecting?"Done selecting":"Select stops";
  attr(toggle,"aria-pressed",state.routeSelecting);
  optimize.disabled=state.routeOptimizing||state.routeSelectedIds.length<2;
  optimize.textContent=state.routeOptimizing?"Optimizing…":"Optimize route";
  clear.disabled=state.routeOptimizing&&state.routeSelectedIds.length===0
    ?false:state.routeSelectedIds.length===0&&!state.optimizedRoute;
  if(state.routeOptimizing){
    status.textContent=state.routeProgress
      ?"Optimizing segment "+state.routeProgress.completed+" of "+state.routeProgress.total+"…"
      :"Requesting road route…";
  }else if(state.routeError){
    status.textContent=state.routeError;
  }else if(state.routeSelecting){
    status.textContent=state.routeSelectedIds.length+" selected. First selected is the start; last selected is the finish.";
  }else if(state.optimizedRoute){
    status.textContent=state.optimizedRoute.ordered.length+" stops · optimized route ready.";
  }else if(state.routeSelectedIds.length){
    status.textContent=state.routeSelectedIds.length+" stops selected. First selected is the start; last selected is the finish.";
  }else{
    status.textContent="Select stops from the list or map. First selected is the start; last selected is the finish.";
  }
  renderRouteResult();
}
function clearRoutePlan(){
  state.routeAbortController?.abort();
  state.routeAbortController=null;
  state.routeRequestId++;
  state.routeOptimizing=false;
  state.routeSelecting=false;
  state.routeSelectedIds=[];
  state.routeError=null;
  state.routeProgress=null;
  clearRouteDisplay();
  render();
}
async function optimizeSelectedRoute(){
  const entries=new Map(allEntries().map(entry=>[entry.id,entry]));
  const pins=state.routeSelectedIds.map(id=>entries.get(id)).filter(Boolean);
  if(pins.length<2){state.routeError="Select at least two pins with valid coordinates.";updateRoutePlanner();return;}
  state.routeAbortController?.abort();
  const controller=new AbortController();
  state.routeAbortController=controller;
  const requestId=++state.routeRequestId;
  state.routeOptimizing=true;
  state.routeSelecting=false;
  state.routeError=null;
  state.routeProgress=null;
  clearRouteDisplay();
  updateRoutePlanner();
  try{
    const {optimizeSelectedPins}=await import("./route-optimizer.mjs?v=route-optimization-20261127");
    const route=await optimizeSelectedPins(pins,{
      signal:controller.signal,
      onProgress:progress=>{if(requestId===state.routeRequestId){state.routeProgress=progress;updateRoutePlanner();}}
    });
    if(requestId!==state.routeRequestId)return;
    state.optimizedRoute=route;
    state.routeSelectedIds=route.ordered.map(pin=>pin.id);
    render();
    renderOptimizedRoute();
    fitOptimizedRoute();
  }catch(error){
    if(requestId!==state.routeRequestId)return;
    if(error.name!=="AbortError"){
      state.routeError=error.message;
      notify(error.message,true);
    }
  }finally{
    if(requestId===state.routeRequestId){
      state.routeOptimizing=false;
      state.routeAbortController=null;
      updateRoutePlanner();
    }
  }
}
function renderOptimizedRoute(){
  const route=state.optimizedRoute;
  if(!route?.geometry||!state.map)return;
  const feature={type:"Feature",properties:{name:"Optimized route"},geometry:route.geometry};
  if(state.library==="maplibre"){
    if(!state.styleReady)return;
    let source=state.map.getSource("canvas-optimized-route");
    if(source)source.setData({type:"FeatureCollection",features:[feature]});
    else state.map.addSource("canvas-optimized-route",{type:"geojson",data:{type:"FeatureCollection",features:[feature]}});
    if(!state.map.getLayer("canvas-optimized-route")){
      const layer={
        id:"canvas-optimized-route",type:"line",source:"canvas-optimized-route",
        layout:{"line-cap":"round","line-join":"round"},
        paint:{"line-color":"#0877d5","line-width":5,"line-opacity":0.9}
      };
      state.map.addLayer(layer,state.map.getLayer(PIN_DOTS)?PIN_DOTS:undefined);
    }
  }else if(state.library==="leaflet"&&window.L?.geoJSON){
    try{state.routeLayer?.remove();}catch{}
    state.routeLayer=window.L.geoJSON(feature,{style:{color:"#0877d5",weight:5,opacity:0.9}}).addTo(state.map);
  }
}
function fitOptimizedRoute(){
  const coordinates=state.optimizedRoute?.geometry?.coordinates;
  if(!coordinates?.length||!state.map)return;
  const valid=coordinates.filter(point=>Array.isArray(point)&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1])));
  if(!valid.length)return;
  const lons=valid.map(point=>Number(point[0])),lats=valid.map(point=>Number(point[1]));
  let minLng=Math.min(...lons),maxLng=Math.max(...lons),minLat=Math.min(...lats),maxLat=Math.max(...lats);
  if(minLng===maxLng){minLng-=0.001;maxLng+=0.001;}
  if(minLat===maxLat){minLat-=0.001;maxLat+=0.001;}
  if(state.library==="maplibre")state.map.fitBounds([[minLng,minLat],[maxLng,maxLat]],{padding:72,maxZoom:15.5,duration:650});
  else if(state.library==="leaflet")state.map.fitBounds([[minLat,minLng],[maxLat,maxLng]],{padding:[45,45],maxZoom:16});
}

function render() {
  enhanced?.selections();
  settingsUI?.syncThemeOptions(allEntries());
  if(openDetails.size && (state.hiddenPinThemes.size || state.features.recentPinsOnly || !state.features.showRoutePins)){
    const entriesById=new Map(allEntries().map(entry=>[entry.id,entry]));
    for(const [id,card] of openDetails){
      const entry=entriesById.get(id)||card.entry;
      if(!pinThemeVisible(entry,state.hiddenPinThemes)||!pinPassesAgeFilter(entry)||!pinPassesRouteFilter(entry))hideDetail(id,false);
    }
  }
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
  updateRoutePlanner();
  renderTransportRoutes();
  renderItineraryBuilderUI();
  const list = $("entries");
  list.replaceChildren();
  for (const entry of shown) {
    const row = document.createElement("button");
    const routeOrder=state.routeSelectedIds.indexOf(entry.id);
    row.type = "button"; row.className = "entry" + (state.current?.id === entry.id ? " is-active" : "") + (routeOrder>=0 ? " route-selected" : "");
    const ico = text("span", pinEmoji(entry), "entry-ico"+(isRoutePin(entry)?" route-entry-ico":""));
    ico.style.color = validColor(entry.color) ? entry.color : pinColor(entry.kind);
    if (entry.kind === "photo" && entry.photo) {
      const img = document.createElement("img"); img.alt = "";
      img.src = entry.photo; ico.replaceChildren(img);
    }
    const wrap = text("span", "", "entry-main");
    wrap.append(text("strong", entry.title), text("small", entry.category || entry.kind));
    if(isRecentPin(entry)){row.classList.add("recent-entry");wrap.append(text("small","New · 24hrs","recent-pin-label"));}
    row.append(ico, wrap);
    if(state.routeSelecting||routeOrder>=0)row.append(text("span",routeOrder>=0?String(routeOrder+1):"+","route-order-badge"));
    if (entry.price) {
      const price = text("span", entry.price, "entry-price");
      if (entry.source === "hostel") price.append(text("small", "/ night"));
      row.append(price);
    }
    row.addEventListener("click", () => state.routeSelecting ? toggleRoutePin(entry) : state.transportSelecting ? selectTransportPin(entry) : choose(entry, true));
    list.append(row);
  }
  if (!shown.length) list.append(text("p", "No matching entries.", "empty-results muted"));
  renderMarkers(shown);
  renderMultimodalRoutes();
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
  root.className = "canvas-pin map-detail-card" + (isRecentPin(entry) ? " recent-card" : "");
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
  if(isRecentPin(entry))lines.append(text("small","New · 24hrs","recent-pin-label"));
  const extra = [entry.price, entry.rating ? "★ " + entry.rating : ""].filter(Boolean).join(" · ");
  if (extra) lines.append(text("small", extra));
  else if (entry.kind === "note" && entry.notes) lines.append(text("small", entry.notes.slice(0, 55)));
  label.append(lines);
  root.append(label);
  return root;
}
function updateLabels() {
  clearLabelMarkers();
  const labelsEnabled = state.showLabels && state.features.labels && !state.features.showAllPictures;
  const expanded = labelsEnabled && mapZoom() >= DETAIL_ZOOM &&
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
  attr($("toggleLabels"), "aria-pressed", labelsEnabled);
  $("mapSub").textContent = filterEntries().length + " pins · " +
    (state.features.showAllPictures ? (mapZoom() < PIN_PHOTO_MIN_ZOOM ? "Zoom in for pictures" : "Pictures visible") :
      mapZoom() < DETAIL_ZOOM ? "Zoom in for details" : expanded ? "Labels and photos visible" : "Labels hidden");
}
const routePlacementClicks=new WeakSet();
function attachMapPinClicks(map) {
  if (state.pinEventsAttached) return;
  state.pinEventsAttached = true;
  map.on("click", PIN_TOUCH, (event) => {
    const id = event.features?.[0]?.properties?.id;
    const entry = state.visiblePins.find((item) => item.id === id);
    if (!entry) return;
    if(enhanced?.isDrawing())return;
    if(event.originalEvent&&routePlacementClicks.has(event.originalEvent))return;
    if(state.placing?.kind==="route"){
      if(event.originalEvent)routePlacementClicks.add(event.originalEvent);
      placeAt({lng:entry.lng,lat:entry.lat});return;
    }
    if (state.placing) placeAt({lng:entry.lng,lat:entry.lat});
    else if(state.routeSelecting)toggleRoutePin(entry);
    else if(state.transportSelecting)selectTransportPin(entry);
    else choose(entry,false);
  });
  map.on("mouseenter", PIN_TOUCH, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", PIN_TOUCH, () => { map.getCanvas().style.cursor = ""; });
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
    // underneath emoji markers for precise hit-testing.
    if (source) source.setData(data);
    else state.map.addSource(PIN_SOURCE,{type:"geojson",data,cluster:false});
    if (!state.map.getLayer(PIN_DOTS)) {
      state.map.addLayer({
        id:PIN_DOTS,source:PIN_SOURCE,type:"circle",
        paint:{
          "circle-radius":["case",["==",["get","id"],state.current?.id||""],10*pinSize/100,8*pinSize/100],
          "circle-color":["get","color"],
          "circle-opacity":0.008
        }
      });
    } else {
      state.map.setPaintProperty(PIN_DOTS,"circle-radius",
        ["case",["==",["get","id"],state.current?.id||""],10*pinSize/100,8*pinSize/100]);
    }
    if (!state.map.getLayer(PIN_TOUCH)) {
      state.map.addLayer({
        id:PIN_TOUCH,source:PIN_SOURCE,type:"circle",
        paint:{"circle-radius":Math.max(14,20*pinSize/100),"circle-color":"#fff","circle-opacity":0.005}
      });
    }else state.map.setPaintProperty(PIN_TOUCH,"circle-radius",Math.max(14,20*pinSize/100));
    attachMapPinClicks(state.map);
    renderEmojiMarkers(entries);
  } else if (state.library === "leaflet") {
    for (const marker of state.markers) { try { marker.remove(); }catch {} }
    state.markers = [];
    for (const entry of entries) {
      if (!Number.isFinite(Number(entry.lat)) || !Number.isFinite(Number(entry.lng))) continue;
      const marker=window.L.marker([Number(entry.lat),Number(entry.lng)],{
        keyboard:true,bubblingMouseEvents:false,
        icon:window.L.divIcon({
          className:"leaflet-emoji-marker",
          html:makeEmojiPin(entry,"emoji-pin-inner").outerHTML,
          iconSize:[34*pinSize/100,34*pinSize/100],iconAnchor:[17*pinSize/100,17*pinSize/100]
        })
      }).addTo(state.map);
      marker.on("click",()=>{
        if(enhanced?.isDrawing())return;
        if (state.placing) placeAt({lat:entry.lat,lng:entry.lng});
        else if(state.routeSelecting)toggleRoutePin(entry);
        else if(state.transportSelecting)selectTransportPin(entry);
        else choose(entry,false);
      });
      state.markers.push(marker);
    }
  }
  updateLabels();
  enhanced?.renderOverlay();
}

function mapZoom() { return state.map ? state.map.getZoom() : 15; }
function zoomScale(zoom,sensitivity=popupSensitivity){return Math.exp((zoom-17)*0.12*sensitivity);}
function photoZoomScale(zoom){
  const boost=zoom>17 ? Math.max(0,popupSensitivity-2) : 0;
  return zoomScale(zoom,popupSensitivity+boost);
}
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
  const visible=allEntries().filter((e) => pinThemeVisible(e,state.hiddenPinThemes) && pinPassesAgeFilter(e) && pinPassesRouteFilter(e) && Number.isFinite(e.lat) && Number.isFinite(e.lng));
  const valid=visible.flatMap(e=>isRoutePin(e)?[e,...[e.canvas.start,e.canvas.end].map(([lng,lat])=>({lng,lat}))]:[e]);
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
  state.map.on("move",()=>{enhanced?.renderOverlay();positionDetail();});
  state.map.on("mousemove",e=>enhanced?.updateHover({lng:e.latlng.lng,lat:e.latlng.lat}));
  state.map.on("zoomend",updateLabels);
  state.library="leaflet";
  state.styleReady=true;
  state.provider="openstreetmap";
  document.documentElement.dataset.mapProvider="openstreetmap";
  paintProvider();renderMarkers(filterEntries());updateLabels();renderOptimizedRoute();renderMultimodalRoutes();
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
      transformRequest:(url)=>{
        if(url.startsWith("https://tiles.openfreemap.org/")&&navigator.serviceWorker?.controller){
          const local=new URL("/__offline_map_resource",location.origin);
          local.searchParams.set("url",url);
          return {url:local.href};
        }
        return {url};
      },
      attributionControl:true,maxZoom:19
    });
    state.map=map;state.library="maplibre";
    map.addControl(new lib.NavigationControl({showCompass:false}),"bottom-right");
    let started=false;
    map.on("load",()=>{started=true;state.styleReady=true;clearNotice();renderMarkers(filterEntries());renderMultimodalRoutes();});
    map.on("style.load",()=>{state.styleReady=true;renderMarkers(filterEntries());renderOptimizedRoute();renderMultimodalRoutes();});
    map.on("movestart",()=>{state.mapMoving=true;clearLabelMarkers();});
    map.on("moveend",()=>{state.mapMoving=false;updateLabels();enhanced?.renderOverlay();});
    map.on("move",()=>{enhanced?.renderOverlay();positionDetail();});
    map.on("mousemove",e=>enhanced?.updateHover(e.lngLat));
    map.on("zoomend",updateLabels);
    map.on("click",(event)=>{
      if(event.originalEvent&&routePlacementClicks.has(event.originalEvent))return;
      if(state.library==="maplibre"&&state.styleReady){
        const pinHits=map.queryRenderedFeatures(event.point,{layers:[PIN_TOUCH].filter(id=>map.getLayer(id))});
        if(state.placing?.kind==="route"){
          if(event.originalEvent)routePlacementClicks.add(event.originalEvent);
          const entry=state.visiblePins.find(p=>p.id===pinHits[0]?.properties?.id);
          placeAt(entry?{lng:entry.lng,lat:entry.lat}:event.lngLat);return;
        }
        const routeHits=pinHits.length?[]:map.queryRenderedFeatures(event.point,{layers:TRANSPORT_LAYER_IDS.filter(id=>id.endsWith("-hit")&&map.getLayer(id))});
        const routeId=routeHits[0]?.properties?.routeId;
        if(routeId){showTransportInfo(String(routeId));return;}
      }
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
function positionDetail() {
  if(!state.map)return;
  const scale=Math.max(0.3,Math.min(1.35,zoomScale(mapZoom())))*detailSize/100;
  const pinOffset=17*pinSize/100+5;
  for(const {entry, node:detail} of openDetails.values()){
    const point=state.library === "maplibre" ? state.map.project([entry.lng,entry.lat]) : state.map.latLngToContainerPoint([entry.lat,entry.lng]);
    const map=$("map");
    const visible=point.x>=0 && point.y>=0 && point.x<=map.clientWidth && point.y<=map.clientHeight;
    detail.style.visibility=visible?"visible":"hidden";
    const halfWidth=detail.offsetWidth*scale/2;
    const centerX=halfWidth*2>=map.clientWidth?map.clientWidth/2:Math.max(halfWidth,Math.min(map.clientWidth-halfWidth,point.x));
    detail.style.left=centerX+"px";
    detail.style.setProperty("--anchor-x",((point.x-centerX)/scale)+"px");
    detail.style.setProperty("--detail-scale",scale);
    const below=point.y<detail.offsetHeight*scale+pinOffset+2;
    detail.style.top=(point.y+(below?pinOffset:-pinOffset))+"px";
    detail.classList.toggle("below-pin",below);
  }
}
function renderDetail(entry,detail){
  detail.replaceChildren();
  const head=text("div","","detail-head");
  const name=text("h2",entry.title);
  const closeButton=button("✕",()=>hideDetail(entry.id));
  closeButton.setAttribute("aria-label","Close details");
  head.append(name,closeButton);
  detail.append(head);
  if(isRoutePin(entry)){
    const c=entry.canvas;
    const description=c.polyline?c.mode+" · "+(c.distanceMeters/1000).toFixed(2)+" km · "+Math.round(c.durationSeconds/60)+" min estimated":"Legacy route · redraw to calculate road or path geometry";
    detail.append(text("small",description,"muted"));
    if(c.polyline){
      const credit=text("p","","muted");
      for(const [name,url] of [["© OpenStreetMap contributors","https://www.openstreetmap.org/copyright"],["OSRM / FOSSGIS","https://routing.openstreetmap.de/about.html"],["Fix the map","https://www.openstreetmap.org/edit?lat="+entry.lat+"&lon="+entry.lng+"&zoom=17"]]){
        const a=text("a",name);a.href=url;a.target="_blank";a.rel="noopener noreferrer";if(credit.childNodes.length)credit.append(" · ");credit.append(a);
      }
      detail.append(credit);
    }
  }
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
  actions.append(button("Edit",()=>{hideDetail(entry.id);openEditor(entry);},"secondary"));
  const deleteButton=button("Delete pin",()=>removeEntry(entry),"danger");
  deleteButton.className+=" delete-selected-pin";
  deleteButton.disabled=!state.localReady;
  deleteButton.title="Delete from the shared map";
  actions.append(deleteButton);
  detail.append(actions);
  const card=openDetails.get(entry.id);
  if(card)card.entry=entry;
  detail.classList.remove("hidden");
  positionDetail();
}
function raiseDetail(id) {
  const card=openDetails.get(id);if(!card)return;
  const ordered=[...openDetails.entries()].filter(([key])=>key!==id);
  ordered.push([id,card]);
  ordered.forEach(([,item],index)=>{item.node.style.zIndex=String(index+1);});
  state.current=card.entry;
  history.replaceState(null,"",pinUrl(id));
}
function scheduleDetailAutoClose(id){
  const card=openDetails.get(id);if(!card)return;
  clearTimeout(card.autoCloseTimer);
  card.autoCloseTimer=null;
  if(detailAutoClose===0)return;
  card.autoCloseTimer=setTimeout(()=>{
    if(openDetails.get(id)===card)hideDetail(id);
  },detailAutoClose*1000);
}
function choose(entry, focus) {
  if(state.placing){placeAt({lng:entry.lng,lat:entry.lat});return;}
  if(openDetails.has(entry.id)){hideDetail(entry.id);return;}
  state.current=entry;render();
  if(entry.id)history.replaceState(null,"",pinUrl(entry.id));
  if(focus){showMobileMap();mapFocus(entry);}
  const node=document.createElement("aside");
  node.className="side-panel";node.setAttribute("aria-label","Entry details");
  const card={entry,node};openDetails.set(entry.id,card);
  node.addEventListener("pointerdown",()=>{raiseDetail(entry.id);scheduleDetailAutoClose(entry.id);});
  for(const event of ["wheel","keydown","focusin","scroll"])node.addEventListener(event,()=>scheduleDetailAutoClose(entry.id),{passive:true,capture:true});
  $("detailLayer").append(node);
  raiseDetail(entry.id);
  renderDetail(entry,card.node);
  scheduleDetailAutoClose(entry.id);
}
function hideDetail(id=state.current?.id,rerender=true) {
  const card=openDetails.get(id);
  if(card){clearTimeout(card.autoCloseTimer);card.node.remove();openDetails.delete(id);}
  if(state.current?.id===id)state.current=[...openDetails.values()].sort((a,b)=>Number(b.node.style.zIndex)-Number(a.node.style.zIndex))[0]?.entry||null;
  history.replaceState(null,"",pinUrl(state.current?.id||null));
  if(rerender)render();
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
  state.placing?.controller?.abort();
  state.placing={kind:kind||"place", draft:draft||null};
  $("routePinMode").classList.toggle("hidden",kind!=="route");
  if(kind==="route")$("routePinMode").value=draft?.canvas?.mode||"walking";
  $("placementInstruction").textContent=kind==="route"?"Tap the route start point":"Tap the map to place your entry";
  $("placementBar").classList.remove("hidden");
  $("cancelPlace").focus();
  showMobileMap();
}
async function placeAt({lng,lat}) {
  if (!state.placing) return;
  const p=state.placing;
  if(p.busy)return;
  if(p.kind==="route"&&(!Number.isFinite(Number(lng))||!Number.isFinite(Number(lat))||Math.abs(Number(lat))>85||Math.abs(Number(lng))>180)){notify("Choose a valid map point.",true);return;}
  if(p.kind==="route"&&!p.start){
    p.start=[Number(lng),Number(lat)];
    $("placementInstruction").textContent="Tap the route end point";
    return;
  }
  if(p.kind==="route"&&p.start[0]===Number(lng)&&p.start[1]===Number(lat)){notify("Choose a different end point.",true);return;}
  let routed=null;
  if(p.kind==="route"){
    p.busy=true;p.controller=new AbortController();
    $("placementInstruction").textContent="Finding mapped route…";
    $("routePinMode").disabled=true;
    const timer=setTimeout(()=>p.controller.abort(),20000);
    try{routed=await fetchRoutePin(p.start,[Number(lng),Number(lat)],$("routePinMode").value,{signal:p.controller.signal});}
    catch(error){if(state.placing===p){notify(error.name==="AbortError"?"Route lookup timed out. Try again.":error.message,true);$("placementInstruction").textContent="Tap the route end point to retry";}return;}
    finally{clearTimeout(timer);p.busy=false;$("routePinMode").disabled=false;}
    if(state.placing!==p)return;
  }
  state.placing=null;
  $("placementBar").classList.add("hidden");
  const draft=p.draft||{
    id:crypto.randomUUID(),title:"",kind:"place",category:"",price:"",rating:"",
    notes:"",photo:"",version:""
  };
  if(p.kind==="route"){
    Object.assign(draft,routed.center,{category:draft.category||"Route",canvas:routed.canvas});
    draft.title=draft.title||"New route";
  }else{draft.lat=Number(lat);draft.lng=Number(lng);}
  if (state.pendingPhoto) {
    try {draft.photo=await shrinkPhoto(state.pendingPhoto);}catch(e){notify(e.message,true);}
    state.pendingPhoto=null;
  }
  openEditor(draft);
}
function openEditor(entry) {
  state.draft={...entry};
  $("editorTitle").textContent=isRoutePin(entry)?(allEntries().some(e=>e.id===entry.id)?"Edit route":"New route"):(allEntries().some(e=>e.id===entry.id)?"Edit map entry":"New map entry");
  $("title").value=entry.title||"";
  $("category").value=entry.category||"";
  $("price").value=entry.price||"";
  $("rating").value=entry.rating||"";
  $("notes").value=entry.notes||"";
  $("pinIcon").value=ICONS.includes(entry.icon)?entry.icon:"📍";
  $("pinColor").value=validColor(entry.color)?entry.color:"#245c48";
  $("imageUrl").value=entry.photo?.startsWith("https://")?entry.photo:"";
  $("coords").textContent=isRoutePin(entry)?`Start ${entry.canvas.start[1].toFixed(5)}, ${entry.canvas.start[0].toFixed(5)} · End ${entry.canvas.end[1].toFixed(5)}, ${entry.canvas.end[0].toFixed(5)}`:entry.lat.toFixed(5)+", "+entry.lng.toFixed(5);
  $("movePin").textContent=isRoutePin(entry)?"↔ Redraw route":"⌖ Move on map";
  const img=$("photoPreview");
  if (entry.photo) {img.src=entry.photo;img.classList.remove("hidden");}
  else {img.removeAttribute("src");img.classList.add("hidden");}
  for(const b of document.querySelectorAll(".type")) {
    b.classList.toggle("is-active",b.dataset.kind==="place");
    attr(b,"aria-pressed",b.dataset.kind==="place");
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
async function queueOfflineChange(action,entry){
  const clean=stripOfflineFlags(entry);
  const baseVersion=Number.isInteger(entry.version)&&entry.version>0?entry.version:null;
  const change={
    pinId:entry.id,action,entry:action==="save"?clean:null,
    expectedVersion:baseVersion,createdAt:Date.now()
  };
  const queued=await enqueueOfflineChange(change);
  const items=allEntries().slice();
  let pendingEntry=null;
  if(action==="save"){
    pendingEntry={...clean,version:baseVersion??0,pendingSync:true,syncConflict:false};
    const index=items.findIndex(pin=>pin.id===entry.id);
    if(index<0)items.push(pendingEntry);else items[index]=pendingEntry;
  }else{
    const index=items.findIndex(pin=>pin.id===entry.id);
    if(index>=0)items.splice(index,1);
    if(openDetails.has(entry.id))hideDetail(entry.id);
  }
  storeMapSnapshot(items);
  await refreshOfflineStatus();
  if(action==="save"){
    const card=openDetails.get(entry.id);if(card)renderDetail(pendingEntry,card.node);
    return {entry:pendingEntry,version:pendingEntry.version,queued:true,cancelled:!!queued.cancelled};
  }
  return {version:baseVersion??0,queued:true,cancelled:!!queued.cancelled};
}
async function submitChange(action,entry){
  if(action==="save"&&!allEntries().some(pin=>pin.id===entry.id)&&!entry.createdAt)entry={...entry,createdAt:Date.now()};
  if(!state.localReady)throw new Error("Open the shared map online once before editing offline.");
  if(state.syncingQueue)throw new Error("Offline edits are syncing. Retry in a moment.");
  state.readEpoch++;
  const path="/pins/"+encodeURIComponent(entry.id);
  if(!navigator.onLine)return queueOfflineChange(action,entry);
  let queued=null;
  try{queued=await getQueuedChange(entry.id);}catch{}
  if(queued)return queueOfflineChange(action,entry);
  try{
    let data;
    if(action==="delete"){
      data=await requestShared(path,jsonOptions("DELETE",{expectedVersion:entry.version}));
      storeMapSnapshot(allEntries().filter(pin=>pin.id!==entry.id));
      if(openDetails.has(entry.id))hideDetail(entry.id);
    }else if(action==="save"){
      const value=await uploadEntryPhotos(stripOfflineFlags(entry));
      const expectedVersion=Number.isInteger(entry.version)&&entry.version>0?entry.version:null;
      data=await requestShared(path,jsonOptions("PUT",{entry:value,expectedVersion}));
      const items=allEntries().slice();
      const index=items.findIndex(pin=>pin.id===entry.id);
      if(index<0)items.push(data.entry);else items[index]=data.entry;
      storeMapSnapshot(items);
      const card=openDetails.get(entry.id);if(card)renderDetail(data.entry,card.node);
    }else throw new Error("Invalid action");
    return data;
  }catch(error){
    if(error.status===409||(error.status>=400&&error.status<500&&error.status!==503))throw error;
    return queueOfflineChange(action,entry);
  }
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
    title:$("title").value.trim(),category:$("category").value.trim(),kind:"place",
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
    const result=await submitChange("save",entry,key);
    recordChange({before,after:state.entries.find(x=>x.id===entry.id)||entry});
    closeEditor();notify(result.queued?"Saved on this device · will sync when connected.":"Saved to the shared map.");
  }catch(error){notify(error.message,true);}
  finally{state.saving=false;$("saveEntry").textContent="Save pin";$("saveEntry").disabled=false;updateHistoryButtons();}
}
async function removeEntry(entry){
  if(state.saving)return;
  state.saving=true;
  const control=openDetails.get(entry.id)?.node.querySelector(".delete-selected-pin");
  if(control){control.disabled=true;control.textContent="Deleting…";}
  try{
    const before=allEntries().find(e=>e.id===entry.id);
    const result=await submitChange("delete",entry);
    if(before)recordChange({before,after:null,version:result.version});
    hideDetail(entry.id);
    notify(result.queued?"Delete queued · will sync when connected.":"Pin moved to Recently Deleted.");
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
    const draft={id:crypto.randomUUID(),title:"Picture",kind:"place",category:"",price:"",
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
  if(entry&&pinThemeVisible(entry,state.hiddenPinThemes)&&pinPassesAgeFilter(entry)&&pinPassesRouteFilter(entry)){state.pendingPin=null;choose(entry,true);}
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
async function refreshOfflineStatus(){
  const status=$("offlineState");
  if(!status)return;
  try{
    const [queued,areas]=await Promise.all([listQueuedChanges(),listOfflineAreas()]);
    const conflicts=queued.filter(item=>item.status==="conflict").length;
    let label="";
    if(!navigator.onLine)label="Offline"+(queued.length?" · "+queued.length+" edit"+(queued.length===1?"":"s")+" queued":"");
    else if(queued.length)label=queued.length+" edit"+(queued.length===1?"":"s")+" waiting"+(conflicts?" · "+conflicts+" conflict"+(conflicts===1?"":"s"):"");
    else if(areas.length)label=areas.length+" offline area"+(areas.length===1?"":"s");
    status.textContent=label;
    status.classList.toggle("hidden",!label);
    if($("offlineDialog")?.open)renderOfflineDialog(queued,areas);
  }catch{
    status.textContent=navigator.onLine?"Offline storage unavailable":"Offline · storage unavailable";
    status.classList.remove("hidden");
  }
}
async function setupOffline(){
  window.addEventListener("online",()=>{refreshOfflineStatus();reloadShared(true);});
  window.addEventListener("offline",refreshOfflineStatus);
  if("serviceWorker" in navigator && (location.protocol==="https:"||["localhost","127.0.0.1"].includes(location.hostname))){
    try{
      offlineRegistration=await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller){
        await Promise.race([
          new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true})),
          delay(1500)
        ]);
      }
    }catch{notify("Offline map storage could not start in this browser.",true);}
  }
  await refreshOfflineStatus();
}
function getOfflineWorker(){
  return (offlineRegistration?Promise.resolve(offlineRegistration):navigator.serviceWorker.ready)
    .then(registration=>{
      const worker=navigator.serviceWorker.controller||registration.active;
      if(!worker)throw new Error("Offline map worker is not ready. Refresh the page and try again.");
      return worker;
    });
}
function currentMapBounds(){
  if(!state.map||typeof state.map.getBounds!=="function")throw new Error("Wait for the map to finish loading first.");
  const bounds=state.map.getBounds();
  return {west:bounds.getWest(),south:bounds.getSouth(),east:bounds.getEast(),north:bounds.getNorth()};
}
function offlineProxyOrigin(){
  try{
    const url=new URL($("offlineProxyUrl").value.trim());
    const local=["localhost","127.0.0.1"].includes(url.hostname);
    if(url.protocol!=="https:"&&!(local&&url.protocol==="http:"))return null;
    return url.origin;
  }catch{return null;}
}
function updateOfflineEstimate(){
  const output=$("offlineEstimate");
  const button=$("offlineDownload");
  if(!offlineProxyOrigin()){
    output.textContent="Deploy the independent tile proxy from offline-tile-proxy/ and paste its workers.dev URL above.";
    button.disabled=true;
    return;
  }
  if(!offlineAreaBounds||state.provider!=="openfreemap"||state.library!=="maplibre"){
    output.textContent="Switch the basemap to OpenFreeMap to download offline areas. OpenStreetMap's public raster tiles cannot be bulk-downloaded.";
    button.disabled=true;
    return;
  }
  try{
    const count=countOfflineTiles(offlineAreaBounds,Number($("offlineMinZoom").value),Number($("offlineMaxZoom").value));
    output.textContent=count.toLocaleString()+" vector tiles · maximum 3,000 tiles and 50 MB per area · up to 4 parallel requests";
    button.disabled=count<1||count>OFFLINE_TILE_LIMITS.maxTiles||!!offlineDownloadId;
  }catch(error){
    output.textContent=error.message;
    button.disabled=true;
  }
}
async function openOfflineDialog(){
  try{
    offlineAreaBounds=currentMapBounds();
    const zoom=state.map.getZoom();
    const min=Math.max(5,Math.floor(zoom)-2),max=Math.min(18,Math.ceil(zoom)+1);
    for(const id of ["offlineMinZoom","offlineMaxZoom"]){
      const select=$(id);select.replaceChildren();
      for(let z=5;z<=18;z++)select.add(new Option(String(z),String(z)));
    }
    $("offlineMinZoom").value=String(min);
    $("offlineMaxZoom").value=String(Math.max(min,max));
    $("offlineAreaName").value="Map area "+new Date().toLocaleDateString();
    try{$("offlineProxyUrl").value=localStorage.getItem("map-canvas:offline-tile-proxy-v1")||"";}catch{$("offlineProxyUrl").value="";}
    $("offlineProgress").textContent="";
    $("offlineProviderNote").textContent=state.provider==="openfreemap"&&state.library==="maplibre"
      ?"The current map view will be saved with both light and dark OpenFreeMap styles."
      :"Switch the basemap to OpenFreeMap before downloading. OpenStreetMap public tiles do not permit offline prefetching.";
    updateOfflineEstimate();
    await refreshOfflineStatus();
    $("offlineDialog").showModal();
  }catch(error){notify(error.message,true);}
}
function renderOfflineDialog(queued,areas){
  const areaList=$("offlineAreas");
  if(areaList){
    areaList.replaceChildren();
    if(!areas.length)areaList.append(text("li","No saved areas yet.","muted"));
    for(const area of areas){
      const item=document.createElement("li");item.className="offline-area-item";
      const details=text("span",area.name+" · "+Number(area.tileCount||0).toLocaleString()+" tiles · "+formatOfflineBytes(area.bytes));
      const remove=button("Delete",()=>deleteOfflineArea(area.id),"secondary");
      item.append(details,remove);areaList.append(item);
    }
  }
  const conflictCount=queued.filter(item=>item.status==="conflict").length;
  $("offlineQueueStatus").textContent=queued.length
    ?queued.length+" edit"+(queued.length===1?"":"s")+" stored on this device · "+conflictCount+" conflict"+(conflictCount===1?"":"s")+". Conflicts are not overwritten automatically."
    :"No pending edits.";
  $("offlineSync").disabled=!navigator.onLine||queued.length===0||state.syncInFlight;
  $("offlineExport").disabled=queued.length===0;
}
async function refreshOfflineDialog(){
  const [queued,areas]=await Promise.all([listQueuedChanges(),listOfflineAreas()]);
  renderOfflineDialog(queued,areas);
}
async function downloadCurrentOfflineArea(){
  if(offlineDownloadId)return;
  if(!navigator.onLine){$("offlineProgress").textContent="Connect to the internet to download this area.";return;}
  if(state.provider!=="openfreemap"||state.library!=="maplibre"){updateOfflineEstimate();return;}
  const proxyOrigin=offlineProxyOrigin();
  if(!proxyOrigin){updateOfflineEstimate();return;}
  try{localStorage.setItem("map-canvas:offline-tile-proxy-v1",proxyOrigin);}catch{}
  const id=crypto.randomUUID().replaceAll("-","");
  const area={
    id,proxyOrigin,name:$("offlineAreaName").value.trim()||"Offline area",
    bounds:offlineAreaBounds,
    minZoom:Number($("offlineMinZoom").value),
    maxZoom:Number($("offlineMaxZoom").value)
  };
  try{
    const worker=await getOfflineWorker();
    offlineDownloadId=id;
    $("offlineDownload").disabled=true;
    $("offlineCancel").classList.remove("hidden");
    $("offlineProgress").textContent="Preparing offline map…";
    const channel=new MessageChannel();
    channel.port1.onmessage=async event=>{
      const message=event.data||{};
      if(message.type==="OFFLINE_AREA_PROGRESS"){
        $("offlineProgress").textContent="Downloading "+message.completed.toLocaleString()+"/"+message.total.toLocaleString()+
          " resources · "+message.tileCount.toLocaleString()+" vector tiles · "+formatOfflineBytes(message.bytes);
      }else if(message.type==="OFFLINE_AREA_COMPLETE"){
        offlineDownloadId=null;
        $("offlineCancel").classList.add("hidden");
        $("offlineProgress").textContent="Saved "+message.area.tileCount.toLocaleString()+" tiles ("+formatOfflineBytes(message.area.bytes)+").";
        $("offlineDownload").disabled=false;
        await refreshOfflineStatus();
      }else if(message.type==="OFFLINE_AREA_ERROR"){
        offlineDownloadId=null;
        $("offlineCancel").classList.add("hidden");
        $("offlineProgress").textContent="Download stopped: "+message.error;
        updateOfflineEstimate();
      }
    };
    worker.postMessage({type:"DOWNLOAD_OFFLINE_AREA",area},[channel.port2]);
  }catch(error){
    offlineDownloadId=null;
    $("offlineCancel").classList.add("hidden");
    $("offlineProgress").textContent=error.message;
    updateOfflineEstimate();
  }
}
async function cancelOfflineDownload(){
  if(!offlineDownloadId)return;
  try{(await getOfflineWorker()).postMessage({type:"CANCEL_OFFLINE_AREA",id:offlineDownloadId});}
  catch{}
  $("offlineProgress").textContent="Cancelling download…";
  $("offlineCancel").classList.add("hidden");
}
async function deleteOfflineArea(id){
  try{
    const worker=await getOfflineWorker();
    const channel=new MessageChannel();
    channel.port1.onmessage=async event=>{
      if(event.data?.type==="OFFLINE_AREA_DELETED"){
        await refreshOfflineStatus();
        notify("Offline area deleted.");
      }else if(event.data?.type==="OFFLINE_AREA_DELETE_ERROR")notify(event.data.error,true);
    };
    worker.postMessage({type:"DELETE_OFFLINE_AREA",id},[channel.port2]);
  }catch(error){notify(error.message,true);}
}
async function exportPendingEdits(){
  const queued=await listQueuedChanges();
  if(!queued.length)return;
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),pendingEdits:queued},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");link.href=url;link.download="map-canvas-pending-offline-edits.json";
  link.click();setTimeout(()=>URL.revokeObjectURL(url),4000);
}


const FEATURE_TARGETS={
  search:[".searchwrap"],filters:[".filters","#categoryFilter","#sort"],
  layers:[".collection-selects",".layers-panel"],
  importExport:[".io-actions"],addPins:["#addButton","#addRoutePin"],
  canvasObjects:[],galleries:["#galleryControls"],
  undoRedo:["#undoBtn","#redoBtn"],
  gps:["#locateButton"],
  basemaps:["#basemapButton"],navigation:["#zoomIn","#zoomOut","#fitPins"],
};
function applyFeatureSettings(changedKey=null){
  for(const [key,selectors] of Object.entries(FEATURE_TARGETS)){
    for(const selector of selectors)
      document.querySelectorAll(selector).forEach(node=>
        node.classList.toggle("feature-hidden",!state.features[key]));
  }
  $("toggleLabels").classList.toggle("feature-hidden",!state.features.labels||state.features.showAllPictures);
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
    if((key==="recentPinsOnly"||key==="showRoutePins")&&state.map)applyDeepLink();
  }
}

function setPinThemeVisibility(key,visible){
  if(visible)state.hiddenPinThemes.delete(key);
  else state.hiddenPinThemes.add(key);
  settingsUI.status(savePinVisibility(state.hiddenPinThemes));
  settingsUI.sync();
  render();
  if(state.map)applyDeepLink();
}

const trashDateFormat = new Intl.DateTimeFormat(undefined, {dateStyle:"medium",timeStyle:"short"});
let trashRequest = 0;
let trashExpiryTimer;

async function loadTrash(message="") {
  const request = ++trashRequest;
  clearTimeout(trashExpiryTimer);
  const list = $("trashEntries");
  const status = $("trashStatus");
  list.replaceChildren();
  status.textContent = message || "Loading deleted pins…";
  try {
    const {entries} = await requestShared("/trash");
    if (request !== trashRequest) return;
    status.textContent = message || (entries.length ? "" : "No recently deleted pins.");
    for (const entry of entries) {
      const row = document.createElement("li");
      const details = document.createElement("div");
      details.append(text("strong",entry.title),text("small","Expires " + trashDateFormat.format(entry.expiresAt)));
      const restore = button("Restore",()=>restoreTrashedPin(entry),"secondary");
      restore.setAttribute("aria-label","Restore " + entry.title);
      row.append(details,restore);
      list.append(row);
    }
  } catch (error) {
    if (request !== trashRequest) return;
    status.textContent = message ? message + " " + error.message : error.message;
    const retry = document.createElement("li");
    retry.append(button("Retry",()=>loadTrash(),"secondary"));
    list.append(retry);
  } finally {
    if (request === trashRequest && $("trashDialog").open) {
      trashExpiryTimer = setTimeout(()=>loadTrash(),60000);
    }
  }
}

async function restoreTrashedPin(entry) {
  if (state.saving || state.historyBusy) {
    $("trashStatus").textContent = "Another map change is saving. Try again in a moment.";
    return;
  }
  state.saving = true;
  state.readEpoch++;
  updateHistoryButtons();
  trashRequest++;
  clearTimeout(trashExpiryTimer);
  $("trashEntries").querySelectorAll("button").forEach(control=>{control.disabled=true;});
  let message;
  try {
    const data = await requestShared("/trash/" + encodeURIComponent(entry.id),
      jsonOptions("POST",{expectedVersion:entry.version}));
    storeMapSnapshot([...allEntries().filter(pin=>pin.id!==entry.id),data.entry]);
    state.undo = state.undo.filter(change=>(change.after || change.before).id!==entry.id);
    recordChange({before:null,after:data.entry});
    message = entry.title + " restored.";
  } catch (error) {
    message = error.message;
  } finally {
    state.saving = false;
    updateHistoryButtons();
  }
  await Promise.all([loadTrash(message),reloadShared(true)]);
  if (!$("trashDialog").open) notify(message);
}

function wire() {
  $("trashDialog").addEventListener("close",()=>{
    trashRequest++;
    clearTimeout(trashExpiryTimer);
  });
  $("openTrash").addEventListener("click",()=>{
    $("trashDialog").showModal();
    loadTrash();
  });
  $("refreshBtn").addEventListener("click",()=>reloadShared(false));
  $("offlineButton").addEventListener("click",openOfflineDialog);
  $("routeSelectToggle").addEventListener("click",()=>{state.transportSelecting=false;state.transportDraft=null;state.routeSelecting=!state.routeSelecting;updateRoutePlanner();renderTransportRoutes();render();});
  $("routeOptimize").addEventListener("click",optimizeSelectedRoute);
  $("routeClear").addEventListener("click",clearRoutePlan);
  $("transportAddRoute").addEventListener("click",startTransportRoute);
  $("transportClearRoutes").addEventListener("click",clearTransportRoutes);
  $("transportInfoClose").addEventListener("click",closeTransportInfo);
  $("transportResearchRefresh").addEventListener("click",()=>{const route=state.transportRoutes.find(item=>item.id===state.transportInfoRouteId);if(route)openTransportResearch(route,true);});
  $("transportMode").addEventListener("change",()=>{if(state.transportSelecting)state.transportDraft={mode:$("transportMode").value,from:null};renderTransportRoutes();});
  $("offlineClose").addEventListener("click",()=>$("offlineDialog").close());
  $("offlineDownload").addEventListener("click",downloadCurrentOfflineArea);
  $("offlineCancel").addEventListener("click",cancelOfflineDownload);
  $("offlineMinZoom").addEventListener("change",updateOfflineEstimate);
  $("offlineMaxZoom").addEventListener("change",updateOfflineEstimate);
  $("offlineProxyUrl").addEventListener("change",()=>{
    try{localStorage.setItem("map-canvas:offline-tile-proxy-v1",offlineProxyOrigin()||"");}catch{}
    updateOfflineEstimate();
  });
  $("offlineSync").addEventListener("click",()=>reloadShared(false));
  $("offlineExport").addEventListener("click",exportPendingEdits);
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
  $("addRoutePin").addEventListener("click",()=>{if(!state.features.showRoutePins)setFeatureSetting("showRoutePins",true);startPlacement("route");});
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
    const moving={...state.draft,title:$("title").value.trim(),category:$("category").value.trim(),notes:$("notes").value.trim(),price:$("price").value.trim(),rating:$("rating").value.trim(),color:$("pinColor").value};
    try{enhanced?.collectEditor(moving);}catch(error){notify(error.message,true);return;}
    closeEditor();startPlacement(isRoutePin(moving)?"route":moving.kind,moving);
  });
  document.querySelectorAll(".type").forEach((el)=>el.addEventListener("click",()=>{
    if(!state.draft)return;
    for(const item of document.querySelectorAll(".type")){
      item.classList.toggle("is-active",item===el);attr(item,"aria-pressed",item===el);
    }
    const target={place:$("title"),note:$("notes"),photo:$("imageUrl")}[el.dataset.kind];
    target?.focus();
  }));
  window.addEventListener("paste",(event)=>{
    if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;
    const file=Array.from(event.clipboardData?.items||[])
      .find((x)=>x.type.startsWith("image/"))?.getAsFile();
    if(file){event.preventDefault();addImageFile(file);}
  });
  window.addEventListener("keydown",(event)=>{
    if(event.key==="Escape" && !$("settingsDialog").open){
      $("basemapSwitch").classList.add("hidden");
      if(state.placing) {$("placementBar").classList.add("hidden");state.placing=null;}
      if(state.transportSelecting){state.transportSelecting=false;state.transportDraft=null;renderTransportRoutes();render();}
      if(openDetails.size)hideDetail();
    }
  });
}
async function main() {
  state.features=readFeatureSettings();
  state.hiddenPinThemes=readPinVisibility();
  state.transportRoutes=readSavedTransportRoutes();
  state.itineraries=readSavedItineraries();
  if(state.itineraries.length){const latest=state.itineraries.at(-1);state.itineraryDraft=cloneItinerary(latest);state.itineraryActiveId=latest.id;}
  else state.itineraryDraft=createItinerary();
  enhanced=createEnhancements({state,DETAIL_ZOOM,PIN_SOURCE,
    allEntries,filterEntries,pinGeoJSON,render,notify,safeImage,openEditor,
    startPlacement,placeAt,choose,getKey,saveKey,randomKey,submitChange,recordChange,
    reloadShared,importPins,mapZoom,photoZoomScale,photoSize:()=>photoSize/100,pinSize:()=>pinSize/100});
  wire();
  // An optional feature must never prevent the base map from initializing.
  try{enhanced.init();}catch(error){
    console.error("Canvas tools could not initialize:",error);
    notify("Some map tools failed to load. Refresh to get the newest version.",true);
  }
  settingsUI=createSettingsControls({state,onChange:setFeatureSetting,onThemeChange:setPinThemeVisibility,
    onThemeReset:()=>{
      state.hiddenPinThemes.clear();
      savePinVisibility(state.hiddenPinThemes);
      if(state.map)applyDeepLink();
    }
  });
  settingsUI.init();
  const sensitivity=$("popupSensitivity");
  const photoSizeSlider=$("photoSize");
  const pinSizeSlider=$("pinSize"),detailSizeSlider=$("detailSize");
  const autoCloseRow=document.createElement("div");
  autoCloseRow.className="settings-range";
  autoCloseRow.innerHTML='<label for="detailAutoClose">Auto-close open pins</label><output id="detailAutoCloseValue" for="detailAutoClose"></output><input id="detailAutoClose" type="range" min="0" max="120" step="5" aria-describedby="detailAutoCloseHint"><small id="detailAutoCloseHint">Close each open pin after inactivity. Set to Off to keep pins open until manually closed.</small>';
  $("detailSize").closest(".settings-range").after(autoCloseRow);
  const autoCloseSlider=$("detailAutoClose");
  function setDetailAutoClose(value,persist=false){
    detailAutoClose=normalizeDetailAutoClose(value);
    autoCloseSlider.value=String(detailAutoClose);
    $("detailAutoCloseValue").value=detailAutoClose===0?"Off":detailAutoClose+" sec";
    if(persist){try{localStorage.setItem(DETAIL_AUTO_CLOSE_KEY,String(detailAutoClose));}catch{}}
    for(const id of openDetails.keys())scheduleDetailAutoClose(id);
  }
  setDetailAutoClose(detailAutoClose);
  autoCloseSlider.addEventListener("input",()=>setDetailAutoClose(autoCloseSlider.value,true));
  $("settingsReset").addEventListener("click",()=>setDetailAutoClose(DEFAULT_DETAIL_AUTO_CLOSE,true));
  const resizePopups=()=>{positionDetail();enhanced.renderOverlay();};
  function setPhotoSize(value,persist=false){
    photoSize=normalizePhotoSize(value);
    photoSizeSlider.value=String(photoSize);
    $("photoSizeValue").value=photoSize+"%";
    if(persist){try{localStorage.setItem(PHOTO_SIZE_KEY,String(photoSize));}catch{}}
    enhanced.renderOverlay();
  }
  function setPinSize(value,persist=false){
    pinSize=normalizePinSize(value);
    pinSizeSlider.value=String(pinSize);$("pinSizeValue").value=pinSize+"%";
    if(persist){try{localStorage.setItem(PIN_SIZE_KEY,String(pinSize));}catch{}}
    if(state.map)renderMarkers(state.visiblePins);
    positionDetail();enhanced.renderOverlay();
  }
  function setDetailSize(value,persist=false){
    detailSize=normalizePinSize(value);
    detailSizeSlider.value=String(detailSize);$("detailSizeValue").value=detailSize+"%";
    if(persist){try{localStorage.setItem(DETAIL_SIZE_KEY,String(detailSize));}catch{}}
    positionDetail();
  }
  setPinSize(pinSize);setDetailSize(detailSize);
  pinSizeSlider.addEventListener("input",()=>setPinSize(pinSizeSlider.value,true));
  detailSizeSlider.addEventListener("input",()=>setDetailSize(detailSizeSlider.value,true));
  $("settingsReset").addEventListener("click",()=>{setPinSize(100,true);setDetailSize(100,true);});
  setPhotoSize(photoSize);
  photoSizeSlider.addEventListener("input",()=>setPhotoSize(photoSizeSlider.value,true));
  $("settingsReset").addEventListener("click",()=>setPhotoSize(100,true));
  function setPopupSensitivity(value,persist=false){
    popupSensitivity=Math.max(0.5,Math.min(4,Number(value)||2));
    sensitivity.value=String(popupSensitivity);
    $("popupSensitivityValue").value=sensitivity.value;
    if(persist){try{localStorage.setItem(SENSITIVITY_KEY,sensitivity.value);}catch{}}
    resizePopups();
  }
  setPopupSensitivity(popupSensitivity);
  $("settingsReset").addEventListener("click",()=>setPopupSensitivity(2,true));
  sensitivity.addEventListener("input",()=>setPopupSensitivity(sensitivity.value,true));
  applyFeatureSettings();
  window.addEventListener("storage",event=>{
    if(event.key===TRANSPORT_ROUTE_STORAGE_KEY){state.transportRoutes=readSavedTransportRoutes();renderTransportRoutes();renderMultimodalRoutes();renderItineraryBuilderUI();}
    if(event.key==="map-canvas:itineraries-v1"){
      state.itineraries=readSavedItineraries();
      if(!state.itineraryDirty&&state.itineraryActiveId){const current=state.itineraries.find(x=>x.id===state.itineraryActiveId);if(current)state.itineraryDraft=cloneItinerary(current);else{state.itineraryDraft=createItinerary();state.itineraryActiveId=null;}}
      renderItineraryBuilderUI();
    }
    if(event.key===PHOTO_SIZE_KEY)setPhotoSize(event.newValue);
    if(event.key===PIN_SIZE_KEY)setPinSize(event.newValue);
    if(event.key===DETAIL_SIZE_KEY)setDetailSize(event.newValue);
    if(event.key===DETAIL_AUTO_CLOSE_KEY)setDetailAutoClose(event.newValue);
    if(event.key===SENSITIVITY_KEY)setPopupSensitivity(event.newValue);
    if(event.key===PIN_VISIBILITY_KEY){
      state.hiddenPinThemes=readPinVisibility();
      settingsUI.sync();
      render();
      if(state.map)applyDeepLink();
    }
    if(event.key===FEATURE_STORAGE_KEY){
      state.features=readFeatureSettings();
      applyFeatureSettings();
      settingsUI.sync();
    }
  });
  await setupOffline();
  try{
    const cached=readMapCache();
    if(Array.isArray(cached)){
      setMapEntries(cached);
      state.localReady=true;
      state.revision=readCachedRevision();
    }
  }catch(error){console.warn("Saved offline map could not be loaded:",error);}
  try{
    if(localStorage.getItem(LOCAL_MAP_KEY))$("settingsLegacy").hidden=false;
  }catch{}
  try{await loadHostels();}catch(error){
    const cached=readMapCache();
    if(Array.isArray(cached)){
      try{
        setMapEntries(cached);
        state.localReady=true;
        state.revision=readCachedRevision();
        notify("Offline: showing the saved map. New edits will queue on this device.");
      }catch(e){notify(e.message,true);}
    }else{
      state.localReady=false;
      try{
        const response=await fetch("./data/public-map.json",{cache:"no-store"});
        if(response.ok)setMapEntries(await response.json());
      }catch{}
      notify("Shared map unavailable: "+error.message,true);
    }
    $("syncState").textContent=state.localReady?"Offline snapshot · edits can queue":"Connection lost · retry";
    $("statusText").textContent=state.localReady?"Saved map · offline edits will sync later":"No saved shared map yet";
    $("statusPip").classList.remove("connected");
  }
  await refreshOfflineStatus();
  render();
  await initMap();
  render();
  applyDeepLink();
  setInterval(()=>reloadShared(true),5000);
  window.addEventListener("resize",positionDetail);
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
    getLocalPins: () => allEntries(),
    openOfflineDialog,
    getOfflineQueue: () => listQueuedChanges(),
    getOfflineAreas: () => listOfflineAreas(),
    getRouteSelection: () => state.routeSelectedIds.slice(),
    getOptimizedRoute: () => state.optimizedRoute,
    selectRoutePins: ids => {state.routeSelectedIds=ids.slice();state.routeSelecting=false;clearRouteDisplay();render();},
    getTransportRoutes: () => state.transportRoutes.slice(),
    startTransportRoute,
    selectTransportPin,
    renderMultimodalRoutes,
    showTransportInfo,
    optimizeSelectedRoute
  };
}
main().catch((error)=>notify(error.message,true));
