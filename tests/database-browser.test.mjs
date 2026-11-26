import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = Number(process.env.PORT || 8877);
const base = "http://127.0.0.1:" + port;
const server = spawn(process.execPath, ["--experimental-strip-types", "backend/test-server.mjs"], {
  cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("D1 test server did not start: " + serverOutput)), 15000);
  server.stdout.on("data", chunk => {
    serverOutput += chunk.toString();
    if (serverOutput.includes("READY " + port)) { clearTimeout(timeout); resolve(); }
  });
  server.stderr.on("data", chunk => { serverOutput += chunk.toString(); });
  server.on("exit", code => {
    if (code && !serverOutput.includes("READY " + port)) reject(new Error("D1 test server exited " + code + ": " + serverOutput));
  });
});

let browser;
try {
  await ready;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(base);
  const result = await page.evaluate(async () => {
    async function api(path, method = "GET", body) {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }
    const route = await api("/api/shared-map/routes/browser-route", "PUT", {
      item: { id: "browser-route", title: "Browser route", points: [[105.85, 21.03], [105.86, 21.04]] },
      expectedVersion: null,
    });
    const routeList = await api("/api/shared-map/routes");
    const itinerary = await api("/api/shared-map/itineraries/browser-plan", "PUT", {
      item: { id: "browser-plan", title: "Browser itinerary", days: [{ stops: [{ title: "Train Street" }] }] },
      expectedVersion: null,
    });
    const stale = await api("/api/shared-map/routes/browser-route", "PUT", {
      item: { id: "browser-route", title: "Stale route" }, expectedVersion: 2,
    });
    const removed = await api("/api/shared-map/routes/browser-route", "DELETE", { expectedVersion: 1 });
    const pins = await api("/api/shared-map/pins");
    return { route, routeList, itinerary, stale, removed, pins };
  });
  assert.equal(result.route.status, 200);
  assert.equal(result.route.data.item.version, 1);
  assert.equal(result.routeList.data.items[0].title, "Browser route");
  assert.equal(result.itinerary.status, 200);
  assert.equal(result.itinerary.data.item.days[0].stops[0].title, "Train Street");
  assert.equal(result.stale.status, 409);
  assert.equal(result.removed.status, 200);
  assert.deepEqual(result.pins.data.entries, [], "existing pins endpoint remains available");
  process.stdout.write("PASS: Chromium route/itinerary D1 API create, list, delete and version-conflict flow\n");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
