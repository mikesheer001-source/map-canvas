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
    if(!map.getLayer("canvas-pin-dots"))throw Error("Missing native pin hit layer");
    if(map.getSource("canvas-geo-pins").getClusterOptions?.().cluster!==false)
      throw Error("Pin clustering should be disabled");
    if(map.getLayer("canvas-clusters"))throw Error("Grouped pins should not render");
    const sample=api.getEntries().filter(e=>Number.isFinite(e.lat)&&Number.isFinite(e.lng)).slice(0,3);
    if(sample.length!==3)throw Error("Missing map pin data");
    const counts=[];
    for(const zoom of [12,15.5,17.5]){
      for(const entry of sample) {
        map.jumpTo({center:[entry.lng,entry.lat],zoom});
        // WebGL renders asynchronously, especially after network-backed tile changes.
        // Assert against a rendered frame, not a fixed 300ms sleep.
        const deadline=performance.now()+7000;
        let hits=[],screen;
        do {
          await new Promise(done=>setTimeout(done,110));
          map.triggerRepaint();
          screen=map.project([entry.lng,entry.lat]);
          hits=map.queryRenderedFeatures(screen,{layers:["canvas-pin-dots"]});
          if(hits.some(f=>f.properties.id===entry.id))break;
        } while(performance.now()<deadline);
        if(!hits.some(f=>f.properties.id===entry.id)){
          throw Error(label+" zoom "+zoom+" failed for "+entry.id+
            " at "+JSON.stringify(screen)+"; rendered="+hits.map(f=>f.properties.id).join(",")+
            "; styleReady="+map.isStyleLoaded());
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
  assert.equal(await page.locator(".maplibregl-marker.emoji-pin").count(),13,"Every hostel has a visible emoji");
  assert.equal(await page.locator(".maplibregl-marker.emoji-pin").first().textContent(),"🏨",
    "Hostel icons are thematic");
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
    if(!map.getLayer("canvas-pin-dots"))throw Error("Pin hit layer disappeared while panning");
    if(document.querySelectorAll(".maplibregl-marker.emoji-pin").length!==13)
      throw Error("Emoji pins should remain visible while panning");
    map.fire("moveend");
  });
  // Real DOM interactions: search, category filtering and deep links.
  await page.setViewportSize({width:1200,height:800});
  await page.locator("#search").fill("Viet Vintage");
  assert.equal(await page.locator("#entries .entry").count(),1,"Search narrows the list");
  await page.locator("#search").fill("");
  await page.locator("#categoryFilter").selectOption("Hostel");
  assert.equal(await page.locator("#entries .entry").count(),13,"Category filter includes hostel entries");
  await page.locator("#categoryFilter").selectOption("all");
  await page.locator("#entries .entry").first().click();
  await page.waitForURL(/pin=hostel-1/);
  assert.equal(await page.locator("#detailPanel h2").textContent(),"Viet Vintage Hostel");
  await page.locator("#detailPanel .detail-head button").click();
  assert.ok(!(new URL(page.url()).searchParams.has("pin")),"Closing pin clears deep link");

  // Browser-level canvas tools: layers, two-click drawing and area measurement.
  await page.locator(".layers-panel summary").click();
  const hostelLayer=page.locator('#layerToggles label').filter({hasText:"Hostels"}).locator("input");
  await hostelLayer.uncheck();
  assert.equal(await page.locator("#entries .entry").count(),0,"Layer toggle hides hostel pins");
  await hostelLayer.check();
  assert.equal(await page.locator("#entries .entry").count(),13,"Layer toggle restores hostel pins");
  await page.locator('[data-canvas-tool="line"]').click();
  await page.locator("#map").click({position:{x:250,y:255}});
  await page.locator("#map").click({position:{x:350,y:300}});
  assert.ok(await page.locator("#editor").evaluate(d=>d.open),"Line tool opens shared entry editor");
  assert.equal(await page.locator("#entryLayer").inputValue(),"Drawings");
  await page.locator("#cancelEdit").click();
  await page.locator('[data-canvas-tool="measure"]').click();
  await page.locator("#map").click({position:{x:230,y:330}});
  await page.locator("#map").click({position:{x:320,y:360}});
  await page.locator("#map").click({position:{x:310,y:415}});
  assert.match(await page.locator("#measureReadout").textContent(),/Distance:/);
  await page.locator("#measureFinish").click();
  assert.match(await page.locator("#measureReadout").textContent(),/Area:/);
  await page.locator("#measureClear").click();
  assert.ok(await page.locator("#measureReadout").isHidden());
  await page.screenshot({path:`test-artifacts/${engineName}-canvas-tools-desktop.png`});

  // Settings: immediate application, persistence through reload, and reset.
  await page.locator("#settingsButton").click();
  assert.ok(await page.locator("#settingsDialog").evaluate(el=>el.open));
  await page.locator('#settingsDialog input[data-feature="search"]').uncheck();
  await page.locator('#settingsDialog input[data-feature="labels"]').uncheck();
  await page.locator('#settingsDialog input[data-feature="galleries"]').uncheck();
  assert.ok(await page.locator(".searchwrap").isHidden());
  assert.ok(await page.locator("#toggleLabels").isHidden());
  assert.ok(await page.locator("#galleryControls").isHidden(),"Galleries can be disabled");
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("map-canvas:feature-settings-v1")).search),false);
  await page.locator("#settingsDone").click();
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.__mapCanvasTest?.getMap()?.getLayer?.("canvas-pin-dots"));
  assert.ok(await page.locator(".searchwrap").isHidden(),"Settings persist after reload");
  assert.ok(await page.locator("#galleryControls").isHidden(),"Gallery choice persists");
  assert.equal(await page.evaluate(()=>window.__mapCanvasTest.getMap().getSource("canvas-geo-pins").getClusterOptions().cluster),false);
  await page.locator("#settingsButton").click();
  await page.locator("#settingsReset").click();
  assert.ok(await page.locator(".searchwrap").isVisible(),"Reset restores search");
  assert.equal(await page.locator('#settingsDialog input[data-feature="labels"]').isChecked(),true);
  assert.ok(await page.locator("#galleryControls").isVisible(),"Reset restores galleries");
  assert.ok(!(await page.locator('#settingsDialog input[data-feature="clustering"]').count()));
  await page.locator("#settingsDone").click();
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>window.__mapCanvasTest?.getMap()?.getLayer?.("canvas-pin-dots"));
  assert.ok(await page.locator(".searchwrap").isVisible());

  // No sign-in, and writes must be disabled if the shared backend isn't configured.
  assert.equal(await page.locator("#editor").count(),1);
  await page.waitForFunction(()=>document.querySelector("#syncState")?.textContent==="Sheet not connected");
  assert.equal(await page.locator("#syncState").textContent(),"Sheet not connected");
  assert.deepEqual(errors,[],"Browser JavaScript errors");
  console.log(`PASS ${engineName}: 45 projection tests, 2 basemap switches, mobile geometry, actual drag, CSS and gesture handling`);
} finally {
  await browser.close();
}
