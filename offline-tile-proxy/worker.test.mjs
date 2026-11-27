import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";

const origin = "https://mikesheer001-source.github.io";
const target = "https://tiles.openfreemap.org/planet/5/16/15.pbf";

test("proxies only OpenFreeMap URLs with an app-specific User-Agent and Referer", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), headers: new Headers(options.headers), redirect: options.redirect };
    return new Response("vector tile", {
      status: 200,
      headers: { "Content-Type": "application/x-protobuf", "Cache-Control": "public, max-age=3600", "ETag": '"tile-v1"' }
    });
  };
  try {
    const response = await worker.fetch(new Request(
      "https://proxy.example/proxy?url=" + encodeURIComponent(target),
      { headers: { Origin: origin } }
    ));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "vector tile");
    assert.equal(captured.url, target);
    assert.match(captured.headers.get("User-Agent"), /^MapCanvas\/1\.0/);
    assert.equal(captured.headers.get("Referer"), origin + "/map-canvas/");
    assert.equal(captured.redirect, "error");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(response.headers.get("ETag"), '"tile-v1"');
  } finally { globalThis.fetch = originalFetch; }
});

test("rejects untrusted origins and non-OpenFreeMap upstream hosts", async () => {
  const deniedOrigin = await worker.fetch(new Request(
    "https://proxy.example/proxy?url=" + encodeURIComponent(target),
    { headers: { Origin: "https://evil.example" } }
  ));
  assert.equal(deniedOrigin.status, 403);
  const deniedHost = await worker.fetch(new Request(
    "https://proxy.example/proxy?url=" + encodeURIComponent("https://example.com/tile.png"),
    { headers: { Origin: origin } }
  ));
  assert.equal(deniedHost.status, 400);
});

test("supports CORS preflight for the Map Canvas web origin", async () => {
  const response = await worker.fetch(new Request("https://proxy.example/proxy", {
    method: "OPTIONS", headers: { Origin: origin }
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
});
