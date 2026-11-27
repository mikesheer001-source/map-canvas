import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPublicPins, exportPublicPins } from "../scripts/export-live-pins.mjs";

const entry = { id: "hostel-1", title: "Test", version: 3, kind: "place", category: "Hostel",
  lat: 21, lng: 105, notes: "Keep exact public fields", gallery: ["https://example.com/photo.jpg"] };
const now = () => new Date("2026-11-27T12:00:00Z");
const body = { revision: 4, entries: [entry], trash: [{ title: "Do not export" }], secret: "not exported" };
const call = async (url, init) => {
  assert.equal(url, "https://map-canvas-api.mikesheer001.workers.dev/api/shared-map/pins");
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "error");
  return Response.json(body);
};
test("exports an index and exact active records without extra board fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "public-pins-"));
  try {
    const snapshot = await exportPublicPins(dir, { call, now });
    assert.equal(snapshot.revision, 4);
    assert.equal(snapshot.pinCount, 1);
    assert.equal(snapshot.capturedAt, now().toISOString());
    assert.equal(snapshot.pins[0].version, 3);
    assert.equal(snapshot.pins[0].path, "pins/hostel-1.json");
    assert.deepEqual(JSON.parse(await readFile(join(dir, "pins/hostel-1.json"), "utf8")), entry);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "snapshot.json"), "utf8")), snapshot);
    assert.deepEqual((await readdir(dir)).sort(), ["pins", "snapshot.json"]);
    assert.ok(!JSON.stringify(snapshot).includes("not exported"));
    assert.ok(!JSON.stringify(snapshot).includes("Do not export"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("rejects failures, invalid revisions, duplicate IDs and unsafe paths", async () => {
  await assert.rejects(readPublicPins({ call: async () => new Response("", { status: 503 }) }), /503/);
  for (const invalid of [
    { revision: "4", entries: [entry] },
    { revision: 4, entries: [entry, entry] },
    { revision: 4, entries: [{ ...entry, id: "../bad" }] },
    { revision: 4, entries: [{ ...entry, version: 5 }] },
    { revision: 4, entries: [{ ...entry, lat: 999 }] }
  ]) await assert.rejects(readPublicPins({ call: async () => Response.json(invalid) }), /Invalid/);
});
