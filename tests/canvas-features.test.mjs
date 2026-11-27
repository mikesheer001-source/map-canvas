import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseCsvRows,parseImport,metersBetween,polygonAreaMeters,
 FEATURE_DEFAULTS,FEATURE_GROUPS,FEATURE_STORAGE_KEY,layoutPinPhotos,
 readFeatureSettings,saveFeatureSettings} from "../enhancements.js";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
for(const id of ["layerFilter","groupFilter","layerToggles","entryLayer","entryGroup","importBtn",
 "importMode","exportBtn","exportFormat","galleryUrls","canvasWidth","canvasOverlay",
 "canvasDrawing","downloadLegacyBtn"])
 assert.ok(html.includes('id="'+id+'"'),"Missing element "+id);
for(const retired of ["image","text","line","arrow","circle","measure"])
 assert.ok(!html.includes('data-canvas-tool="'+retired+'"'));
assert.ok(!html.includes('class="canvas-tools"'));
for(const retired of ["measureFinish","measureClear","measureReadout"])
 assert.ok(!html.includes('id="'+retired+'"'));
assert.ok(!html.includes('id="restoreHiddenPins"'));
assert.ok(!Object.hasOwn(FEATURE_DEFAULTS,"autoSync"));
assert.ok(!Object.hasOwn(FEATURE_DEFAULTS,"canvasTools"));
assert.equal(FEATURE_DEFAULTS.darkTheme,false);
assert.equal(FEATURE_GROUPS.flatMap(g=>g.features).length,Object.keys(FEATURE_DEFAULTS).length);
assert.deepEqual(FEATURE_GROUPS.map(g=>g.features.map(f=>f[0])),[["showAllPictures","avoidPhotoOverlap","onePicturePerPin","pinRatings","labels","darkTheme"],["search","filters","layers"],["gps","navigation","basemaps"],["addPins","undoRedo","galleries","canvasObjects"],["importExport"]]);
assert.equal(new Set(FEATURE_GROUPS.flatMap(g=>g.features.map(f=>f[0]))).size,Object.keys(FEATURE_DEFAULTS).length);
const fake={v:new Map(),getItem(k){return this.v.get(k)||null;},setItem(k,val){this.v.set(k,val);}};
const initial=readFeatureSettings(fake);
assert.deepEqual(initial,{...FEATURE_DEFAULTS});
initial.search=false;initial.canvasObjects=false;initial.avoidPhotoOverlap=true;
assert.equal(saveFeatureSettings(initial,fake),true);
assert.equal(readFeatureSettings(fake).search,false);
assert.equal(readFeatureSettings(fake).canvasObjects,false);
assert.equal(readFeatureSettings(fake).avoidPhotoOverlap,true);
fake.setItem(FEATURE_STORAGE_KEY,"{broken");
assert.deepEqual(readFeatureSettings(fake),{...FEATURE_DEFAULTS});
const parsed=parseCsvRows('id,title,notes,lat,lng\nhostel-1,"Cafe, North","hello ""hi""",21.03,105.85\n');
assert.deepEqual(parsed[1],["hostel-1","Cafe, North",'hello "hi"',"21.03","105.85"]);
const fromCsv=parseImport("id,title,lat,lng,category,source,link\nhostel-1,Changed,21.03,105.85,Hostel,hostel,https://example.com\n","map.csv");
assert.equal(fromCsv[0].id,"hostel-1");
assert.equal(fromCsv[0].source,"hostel");
assert.equal(fromCsv[0].link,"https://example.com");
assert.equal(fromCsv[0].title,"Changed");
const original=JSON.parse(readFileSync(new URL("../data/public-map.json",import.meta.url),"utf8"));
const roundtrip=parseImport(JSON.stringify(original),"map.json");
assert.equal(roundtrip.length,original.length);
assert.deepEqual(roundtrip.map(p=>p.id),original.map(p=>p.id));
assert.equal(roundtrip[0].source,"hostel");
const credited={...original[0],photoCredits:[{
  src:"https://example.com/image.jpg",source:"https://example.com/photo",
  title:"Example photo",author:"Example photographer",license:"CC BY 4.0"
}]};
assert.deepEqual(parseImport(JSON.stringify([credited]),"map.json")[0].photoCredits,credited.photoCredits);
const geo=parseImport(JSON.stringify({type:"FeatureCollection",features:[{
 type:"Feature",geometry:{type:"Point",coordinates:[105.85,21.03]},
 properties:{title:"Geo Pin",layer:"Drawings"}}]}),"pins.geojson");
assert.equal(geo[0].lng,105.85);
assert.throws(()=>parseImport("title,lat,lng\nBad,100,105\n","pins.csv"),/invalid/);
assert.ok(Math.abs(metersBetween([105,21],[105,22])-111195)<500);
assert.ok(polygonAreaMeters([[0,0],[.001,0],[.001,.001],[0,.001]])>12000);
assert.equal(polygonAreaMeters([[0,0],[1,0]]),0);
const sw=readFileSync(new URL("../sw.js",import.meta.url),"utf8");
for(const [source,file] of [[app,"enhancements.js"],[html,"app.js"],[html,"style.css"]]){
 const versionedPath=source.match(/\.\/[^"\s]+\?v=[\w-]+/g).find(path=>path.startsWith("./"+file+"?"));
 assert.ok(versionedPath && sw.includes(versionedPath),file+" should match the offline cache");
}
assert.match(app,/try\{enhanced\.init\(\);\}catch\(error\)/);
assert.match(app,/storeMapSnapshot\(/);
assert.match(app,/downloadLegacyEdits\(/);
assert.doesNotMatch(app,/SHEETS_URL|sheetRequest\(/);
assert.ok(!readFileSync(new URL("../enhancements.js",import.meta.url),"utf8").includes('$("measureFinish")'));
assert.equal(FEATURE_DEFAULTS.avoidPhotoOverlap,false);
const clustered=Array.from({length:12},(_,i)=>({id:String(i),x:150+i%2,y:200,count:i===0?4:1}));
const originalCluster=JSON.stringify(clustered);
const packed=layoutPinPhotos(clustered,350,500,150);
assert.equal(packed.placements.size,clustered.length);
assert.ok(packed.size<150);
const boxes=[...packed.placements.values()];
for(const [i,a] of boxes.entries()){
 assert.ok(a.x>=0&&a.y>=0&&a.x+a.w<=350&&a.y+a.h<=500);
 for(const b of boxes.slice(i+1))assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
}
assert.equal(JSON.stringify(clustered),originalCluster);
assert.deepEqual(layoutPinPhotos(clustered,350,500,150),packed);
const isolated=layoutPinPhotos([{id:"one",x:200,y:200,count:1}],400,400,60);
assert.deepEqual(isolated.placements.get("one"),{x:170,y:118,w:60,h:60,columns:1});
console.log("PASS: Sheets CSV/JSON round-trip, stable IDs, local settings and import/export controls");
await import("./shared-client.test.mjs");
