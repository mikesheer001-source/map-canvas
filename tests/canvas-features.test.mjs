import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseCsvRows,parseImport,metersBetween,polygonAreaMeters,
  FEATURE_DEFAULTS,FEATURE_GROUPS,FEATURE_STORAGE_KEY,readFeatureSettings,saveFeatureSettings} from "../enhancements.js";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const code=readFileSync(new URL("../sheets-bridge.gs",import.meta.url),"utf8");
for(const id of ["layerFilter","groupFilter","layerToggles","entryLayer","entryGroup","importBtn",
 "exportBtn","exportFormat","galleryUrls","canvasWidth","canvasOverlay","canvasDrawing"])assert.match(html,new RegExp('id="'+id+'"'));
for(const tool of ["image","text"])
 assert.ok(html.includes('data-canvas-tool="'+tool+'"'));
for(const retired of ["line","arrow","circle","measure"])
 assert.ok(!html.includes('data-canvas-tool="'+retired+'"'),"Retired tool should be absent: "+retired);
for(const retiredControl of ["measureFinish","measureClear","measureReadout"])
 assert.ok(!html.includes('id="'+retiredControl+'"'),"Retired control should be absent: "+retiredControl);
assert.ok(app.includes('createEnhancements('));
assert.ok(app.includes('enhanced.startPolling()'));
assert.ok(app.includes('enhanced?.attachPinDrag'));
assert.ok(app.includes('enhanced?.collectEditor'));
assert.ok(code.includes('body.action==="bulk"'));
assert.ok(code.includes('MAX_ROWS'));
assert.ok(code.includes('extraJSON_(entry)'));
assert.ok(code.includes('readMeta_(r[14])'));
assert.ok(code.includes('getRange(first,1,values.length,15)'));
const rows=parseCsvRows('title,notes,lat,lng\n"Cafe, North","hello ""hi""",21.03,105.85\n');
assert.deepEqual(rows,[["title","notes","lat","lng"],["Cafe, North",'hello "hi"',"21.03","105.85"]]);
const pins=parseImport('title,lat,lng,layer,group\nCafe,21.03,105.85,Food,Asia/Vietnam\n','pins.csv');
assert.equal(pins.length,1);assert.equal(pins[0].layer,"Food");assert.equal(pins[0].group,"Asia/Vietnam");
assert.equal(pins[0].kind,"place");assert.match(pins[0].id,/^[a-f0-9-]{36}$/);
const json=parseImport(JSON.stringify({type:"FeatureCollection",features:[{
 type:"Feature",geometry:{type:"Point",coordinates:[105.85,21.03]},
 properties:{title:"Geo Pin",layer:"Drawings"}}]}),"pins.geojson");
assert.equal(json[0].lng,105.85);assert.equal(json[0].layer,"Drawings");
assert.throws(()=>parseImport('title,lat,lng\nBad,100,105\n','pins.csv'),/invalid/);
assert.ok(Math.abs(metersBetween([105,21],[105,22])-111195)<500);
assert.ok(polygonAreaMeters([[0,0],[.001,0],[.001,.001],[0,.001]])>12000);
assert.equal(polygonAreaMeters([[0,0],[1,0]]),0);
console.log("PASS: new canvas controls, imports CSV/GeoJSON, distance and area math, Sheets metadata/bulk actions");

const fakeStore={db:new Map(),getItem(k){return this.db.get(k)||null;},setItem(k,v){this.db.set(k,v);}};
const pref=readFeatureSettings(fakeStore);
assert.deepEqual(pref,{...FEATURE_DEFAULTS});
assert.equal(FEATURE_GROUPS.flatMap(x=>x.features).length,Object.keys(FEATURE_DEFAULTS).length);
pref.search=false;pref.canvasTools=false;
assert.equal(saveFeatureSettings(pref,fakeStore),true);
assert.equal(JSON.parse(fakeStore.getItem(FEATURE_STORAGE_KEY)).search,false);
assert.equal(readFeatureSettings(fakeStore).canvasTools,false);
assert.equal(readFeatureSettings(fakeStore).autoSync,true);
fakeStore.setItem(FEATURE_STORAGE_KEY,JSON.stringify({search:false,autoSync:"false",rogue:false}));
assert.equal(readFeatureSettings(fakeStore).search,false);
assert.equal(readFeatureSettings(fakeStore).autoSync,true);
assert.ok(!("rogue" in readFeatureSettings(fakeStore)));
fakeStore.setItem(FEATURE_STORAGE_KEY,"{broken");
assert.deepEqual(readFeatureSettings(fakeStore),{...FEATURE_DEFAULTS});
for(const id of ["settingsButton","settingsDialog","settingsGroups","settingsReset","settingsClose","settingsDone"])
  assert.ok(html.includes('id="'+id+'"'));
assert.match(app,/readFeatureSettings\(\)/);
assert.match(app,/applyFeatureSettings\(/);
assert.match(app,/renderEmojiMarkers/);
assert.equal("clustering" in FEATURE_DEFAULTS,false);
console.log("PASS: settings defaults, persistence, invalid storage, feature switches and reset controls");

assert.ok(!Object.hasOwn(FEATURE_DEFAULTS,"measure"));
assert.ok(!FEATURE_GROUPS.some(g=>g.features.some(row=>row[0]==="measure")));

// Regression: a stale cached enhancements module caused the startup crash
// '$("measureFinish").addEventListener' after the Measure button was removed.
assert.match(app,/enhancements\.js\?v=global-delete-20261114/);
const toolSource=readFileSync(new URL("../enhancements.js",import.meta.url),"utf8");
assert.ok(!toolSource.includes('$("measureFinish")'));
assert.ok(!toolSource.includes('$("measureClear")'));
assert.ok(!toolSource.includes('$("measureReadout")'));
assert.match(app,/try\{enhanced\.init\(\);\}catch\(error\)/);

assert.equal(FEATURE_DEFAULTS.darkTheme,false);
assert.ok(FEATURE_GROUPS.some(g=>g.features.some(row=>row[0]==="darkTheme")));
assert.ok(html.includes('id="themeToggle"'));
assert.ok(!html.includes('id="restoreHiddenPins"'));
assert.match(app,/openFreeMapStyle\(\)/);
assert.match(app,/https:\/\/tiles\.openfreemap\.org\/styles\/dark/);
console.log("PASS: global deletion UI and persisted dark theme controls");

const hotelData=JSON.parse(readFileSync(new URL("../data/hostels.json",import.meta.url),"utf8"));
assert.equal(hotelData.length,12);
assert.equal(hotelData.some(h=>h.title==="Rebel Rooster Hostel"),false);
assert.match(app,/deletedIds\?\.includes\(entry\.id\)/);
assert.match(app,/deleteButton\.disabled=!state\.sheetConnected/);
assert.doesNotMatch(app,/confirm\(.+Delete this public entry/);
const bridge=readFileSync(new URL("../sheets-bridge.gs",import.meta.url),"utf8");
assert.match(bridge,/RETIRED_SEED_IDS=\["hostel-4"\]/);
assert.match(bridge,/\bdeletedIds\s*\}/);
assert.match(bridge,/markDeleted_\(store\.book,entry\.id,"hostel"\)/);
assert.match(bridge,/markDeleted_\(store\.book,entry\.id,"shared"\)/);
assert.match(bridge,/body\.action==="delete"/);
console.log("PASS: retired hostel is globally absent; shared delete tombstones and UI backend gating");
