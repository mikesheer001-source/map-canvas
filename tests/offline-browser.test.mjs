import assert from "node:assert/strict";
import {once} from "node:events";
import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {chromium, webkit} from "playwright";

const port = 18764;
const site = `http://127.0.0.1:${port}/`;
const photoSite = `http://127.0.0.1:${port + 1}/`;
const serve = port => spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {stdio:"ignore"});
const servers = [serve(port), serve(port + 1)];
const engine = process.env.MAP_BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
let browser, page;
const messages = [];
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await Promise.all([fetch(site), fetch(photoSite)]); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const args = engine === "chromium" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"] : [];
  browser = await (engine === "webkit" ? webkit : chromium).launch({headless:true,args});
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
  const entries = JSON.parse(readFileSync(new URL("../data/public-map.json", import.meta.url), "utf8"));
  for (const entry of entries) { entry.photo = ""; entry.gallery = []; }
  Object.assign(entries[0], {lat:21.0345,lng:105.8503});
  Object.assign(entries[1], {lat:21.0347,lng:105.8505});
  entries[0].photo = new URL("./tests/offline-photo.svg", site).href;
  entries[0].notes = "Offline note fixture";
  entries[1].photo = new URL("./tests/offline-photo.svg", photoSite).href;
  entries.at(-1).lat = 21.14;
  await context.route("https://map-canvas.mikesheer001.chatgpt.site/api/shared-map/**", route =>
    route.fulfill({headers:{"Access-Control-Allow-Origin":"*"},json:{entries,revision:1}})
  );
  await context.route("https://tiles.openfreemap.org/styles/**", route =>
    route.fulfill({headers:{"Access-Control-Allow-Origin":"*"},json:{
      version:8,sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#eee"}}]
    }})
  );
  const watch = tab => {
    tab.on("pageerror", error => messages.push(error.message));
    tab.on("console", message => {
      if (["warning","error"].includes(message.type())) messages.push(message.text());
    });
  };
  page = await context.newPage();
  watch(page);
  await page.goto(site);
  await page.waitForFunction(() => window.__mapCanvasTest?.getMap()?.getLayer?.("canvas-pin-dots"));
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.waitForFunction(() => document.querySelector("#syncState").textContent.includes("synced"));
  await page.click("#offlineButton");
  await page.click("#offlineChoose");
  await page.click("#offlineDownload");
  await page.waitForFunction(() => document.querySelector("#offlineAreas").textContent.includes("pins"),null,{timeout:90000});
  const saved = await page.evaluate(() => new Promise((resolve,reject) => {
    const request = indexedDB.open("map-canvas-offline-v1");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const records = db.transaction("areas").objectStore("areas").getAll();
      records.onsuccess = () => { db.close(); resolve(records.result); };
      records.onerror = () => { db.close(); reject(records.error); };
    };
  }));
  assert.equal(saved.length,1);
  const [area] = saved;
  assert.ok(area.entries.length > 0 && area.entries.length < entries.length,"Save pins in the selected area only");
  assert.ok(area.entries.some(entry => entry.notes === "Offline note fixture"));
  assert.equal(area.missing,0);
  assert.ok(area.bounds[2] > area.bounds[0]);

  await page.close();
  // Older Playwright WebKit rejects even service-worker responses under its
  // simulated offline flag (microsoft/playwright#42775). Stop both real origin
  // servers and make the app see the phone's offline indicator in this engine.
  if (engine === "webkit") {
    await context.addInitScript(() => Object.defineProperty(navigator,"onLine",{value:false}));
  } else {
    await context.setOffline(true);
  }
  await context.unrouteAll();
  await Promise.all(servers.map(server => {
    const exitServer = once(server,"exit");
    server.kill();
    return exitServer;
  }));
  page = await context.newPage();
  watch(page);
  const offlineNavigation = await page.goto(site);
  assert.equal(offlineNavigation?.fromServiceWorker(),true,"The offline page comes from the service worker");
  await page.waitForFunction(() => window.__mapCanvasTest?.getMap()?.isStyleLoaded(),null,{timeout:30000});
  assert.equal(await page.evaluate(() => navigator.onLine),false);
  assert.equal(await page.evaluate(() => window.__mapCanvasTest.getEntries().length),area.entries.length);
  assert.ok(await page.locator("#addButton").isDisabled());
  const savedPhotos = area.entries.map(entry => entry.photo).filter(Boolean);
  assert.equal(savedPhotos.length,2,"The downloaded area retains both same-origin and opaque photos");
  assert.ok(savedPhotos.every(url => url.includes("/data/offline/photos/")));
  for (const savedPhoto of savedPhotos) {
    assert.ok(await page.evaluate(url => new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0);
      image.onerror = () => resolve(false);
      image.src = url;
    }),savedPhoto));
  }
  await page.waitForFunction(() =>
    window.__mapCanvasTest.getMap().querySourceFeatures("hanoi",{sourceLayer:"roads"}).length > 0
  ,null,{timeout:30000});
  assert.equal(await page.evaluate(() => window.__mapCanvasTest.getMap().getStyle().sources.hanoi.type),"vector");
  await page.click("#offlineButton");
  await page.getByRole("button",{name:"Remove",exact:true}).waitFor();
  assert.match(await page.locator("#offlineAreas").innerText(),/pins/);
  await page.getByRole("button",{name:"Remove",exact:true}).click();
  await page.waitForFunction(() => document.querySelector("#offlineAreas").textContent.includes("No saved"));
  assert.equal(await page.evaluate(() => caches.has("map-canvas-offline-base-v1")),false);
  console.log(`PASS ${engine}: selected area, cached photos and vector roads after cold offline launch, removal`);
  await context.close();
} catch (error) {
  const status = await page?.evaluate(() =>
    ["mapNotice","offlineDownloadStatus","syncState"].map(id => document.getElementById(id)?.textContent)
  ).catch(() => []);
  throw new Error(`${engine} offline flow: ${JSON.stringify(status)}. ${messages.slice(-12).join(" | ")}`,{cause:error});
} finally {
  await browser?.close();
  for (const server of servers) if (!server.killed) server.kill();
}
