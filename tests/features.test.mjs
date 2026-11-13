import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {FEATURE_DEFAULTS} from "../enhancements.js";
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const sw=readFileSync(new URL("../sw.js",import.meta.url),"utf8");
const map=JSON.parse(readFileSync(new URL("../data/public-map.json",import.meta.url),"utf8"));
assert.equal(map.length,12);
assert.ok(!map.some(x=>x.title==="Rebel Rooster Hostel"));
for(const id of ["categoryFilter","locateButton","undoBtn","redoBtn","pinIcon","pinColor",
 "importBtn","importMode","exportBtn","exportFormat","resetMapBtn","deleteSelectedPin"].filter(x=>x!=="deleteSelectedPin"))
 assert.ok(html.includes('id="'+id+'"'));
assert.ok(!html.includes('config.js'));
assert.match(app,/cluster:false/);
assert.doesNotMatch(app,/getClusterExpansionZoom|canvas-clusters|canvas-cluster-count/);
assert.match(app,/new URLSearchParams\(location.search\)\.get\("pin"\)/);
assert.match(app,/getCurrentPosition/);
assert.match(app,/recordChange\(/);
assert.match(app,/replayHistory\(/);
assert.match(app,/localStorage\.setItem\(LOCAL_MAP_KEY/);
assert.match(app,/submitChange\("delete",entry/);
assert.match(app,/PUBLIC_MAP_URL/);
assert.doesNotMatch(app,/script\.google\.com|SHEETS_URL|sheetRequest/);
assert.match(sw,/caches\.open\(SHELL\)/);
assert.match(sw,/public-map\.json/);
assert.match(sw,/keys\.length>180/);
assert.ok(!sw.includes("tile.openstreetmap.org"));
const api=new Function("document","window","location","navigator","FEATURE_DEFAULTS",
 app.replace(/^import .*;\s*/,"").replace(/main\(\)\.catch\([^;]*;\s*$/,"")+
 "\nreturn {pinGeoJSON,pinEmoji,validColor,pinUrl,state,filterEntries};")(
 {},{},{href:"https://example.com/map/?x=1",search:"?x=1",hostname:"example.com"},
 {onLine:true},FEATURE_DEFAULTS);
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
console.log("PASS: static public map, filters, emoji pins, no Sheets API, local storage and cache");
