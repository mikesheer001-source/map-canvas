import assert from "node:assert/strict";
import {chromium, webkit} from "playwright";
const engineName = process.env.MAP_BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const engine = engineName === "webkit" ? webkit : chromium;
const browser = await engine.launch({
  headless:true,...(engineName === "chromium" ? {args:["--use-gl=angle","--use-angle=swiftshader","--enable-webgl"]} : {})
});
const page = await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:1});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
async function verifyAnchors(label) {
  return page.evaluate(async(label)=>{
    const api=window.__mapCanvasTest;
    const map=api.getMap();
    if(api.getLibrary()!=="maplibre")throw Error("Native MapLibre renderer unavailable");
    if(!map.getLayer("canvas-pin-dots"))throw Error("Missing native circle layer");
    const sample=api.getEntries().filter(e=>Number.isFinite(e.lat)&&Number.isFinite(e.lng)).slice(0,3);
    if(sample.length!==3)throw Error("Missing map pin data");
    const counts=[];
    for(const zoom of [12,15.5,17.5]){
      for(const entry of sample) {
        map.jumpTo({center:[entry.lng,entry.lat],zoom});
        await new Promise(done=>setTimeout(done,300));
        const screen=map.project([entry.lng,entry.lat]);
        const hits=map.queryRenderedFeatures(screen,{layers:["canvas-pin-dots"]});
        if(!hits.some(f=>f.properties.id===entry.id)){
          throw Error(label+" zoom "+zoom+" failed for "+entry.id+" at "+JSON.stringify(screen));
        }
        counts.push({id:entry.id,zoom});
      }
    }
    return counts;
  },label);
}
try {
  await page.goto("http://127.0.0.1:8765/?test=1",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.__mapCanvasTest?.getMap()?.getLayer?.("canvas-pin-dots"),null,{timeout:60000});
  assert.equal(await page.evaluate(()=>window.__mapCanvasTest.getEntries().length),13);
  let checks=await verifyAnchors("initial");
  assert.equal(checks.length,9);
  await page.screenshot({path:`test-artifacts/${engineName}-maplibre-pins-desktop.png`});

  // Switch to raster OSM. Map.setStyle removes custom layers: they must restore.
  await page.locator("#basemapButton").click();
  await page.locator('[data-basemap="openstreetmap"]').click();
  await page.waitForFunction(()=>{
    const map=window.__mapCanvasTest?.getMap();
    return map?.getLayer?.("canvas-pin-dots") && map?.getSource?.("canvas-geo-pins");
  },null,{timeout:30000});
  checks=await verifyAnchors("raster");
  assert.equal(checks.length,9);

  await page.locator("#basemapButton").click();
  await page.locator('[data-basemap="openfreemap"]').click();
  await page.waitForFunction(()=>window.__mapCanvasTest?.getMap()?.getLayer?.("canvas-pin-dots"),null,{timeout:30000});
  assert.equal((await verifyAnchors("vector")).length,9);

  // Simulate a genuine drag on the map viewport (not a programmatic camera jump).
  const beforeDrag = await page.evaluate(() => {
    const p=window.__mapCanvasTest.getMap().getCenter(); return [p.lng,p.lat];
  });
  await page.mouse.move(710,380);
  await page.mouse.down();
  await page.mouse.move(850,460,{steps:12});
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterDrag = await page.evaluate(() => {
    const p=window.__mapCanvasTest.getMap().getCenter(); return [p.lng,p.lat];
  });
  assert.notDeepEqual(afterDrag,beforeDrag,"Touch-style drag must actually pan the map");
  assert.equal((await verifyAnchors("drag")).length,9);

  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.__mapCanvasTest.getMap().resize());
  assert.equal((await verifyAnchors("mobile")).length,9);
  await page.evaluate(()=>window.__mapCanvasTest.getMap().jumpTo({center:[105.8502,21.0345],zoom:17.5}));
  await page.waitForFunction(()=>document.querySelectorAll(".maplibregl-marker.canvas-pin").length>0);
  const positioned=await page.locator(".maplibregl-marker.canvas-pin").first().evaluate(node=>getComputedStyle(node).position);
  assert.equal(positioned,"absolute","Label card positioning must not override MapLibre's anchor");
  await page.screenshot({path:`test-artifacts/${engineName}-maplibre-mobile-labels.png`});

  // Labels vanish during drag; the native dot layer persists.
  await page.evaluate(()=>{
    const map=window.__mapCanvasTest.getMap();
    map.fire("movestart");
    if(document.querySelectorAll(".maplibregl-marker.canvas-pin").length!==0)
      throw Error("DOM labels should not drift during a gesture");
    if(!map.getLayer("canvas-pin-dots"))throw Error("Dots disappeared while panning");
    map.fire("moveend");
  });
  assert.deepEqual(errors,[],"Browser JavaScript errors");
  console.log(`PASS ${engineName}: 45 projection tests, 2 basemap switches, mobile geometry, actual drag, CSS and gesture handling`);
} finally {
  await browser.close();
}
