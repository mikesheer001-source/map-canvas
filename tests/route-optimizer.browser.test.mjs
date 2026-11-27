import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const mime = { ".html":"text/html; charset=utf-8", ".mjs":"text/javascript; charset=utf-8" };
const server = createServer(async (request,response)=>{
  try {
    const pathname = new URL(request.url,"http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "tests/route-harness.html" : pathname.replace(/^\/+/,"");
    const file = resolve(root,relative);
    if (file !== root && !file.startsWith(root+sep)) throw new Error("Invalid path");
    response.writeHead(200,{"Content-Type":mime[extname(file)]||"application/octet-stream"});
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise(resolveReady=>server.listen(0,"127.0.0.1",resolveReady));
const base = "http://127.0.0.1:"+server.address().port;
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  let requests = [];
  await page.route("https://router.project-osrm.org/trip/v1/driving/**",async route=>{
    const url = new URL(route.request().url());
    const coords = url.pathname.split("/").at(-1).split(";").map(value=>value.split(",").map(Number));
    requests.push(coords);
    const order = coords.length===4 ? [0,2,1,3] : coords.map((_,i)=>i);
    const rank = new Map(order.map((inputIndex,visitIndex)=>[inputIndex,visitIndex]));
    const body = {
      code:"Ok",
      waypoints:coords.map((location,inputIndex)=>({location,waypoint_index:rank.get(inputIndex)})),
      trips:[{distance:coords.length===4?12345:2000,duration:coords.length===4?3660:600,
        geometry:{type:"LineString",coordinates:order.map(index=>coords[index])}}]
    };
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto(base);
  await page.getByRole("button",{name:/Start/}).click();
  await page.getByRole("button",{name:/Alpha/}).click();
  await page.getByRole("button",{name:/Bravo/}).click();
  await page.getByRole("button",{name:/Finish/}).click();
  await page.getByRole("button",{name:"Optimize route"}).click();
  await page.getByText("Route ready.").waitFor();
  assert.equal(await page.locator("#summary").textContent().then(value=>value.includes("12.3 km")),true);
  assert.equal(await page.locator("#summary").textContent().then(value=>value.includes("1 hr 1 min")),true);
  assert.deepEqual(await page.locator("#ordered li").allTextContents(),["Start","Bravo","Alpha","Finish"]);
  assert.equal(requests.length,1);
  assert.equal((await page.evaluate(()=>window.routeResult.geometry.coordinates)).length,4);

  requests=[];
  await page.getByRole("button",{name:"Load 101-stop test"}).click();
  await page.getByRole("button",{name:"Optimize route"}).click();
  await page.getByText("Route ready.").waitFor();
  assert.equal(requests.length,2,"101 stops are sent as two overlapping OSRM route segments");
  assert.deepEqual(requests.map(points=>points.length),[100,2]);
  assert.equal(await page.locator("#ordered li").count(),101);
  assert.equal(await page.locator("#summary").textContent().then(value=>value.includes("4 km")),true);
  process.stdout.write("PASS: browser stop selection, optimized visit order, route metrics, and 101-stop chunking\n");
} finally {
  await browser?.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
