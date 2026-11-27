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
 await page.getByText("2 researched option(s)").waitFor();assert.equal(await page.locator(".transport-research-option").count(),2);
 const picks=await page.locator(".transport-research-picks").textContent();assert.ok(picks.includes("Cheapest")&&picks.includes("Fastest")&&picks.includes("Best value"));
 const first=await page.locator(".transport-research-option").first().textContent();assert.ok(first.includes("UNVERIFIED")&&first.includes("Vietnam Transfers"));
 assert.ok((await page.locator(".transport-research-sources").textContent()).includes("Research sources and dates"));
 assert.equal(await page.locator('a[href="https://operator.example/tickets"]').count(),1);
 assert.equal(await page.locator('a[href="https://12go.asia/en/travel/hanoi/da-nang"]').count(),1);
 process.stdout.write("PASS: popup renders researched operators, fare warnings, schedules, picks, booking links and dated sources\n");
}finally{await browser?.close();await new Promise(done=>server.close(done));}
