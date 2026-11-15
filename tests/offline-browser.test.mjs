import assert from 'node:assert/strict';
import {chromium, webkit} from 'playwright';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const port=18764, server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{stdio:'ignore'});
const engineName=process.env.MAP_BROWSER_ENGINE==='webkit'?'webkit':'chromium';
const browser=await (engineName==='webkit'?webkit:chromium).launch({headless:true,...(engineName==='chromium'?{args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']}: {})});
try{
 for(let attempt=0;attempt<50;attempt++){try{await fetch(`http://127.0.0.1:${port}/`);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
 const entries=JSON.parse(readFileSync(new URL('../data/public-map.json',import.meta.url),'utf8'));
 for(const entry of entries){entry.photo='';entry.gallery=[];}
 entries[0].photo=`http://127.0.0.1:${port}/tests/offline-photo.svg`;entries[0].notes='Offline note fixture';
 await context.route('https://map-canvas.mikesheer001.chatgpt.site/api/shared-map/**',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{entries,revision:1}}));
 await context.route('https://tiles.openfreemap.org/styles/**',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eee'}}]}}));
 let page=await context.newPage();await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.__mapCanvasTest?.getLibrary()==='maplibre');await page.waitForFunction(()=>navigator.serviceWorker.controller);await page.waitForFunction(()=>document.querySelector('#syncState').textContent.includes('synced'));
 await page.click('#offlineButton');await page.click('#offlineChoose');await page.click('#offlineDownload');await page.waitForFunction(()=>document.querySelector('#offlineAreas').textContent.includes('pins'),null,{timeout:120000});
 const saved=await page.evaluate(async()=>{const db=await new Promise((res,rej)=>{let r=indexedDB.open('map-canvas-offline-v1');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});return await new Promise((res,rej)=>{let r=db.transaction('areas').objectStore('areas').getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});});assert.equal(saved.length,1);assert.ok(saved[0].entries.length>0);assert.ok(saved[0].entries.some(e=>e.notes==='Offline note fixture'));assert.equal(saved[0].missing,0);assert.ok(saved[0].bounds[2]>saved[0].bounds[0]);
 await page.close();await context.setOffline(true);page=await context.newPage();await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.__mapCanvasTest?.getLibrary()==='maplibre');await page.waitForFunction(()=>window.__mapCanvasTest.getMap()?.isStyleLoaded(),null,{timeout:60000});assert.equal(await page.evaluate(()=>window.__mapCanvasTest.getEntries().length),saved[0].entries.length);assert.ok(await page.evaluate(async()=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth>0);img.onerror=()=>resolve(false);img.src='./tests/offline-photo.svg';})));await page.waitForFunction(()=>window.__mapCanvasTest.getMap().querySourceFeatures('hanoi',{sourceLayer:'roads'}).length>0,null,{timeout:60000});assert.equal(await page.evaluate(()=>window.__mapCanvasTest.getMap().getStyle().sources.hanoi.type),'vector');await page.click('#offlineButton');assert.match(await page.locator('#offlineAreas').innerText(),/pins/);await page.click('#offlineAreas button:text("Remove")');await page.waitForFunction(()=>document.querySelector('#offlineAreas').textContent.includes('No saved'));console.log('PASS: selected area, snapshots, cold offline reopen and removal');await context.close();
}finally{await browser.close();server.kill();}
