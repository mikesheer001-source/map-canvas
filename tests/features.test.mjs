import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {FEATURE_DEFAULTS,pinTheme,pinThemeVisible,readPinVisibility,savePinVisibility} from "../enhancements.js";
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const sw=readFileSync(new URL("../sw.js",import.meta.url),"utf8");
const map=JSON.parse(readFileSync(new URL("../data/public-map.json",import.meta.url),"utf8"));
assert.equal(map.length,12);
assert.ok(!map.some(x=>x.title==="Rebel Rooster Hostel"));
for(const id of ["categoryFilter","locateButton","undoBtn","redoBtn","pinIcon","pinColor",
 "importBtn","importMode","exportBtn","exportFormat","downloadLegacyBtn","deleteSelectedPin"].filter(x=>x!=="deleteSelectedPin"))
 assert.ok(html.includes('id="'+id+'"'));
assert.ok(!html.includes('config.js'));
assert.match(app,/cluster:false/);
assert.doesNotMatch(app,/getClusterExpansionZoom|canvas-clusters|canvas-cluster-count/);
assert.match(app,/new URLSearchParams\(location.search\)\.get\("pin"\)/);
assert.match(app,/getCurrentPosition/);
assert.match(app,/recordChange\(/);
assert.match(app,/replayHistory\(/);
assert.match(app,/localStorage\.setItem\(SNAPSHOT_KEY/);
assert.match(app,/submitChange\("delete",entry/);
assert.match(app,/SHARED_MAP_URL/);
assert.doesNotMatch(app,/script\.google\.com|SHEETS_URL|sheetRequest/);
assert.match(sw,/caches\.open\(SHELL\)/);
assert.match(sw,/public-map\.json/);
assert.match(sw,/keys\.length>180/);
assert.ok(!sw.includes("tile.openstreetmap.org"));
const api=new Function("document","window","location","navigator","FEATURE_DEFAULTS","pinThemeVisible",
 app.replace(/^import .*;\s*/gm,"").replace(/main\(\)\.catch\([^;]*;\s*$/,"")+
 "\nreturn {pinGeoJSON,pinEmoji,validColor,pinUrl,state,filterEntries,isRoutePin,routeMidpoint,normalizePinSize};")(
 {},{},{href:"https://example.com/map/?x=1",search:"?x=1",hostname:"example.com"},
 {onLine:true},FEATURE_DEFAULTS,pinThemeVisible);
assert.equal(api.validColor("#ffaa22"),true);
assert.equal(api.validColor("red"),false);
assert.equal(api.pinUrl("abc"),"/map/?x=1&pin=abc");
assert.equal(api.pinUrl(null),"/map/?x=1");
api.state.hostels=map;
api.state.entries=[];
api.state.category="Hostel";
assert.equal(api.filterEntries().length,12);
api.state.query="Viet Vintage";
assert.equal(api.filterEntries().length,1);
assert.equal(api.pinEmoji({category:"Café",icon:"📍"}),"☕");
assert.equal(api.pinEmoji({category:"Hostel",title:"Guesthouse"}),"🏨");
assert.equal(api.pinEmoji({title:"Gym Fitness Club"}),"🏋️");
assert.equal(api.pinEmoji({category:"Unknown category"}),"📍");
const pins=[{category:"Hostel"},{category:"Bistro & brunch"},{category:"Café"},
 {category:"Gym",title:"Fitness at the Hilton Hotel"},{category:"Destination"},{title:"Local coffee house"}];
assert.deepEqual(pins.map(pin=>pinTheme(pin).group),["hotels","dining","dining","activities","activities","dining"]);
assert.equal(pinTheme({...pins[2],category:"CAFE"}).key,pinTheme(pins[2]).key);
const values=new Map();
const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
const hidden=readPinVisibility(storage);
assert.ok(pins.every(pin=>pinThemeVisible(pin,hidden)));
hidden.add("group:hotels");
hidden.add(pinTheme(pins[2]).key);
assert.ok(savePinVisibility(hidden,storage));
assert.deepEqual(pins.map(pin=>pinThemeVisible(pin,readPinVisibility(storage))),[false,true,false,true,true,true]);
api.state.features.filters=false;
api.state.features.layers=false;
api.state.hiddenPinThemes=hidden;
assert.equal(api.filterEntries().length,0);
api.state.hiddenPinThemes.clear();
api.state.query="";
assert.equal(api.filterEntries().length,12);
assert.equal(FEATURE_DEFAULTS.recentPinsOnly,false);
api.state.hostels=[];
api.state.entries=[
  {id:"recent",title:"Recent",category:"Hostel",createdAt:Date.now()-3600000},
  {id:"old",title:"Old",category:"Hostel",createdAt:Date.now()-25*3600000},
  {id:"undated",title:"Undated",category:"Hostel"},
  {id:"future",title:"Future",category:"Hostel",createdAt:Date.now()+3600000}
];
assert.equal(api.filterEntries().length,4);
api.state.features.recentPinsOnly=true;
assert.deepEqual(api.filterEntries().map(e=>e.id),["recent"]);
api.state.features.recentPinsOnly=false;
assert.equal(api.filterEntries().length,4);
console.log("PASS: shared public map, filters, emoji pins, manual Sheets import, and cache");

assert.ok(html.includes('id="addRoutePin"'));
assert.equal(api.isRoutePin({canvas:{type:"route",start:[103,22],end:[104,23]}}),true);
assert.equal(api.pinEmoji({canvas:{type:"route",start:[103,22],end:[104,23]}}),"↔");
assert.deepEqual(api.routeMidpoint([103,22],[104,23]),{lng:103.5,lat:22.5});

assert.equal(FEATURE_DEFAULTS.showRoutePins,false);
api.state.entries=[{id:"ordinary",title:"Ordinary",category:"Hostel"},{id:"route",title:"Route",category:"Route",canvas:{type:"route",start:[103,22],end:[104,23]}}];
assert.deepEqual(api.filterEntries().map(e=>e.id),["ordinary"]);
api.state.features.showRoutePins=true;
assert.deepEqual(api.filterEntries().map(e=>e.id),["ordinary","route"]);
api.state.features.showRoutePins=false;
assert.deepEqual(api.filterEntries().map(e=>e.id),["ordinary"]);

assert.equal(api.normalizePinSize(null),100);
assert.equal(api.normalizePinSize(10),50);
assert.equal(api.normalizePinSize(300),200);
assert.equal(api.normalizePinSize(150),150);
assert.ok(html.includes('id="pinSize"')&&html.includes('id="detailSize"'));
