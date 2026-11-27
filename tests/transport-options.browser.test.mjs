import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname,resolve,sep} from "node:path";
import {chromium} from "playwright";
const root=resolve(process.cwd()),mime={".html":"text/html; charset=utf-8",".mjs":"text/javascript; charset=utf-8"};
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,"http://127.0.0.1").pathname,file=resolve(root,pathname.replace(/^\/+/,""));if(file!==root&&!file.startsWith(root+sep))throw Error("Invalid path");res.writeHead(200,{"Content-Type":mime[extname(file)]||"application/octet-stream"});res.end(await readFile(file));}catch{res.writeHead(404);res.end("Not found");}});
await new Promise(ready=>server.listen(0,"127.0.0.1",ready));const base="http://127.0.0.1:"+server.address().port;let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto(base+"/tests/transport-options-harness.html");
 await page.getByText("Live Transitous timetable search is disabled. Use the external provider links below.").waitFor();
 assert.equal(await page.locator(".transport-research-option").count(),0,"cached timetable results must stay hidden");
 assert.equal(await page.locator(".transport-research-picks").count(),0);
 assert.equal(await page.locator(".transport-research-sources").count(),0);
 const popup=await page.locator("#popup").textContent();
 assert.ok(!popup.includes("Vietnam Transfers")&&!popup.includes("2 researched option(s)"));
 assert.equal(await page.locator('a[href="https://12go.asia/en/travel/hanoi/da-nang"]').count(),1);
 assert.equal(await page.locator('a[href^="https://www.google.com/travel/flights"]').count(),1);
 assert.equal(await page.locator('a[href^="https://www.google.com/maps/dir/"]').count(),1);
 assert.equal(await page.locator("#popup a").count(),3,"only the three external provider links should be shown");
 process.stdout.write("PASS: popup suppresses cached Transitous results and shows only 12Go, Google Flights and Google Maps links\n");
}finally{await browser?.close();await new Promise(done=>server.close(done));}
