import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const gs=readFileSync(new URL("../sheets-bridge.gs",import.meta.url),"utf8");
const sw=readFileSync(new URL("../sw.js",import.meta.url),"utf8");
for(const id of ["categoryFilter","locateButton","undoBtn","redoBtn","pinIcon","pinColor"])
  assert.match(html,new RegExp('id="'+id+'"'));
assert.match(app,/cluster:true,clusterRadius:54/);
assert.match(app,/getClusterExpansionZoom/);
assert.match(app,/new URLSearchParams\(location.search\)\.get\("pin"\)/);
assert.match(app,/getCurrentPosition/);
assert.match(app,/recordChange\(/);
assert.match(app,/replayHistory\(/);
assert.match(gs,/const EXTRA_HEADERS = \["Icon","Color"\]/);
assert.match(gs,/getRange\(target,1,1,14\)/);
assert.match(sw,/caches\.open\(SHELL\)/);
assert.match(sw,/keys\.length>180/);
assert.ok(!sw.includes("tile.openstreetmap.org"),"Do not pre-cache OSM tiles");
assert.match(app,/localStorage\.setItem\(SNAPSHOT_KEY/);
assert.match(app,/state\.category === "all"/);
const api = new Function("document","window","location","navigator",app.replace(/main\(\)\.catch\([^;]*;\s*$/,"")+
  "\nreturn {pinGeoJSON,validColor,pinUrl,state,filterEntries};")(
  {},{MAP_CANVAS_CONFIG:{}},{href:"https://example.com/map/?x=1",search:"?x=1",hostname:"example.com"},
  {onLine:true});
assert.equal(api.validColor("#ffaa22"),true);
assert.equal(api.validColor("red"),false);
assert.equal(api.pinUrl("abc"),"/map/?x=1&pin=abc");
assert.equal(api.pinUrl(null),"/map/?x=1");
api.state.hostels=[
 {id:"a",title:"Cafe",category:"Cafe",kind:"place",lat:21,lng:105,color:"#ff1122",icon:"☕"},
 {id:"b",title:"Hostel",category:"Hostel",kind:"place",lat:21.01,lng:105.01,color:"invalid"}
];
api.state.entries=[];
api.state.category="Cafe";
assert.deepEqual(api.filterEntries().map(x=>x.id),["a"]);
api.state.category="all";api.state.query="hostel";
assert.deepEqual(api.filterEntries().map(x=>x.id),["b"]);
assert.equal(api.pinGeoJSON(api.state.hostels).features[0].properties.color,"#ff1122");
assert.equal(api.pinGeoJSON(api.state.hostels).features[1].properties.color,"#245c48");
console.log("PASS: search, category, icons/colors, cluster config, GPS, links, undo/redo, Sheets columns, offline shell");
