import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {chromium, webkit} from "playwright";
const engineName = process.env.MAP_BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const engine = engineName === "webkit" ? webkit : chromium;
const browser = await engine.launch({
  headless:true,...(engineName === "chromium" ? {args:["--use-gl=angle","--use-angle=swiftshader","--enable-webgl"]} : {})
});
const page = await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:1});
const errors=[];
const consoleMessages=[];
const failedRequests=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{
  if(["error","warning"].includes(message.type()))consoleMessages.push(message.text());
});
page.on("requestfailed",request=>failedRequests.push(`${request.url()} - ${request.failure()?.errorText}`));
let revision=1;
let shared=JSON.parse(readFileSync(new URL("../data/public-map.json",import.meta.url),"utf8"))
  .map(entry=>({...entry,version:1}));
const testImage="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCioAAAAASUVORK5CYII=";
shared[0].photo=testImage;
shared[0].gallery=[1,2,3].map(i=>`https://pin-images.example.test/gallery-${i}.png`);
shared.find(entry=>entry.id==="hostel-8").photo=testImage;
await page.route("https://pin-images.example.test/**",route=>route.fulfill({
  contentType:"image/png",body:Buffer.from(testImage.split(",")[1],"base64")
}));
const deleted=new Map();
await page.route("https://map-canvas.mikesheer001.chatgpt.site/api/shared-map/**",async route=>{
  const request=route.request(),url=new URL(request.url());
  const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, PUT, DELETE, POST, OPTIONS","Access-Control-Allow-Headers":"content-type"};
  const respond=(json,status=200)=>route.fulfill({status,headers,json});
  if(request.method()==="OPTIONS")return respond({});
  if(url.pathname.endsWith("/pins")&&request.method()==="GET")return respond({entries:shared,revision});
  const body=request.postDataJSON();
  if(url.pathname.endsWith("/import")){
    const items=body.mode==="replace"?[]:[...shared];
    let added=0,updated=0;
    for(const entry of body.entries){
      const index=items.findIndex(item=>item.id===entry.id);
      if(index<0){items.push({...entry,version:1});added++;}
      else{items[index]={...entry,version:items[index].version+1};updated++;}
    }
    shared=items;return respond({entries:shared,revision:++revision,added,updated});
  }
  const id=decodeURIComponent(url.pathname.split("/").pop());
  const index=shared.findIndex(entry=>entry.id===id);
  const version=index<0?(deleted.get(id)??null):shared[index].version;
  if(body.expectedVersion!==version)return respond({error:"Pin changed"},409);
  if(request.method()==="DELETE"){
    shared.splice(index,1);deleted.set(id,version+1);
    return respond({version:version+1,revision:++revision});
  }
  const entry={...body.entry,version:(version??0)+1};
  if(index<0)shared.push(entry);else shared[index]=entry;
  deleted.delete(id);return respond({entry,revision:++revision});
});
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
        // Verify the visible emoji itself tracks the same projected coordinates.
        const marker=[...document.querySelectorAll(".maplibregl-marker.emoji-pin")]
          .find(el=>el.title===entry.title);
        if(!marker)throw Error("Missing visible emoji for "+entry.id);
        const box=marker.getBoundingClientRect();
        const container=map.getContainer().getBoundingClientRect();
        const visual={x:box.left+box.width/2-container.left,
          y:box.top+box.height/2-container.top};
        if(Math.hypot(visual.x-screen.x,visual.y-screen.y)>4)
          throw Error("Emoji pin drift for "+entry.id+" at zoom "+zoom+
            ": projected="+JSON.stringify(screen)+" visual="+JSON.stringify(visual));
        counts.push({id:entry.id,zoom});
      }
    }
    return counts;
  },label);
}
async function waitForRenderer() {
  try {
    await page.waitForFunction(()=>{
      const api=window.__mapCanvasTest;
      const map=api?.getMap();
      if(api?.getLibrary()==="maplibre")return !!map?.getLayer?.("canvas-pin-dots");
      if(api?.getLibrary()==="leaflet")return !!map && document.querySelectorAll(".leaflet-emoji-marker").length>0;
      return false;
    },null,{timeout:60000});
  } catch(error) {
    const diagnostics=await page.evaluate(()=>({
      renderer:window.__mapCanvasTest?.getLibrary(),
      hasMap:!!window.__mapCanvasTest?.getMap(),
      mapNotice:document.getElementById("mapNotice")?.textContent,
      entries:window.__mapCanvasTest?.getEntries()?.length,
      leafletMarkers:document.querySelectorAll(".leaflet-emoji-marker").length
    }));
    throw new Error(`No working map renderer: ${JSON.stringify(diagnostics)}. `+
      `Page errors: ${JSON.stringify(errors)}. Console: ${JSON.stringify(consoleMessages.slice(-10))}. `+
      `Failed requests: ${JSON.stringify(failedRequests.slice(-10))}. ${error.message}`);
  }
  const renderer=await page.evaluate(()=>window.__mapCanvasTest.getLibrary());
  if(engineName==="chromium")assert.equal(renderer,"maplibre","Chromium must exercise native WebGL geometry");
  return renderer;
}
try {
  await page.goto("http://127.0.0.1:8765/?test=1",{waitUntil:"domcontentloaded"});
  let renderer=await waitForRenderer();
  assert.equal(await page.evaluate(()=>window.__mapCanvasTest.getEntries().length),12);
  assert.equal(await page.locator("#entries .entry").filter({hasText:"Rebel Rooster Hostel"}).count(),0);
  const photoSetting=page.getByRole("checkbox",{name:"Show all pictures",exact:true});
  const floatingPhotos=page.locator('#pinPhotos [data-pin-id="hostel-1"]');
  assert.equal(await floatingPhotos.count(),0,"Photos are off by default");
  await page.locator("#settingsButton").click();
  await photoSetting.check();
  await page.locator("#settingsDone").click();
  await floatingPhotos.waitFor();
  await page.waitForFunction(()=>{
    const images=[...document.querySelectorAll('#pinPhotos [data-pin-id="hostel-1"] img')];
    return images.length===4 && images.every(image=>image.complete&&image.naturalWidth>0);
  });
  assert.equal(await floatingPhotos.textContent(),"","The map overlay contains only images");
  assert.equal(await page.locator(".side-panel").count(),0,"Enabling photos opens no panels");
  const beforePan=await floatingPhotos.boundingBox();
  await page.evaluate(()=>window.__mapCanvasTest.getMap().panBy([75,0],{duration:0,animate:false}));
  await page.waitForFunction(x=>Math.abs(document.querySelector('#pinPhotos [data-pin-id="hostel-1"]')
    .getBoundingClientRect().x-x)>40,beforePan.x);
  const zoomToPhotos=zoom=>page.evaluate(zoom=>{
    const api=window.__mapCanvasTest;
    const map=api.getMap(), {lat,lng}=api.getEntries()[0];
    if(api.getLibrary()==="maplibre")map.jumpTo({center:[lng,lat],zoom});
    else map.setView([lat,lng],zoom,{animate:false});
  },zoom);
  await zoomToPhotos(14);
  await page.waitForFunction(()=>{
    const rect=id=>document.querySelector(`#pinPhotos [data-pin-id="${id}"]`)?.getBoundingClientRect();
    const a=rect("hostel-1"),b=rect("hostel-8");
    return a&&b&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
  });
  const smallPhoto=await floatingPhotos.locator("img").first().boundingBox();
  await page.locator("#settingsButton").click();
  await page.getByRole("slider",{name:"Photo size",exact:true}).fill("300");
  assert.equal(await page.locator("#photoSizeValue").textContent(),"300%");
  assert.equal(await page.locator("#popupSensitivity").inputValue(),"2");
  await page.waitForFunction(width=>document.querySelector('#pinPhotos [data-pin-id="hostel-1"] img')
    ?.getBoundingClientRect().width>width*2.9,smallPhoto.width);
  await page.getByRole("slider",{name:"Photo size",exact:true}).fill("100");
  await page.locator("#settingsDone").click();
  await zoomToPhotos(19);
  await page.waitForFunction(width=>document.querySelector('#pinPhotos [data-pin-id="hostel-1"] img')
    ?.getBoundingClientRect().width>width*1.5,smallPhoto.width);
  const defaultSize=(await floatingPhotos.locator("img").first().boundingBox()).width;
  await page.locator("#settingsButton").click();
  await page.locator("#popupSensitivity").fill("4");
  await page.waitForFunction(width=>document.querySelector('#pinPhotos [data-pin-id="hostel-1"] img')
    ?.getBoundingClientRect().width>width*2,defaultSize);
  await page.locator("#popupSensitivity").fill("2");
  await page.locator("#settingsDone").click();
  await zoomToPhotos(13);
  await floatingPhotos.waitFor({state:"detached"});
  assert.equal(await page.locator("#pinPhotos img").count(),0,"Floating photos are hidden at wide zoom levels");
  await zoomToPhotos(15);
  await floatingPhotos.waitFor();
  await page.locator("#search").fill("AprilBox");
  await floatingPhotos.waitFor({state:"detached"});
  await page.locator("#search").fill("");
  await floatingPhotos.waitFor();
  await page.reload({waitUntil:"domcontentloaded"});
  renderer=await waitForRenderer();
  await floatingPhotos.waitFor();
  await page.locator("#settingsButton").click();
  assert.equal(await photoSetting.isChecked(),true,"Photo mode survives reload");
  await photoSetting.uncheck();
  await page.locator("#settingsDone").click();
  await floatingPhotos.waitFor({state:"detached"});
  if(renderer==="maplibre"){
  assert.equal(await page.locator(".maplibregl-marker.emoji-pin").count(),12,"Every remaining hostel has a visible emoji");
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
    if(document.querySelectorAll(".maplibregl-marker.emoji-pin").length!==12)
      throw Error("Emoji pins should remain visible while panning");
    map.fire("moveend");
  });
  }else{
    assert.equal(await page.locator(".leaflet-emoji-marker").count(),12,"Every hostel has a fallback marker");
    assert.match(await page.locator(".leaflet-emoji-marker").first().textContent(),/🏨/,"Fallback markers use thematic emoji");
    await page.screenshot({path:`test-artifacts/${engineName}-leaflet-pins-desktop.png`});
  }
  // Real DOM interactions: search, category filtering and deep links.
  await page.setViewportSize({width:1200,height:800});
  await page.locator("#search").fill("Viet Vintage");
  assert.equal(await page.locator("#entries .entry").count(),1,"Search narrows the list");
  await page.locator("#search").fill("");
  await page.locator("#categoryFilter").selectOption("Hostel");
  assert.equal(await page.locator("#entries .entry").count(),12,"Category filter includes remaining hostels");
  await page.locator("#categoryFilter").selectOption("all");
  await page.locator("#entries .entry").first().click();
  await page.waitForURL(/pin=hostel-1/);
  assert.equal(await page.locator(".side-panel h2").textContent(),"Viet Vintage Hostel");
  const grid=page.locator(".side-panel .gallery-grid");
  assert.equal(await grid.locator("a").count(),4,"Four gallery images appear");
  const tiles=await grid.locator("a").evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  assert.ok(Math.abs(tiles[0].right-tiles[1].left)<1 && Math.abs(tiles[0].bottom-tiles[2].top)<1,"Gallery tiles touch");
  await page.locator("#entries .entry").nth(1).click();
  assert.equal(await page.locator(".side-panel").count(),2,"Two pins remain open");
  await page.locator("#entries .entry").first().click();
  assert.equal(await page.locator(".side-panel").count(),1,"Clicking the same pin closes only its panel");
  await page.locator("#entries .entry").first().click();
  await page.locator(".side-panel").filter({hasText:"Viet Vintage"}).locator(".detail-head button").click();
  assert.equal(await page.locator(".side-panel").count(),1,"Closing one leaves the other open");
  assert.equal(await page.locator(".side-panel h2").textContent(),"AprilBox Trackside Hostel");
  // Focus the remaining pin after it may have moved outside the viewport.
  await page.locator("#entries .entry").nth(1).click();
  await page.locator("#entries .entry").nth(1).click();
  await page.locator(".side-panel .detail-head button").click();
  assert.ok(!(new URL(page.url()).searchParams.has("pin")),"Closing pin clears deep link");

  // Delete immediately from the shared map, without a confirmation dialog.
  await page.locator("#entries .entry").first().click();
  assert.equal(await page.locator(".delete-selected-pin").textContent(),"Delete pin");
  assert.equal(await page.locator(".delete-selected-pin").isEnabled(),true);
  await page.locator(".delete-selected-pin").click();
  await page.waitForFunction(()=>window.__mapCanvasTest.getEntries().length===11);
  assert.equal(await page.locator("#entries .entry").count(),11);
  assert.equal(shared.length,11);
  await page.reload({waitUntil:"domcontentloaded"});
  renderer=await waitForRenderer();
  assert.equal(await page.locator("#entries .entry").count(),11,"Deletion persists after reload");
  // A fresh change can be undone and reflected on the shared map.
  await page.locator("#entries .entry").first().click();
  await page.locator(".delete-selected-pin").click();
  await page.waitForFunction(()=>window.__mapCanvasTest.getEntries().length===10);
  await page.waitForFunction(()=>!document.getElementById("undoBtn").disabled);
  await page.locator("#undoBtn").click();
  await page.waitForFunction(()=>window.__mapCanvasTest.getEntries().length===11);
  assert.equal(shared.length,11,"Undo restores the shared pin");

  // Dark interface and actual MapLibre dark basemap; both must survive reload.
  await page.locator("#themeToggle").click();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),"dark");
  assert.equal(await page.locator("#themeToggle").getAttribute("aria-pressed"),"true");
  if(renderer==="maplibre")await page.waitForFunction(()=>window.__mapCanvasTest.getMap().isStyleLoaded() &&
    window.__mapCanvasTest.getMap().getLayer("canvas-pin-dots"),null,{timeout:30000});
  await page.screenshot({path:`test-artifacts/${engineName}-dark-theme-map.png`});
  await page.reload({waitUntil:"domcontentloaded"});
  renderer=await waitForRenderer();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),"dark","Dark mode survives reload");
  await page.locator("#settingsButton").click();
  assert.equal(await page.locator('#settingsDialog input[data-feature="darkTheme"]').isChecked(),true,
    "Settings reflects header dark toggle");
  await page.locator('#settingsDialog input[data-feature="darkTheme"]').uncheck();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),"light");
  await page.locator("#settingsDone").click();
  if(renderer==="maplibre")await page.waitForFunction(()=>window.__mapCanvasTest.getMap().getLayer("canvas-pin-dots"),null,{timeout:30000});

  // No floating Picture/Text toolbar or empty white rectangle.
  assert.equal(await page.locator(".canvas-tools").count(),0);
  assert.equal(await page.locator("[data-canvas-tool]").count(),0);
  await page.screenshot({path:`test-artifacts/${engineName}-map-without-toolbar.png`});

  // Add a pin without Sheets, then round-trip a full JSON export and Sheets CSV.
  await page.locator("#addButton").click();
  await page.locator("#map").click({position:{x:350,y:280}});
  assert.ok(await page.locator("#editor").evaluate(el=>el.open));
  await page.locator("#title").fill("Browser Saved Cafe");
  await page.locator("#category").fill("Cafe");
  await page.locator("#saveEntry").click();
  await page.waitForFunction(()=>window.__mapCanvasTest.getEntries().length===12);
  assert.equal(await page.locator("#entries .entry").count(),12);
  const [fileDownload]=await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportFormat").selectOption("json").then(()=>
      page.locator("#exportBtn").click())
  ]);
  assert.equal(fileDownload.suggestedFilename(),"map-canvas.json");
  const exported=JSON.parse(readFileSync(await fileDownload.path(),"utf8"));
  assert.equal(exported.length,12,"JSON backup includes all map entries");
  await page.locator("#importMode").selectOption("merge");
  await page.locator("#importFile").setInputFiles({
    name:"google-sheet.csv",mimeType:"text/csv",
    buffer:Buffer.from("title,lat,lng,category\nImported Sheet Cafe,21.0345,105.851,Cafe\n")
  });
  await page.waitForFunction(()=>window.__mapCanvasTest.getEntries().length===13);
  await page.reload({waitUntil:"domcontentloaded"});
  renderer=await waitForRenderer();
  assert.equal(await page.locator("#entries .entry").count(),13,"CSV import persists on reload");

  // Settings: immediate application, persistence through reload, and reset.
  await page.locator("#settingsButton").click();
  assert.ok(await page.locator("#settingsDialog").evaluate(el=>el.open));
  assert.equal(await page.locator('#settingsDialog input[data-feature="measure"]').count(),0);
  assert.equal(await page.locator('#settingsDialog input[data-feature="canvasTools"]').count(),0);
  await page.locator("#popupSensitivity").fill("3");
  await page.getByRole("slider",{name:"Photo size",exact:true}).fill("200");
  await page.locator('#settingsDialog input[data-feature="search"]').uncheck();
  await page.locator('#settingsDialog input[data-feature="labels"]').uncheck();
  await page.locator('#settingsDialog input[data-feature="galleries"]').uncheck();
  assert.ok(await page.locator(".searchwrap").isHidden());
  assert.ok(await page.locator("#toggleLabels").isHidden());
  assert.equal(await page.locator("#galleryControls").evaluate(el=>el.classList.contains("feature-hidden")),true,"Galleries can be disabled");
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("map-canvas:feature-settings-v1")).search),false);
  await page.locator("#settingsDone").click();
  await page.reload({waitUntil:"domcontentloaded"});
  renderer=await waitForRenderer();
  assert.ok(await page.locator(".searchwrap").isHidden(),"Settings persist after reload");
  assert.equal(await page.locator("#galleryControls").evaluate(el=>el.classList.contains("feature-hidden")),true,"Gallery choice persists");
  if(renderer==="maplibre")assert.equal(await page.evaluate(()=>window.__mapCanvasTest.getMap().getSource("canvas-geo-pins").getClusterOptions().cluster),false);
  await page.locator("#settingsButton").click();
  assert.equal(await page.locator("#popupSensitivity").inputValue(),"3","Sensitivity persists after reload");
  assert.equal(await page.getByRole("slider",{name:"Photo size",exact:true}).inputValue(),"200","Photo size persists after reload");
  await page.locator("#settingsReset").click();
  assert.equal(await page.locator("#popupSensitivity").inputValue(),"2","Reset restores sensitivity");
  assert.equal(await page.getByRole("slider",{name:"Photo size",exact:true}).inputValue(),"100","Reset restores photo size");
  assert.ok(await page.locator(".searchwrap").isVisible(),"Reset restores search");
  assert.equal(await page.locator('#settingsDialog input[data-feature="labels"]').isChecked(),true);
  assert.equal(await page.locator("#galleryControls").evaluate(el=>el.classList.contains("feature-hidden")),false,"Reset restores galleries");
  assert.ok(!(await page.locator('#settingsDialog input[data-feature="clustering"]').count()));
  await page.locator("#settingsDone").click();
  await page.reload({waitUntil:"domcontentloaded"});
  renderer=await waitForRenderer();
  assert.ok(await page.locator(".searchwrap").isVisible());

  // Shared public map with no sign-in.
  assert.equal(await page.locator("#editor").count(),1);
  assert.match(await page.locator("#syncState").textContent(),/Shared map synced/);
  assert.equal(await page.locator("script[src*='config.js']").count(),0);
  assert.deepEqual(errors,[],"Browser JavaScript errors");
  console.log(`PASS ${engineName} (${renderer}): map rendering, shared delete/save persistence, CSV import, JSON export and settings`);
} finally {
  await browser.close();
}
