import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { createResourceStore } from "./resources.mjs";

const migrationNames = [
  "0001_shared_map_board.sql",
  "0002_shared_map_trash.sql",
  "0003_independent_map_canvas_data.sql",
];
const migrations = await Promise.all(migrationNames.map(name =>
  readFile(new URL("./migrations/" + name, import.meta.url), "utf8")
));

function createDatabase() {
  const sql = new DatabaseSync(":memory:");
  for (const migration of migrations) sql.exec(migration);
  sql.prepare("INSERT INTO map_canvas_board VALUES (1, 1, ?)").run(JSON.stringify({ entries: [], tombstones: {} }));
  function statement(query, params = []) {
    return {
      query,
      bind(...values) { return statement(query, values); },
      async first() { return sql.prepare(query).get(...params) ?? null; },
      async all() { return { results: sql.prepare(query).all(...params) }; },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...params).changes) } }; },
    };
  }
  return { prepare: statement };
}

const route = (id, title = "Hanoi walk") => ({
  id, title, points: [{ lat: 21.03, lng: 105.85 }, { lat: 21.04, lng: 105.86 }], color: "#245c48",
});
const itinerary = (id, title = "Hanoi weekend") => ({
  id, title, days: [{ date: "2026-11-28", stops: [{ title: "Old Quarter", lat: 21.03, lng: 105.85 }] }],
});

test("stores routes and itineraries independently in the Map Canvas D1 tables", async () => {
  const store = createResourceStore(createDatabase(), () => 1700000000000);
  const savedRoute = await store.put("route", "hanoi-walk", route("hanoi-walk"), null);
  const savedItinerary = await store.put("itinerary", "hanoi-walk", itinerary("hanoi-walk"), null);
  assert.equal(savedRoute.item.version, 1);
  assert.equal(savedItinerary.item.version, 1);
  assert.deepEqual((await store.list("route")).items.map(item => item.id), ["hanoi-walk"]);
  assert.deepEqual((await store.list("itinerary")).items.map(item => item.id), ["hanoi-walk"]);
  assert.equal(savedRoute.item.updatedAt, 1700000000000);
});

test("uses optimistic versions and rejects stale route updates", async () => {
  const store = createResourceStore(createDatabase());
  const created = await store.put("route", "route-1", route("route-1"), null);
  const updated = await store.put("route", "route-1", route("route-1", "Updated"), created.item.version);
  assert.equal(updated.item.version, 2);
  assert.equal(updated.item.title, "Updated");
  await assert.rejects(store.put("route", "route-1", route("route-1", "Stale"), created.item.version), { status: 409 });
});

test("rejects duplicate creates, invalid coordinates, malformed itineraries and oversized payloads", async () => {
  const store = createResourceStore(createDatabase());
  await store.put("route", "route-1", route("route-1"), null);
  await assert.rejects(store.put("route", "route-1", route("route-1"), null), { status: 409 });
  await assert.rejects(store.put("route", "bad-route", { title: "Bad", points: [{ lat: 91, lng: 105 }] }, null));
  await assert.rejects(store.put("itinerary", "bad-plan", { title: "Bad", days: "tomorrow" }, null));
  await assert.rejects(store.put("itinerary", "large", { title: "Large", notes: "x".repeat(260000) }, null), { status: 413 });
});

test("soft deletes prevent stale resurrection and allow an explicit versioned restore", async () => {
  const store = createResourceStore(createDatabase());
  const created = await store.put("itinerary", "plan-1", itinerary("plan-1"), null);
  await assert.rejects(store.remove("itinerary", "plan-1", created.item.version + 1), { status: 409 });
  const deleted = await store.remove("itinerary", "plan-1", created.item.version);
  assert.deepEqual(deleted, { id: "plan-1", kind: "itinerary", deleted: true, version: 2 });
  assert.deepEqual((await store.list("itinerary")).items, []);
  const restored = await store.put("itinerary", "plan-1", itinerary("plan-1", "Restored"), deleted.version);
  assert.equal(restored.item.version, 3);
  assert.equal(restored.item.title, "Restored");
});

test("migration copies existing pins and trash rows to app-owned tables while retaining legacy tables for safe cutover", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(migrations[0]);
  sql.exec(migrations[1]);
  const board = { entries: [{ id: "hostel-1", title: "Existing pin", version: 7 }], tombstones: { "old-pin": 8 } };
  sql.prepare("INSERT INTO shared_map_board VALUES (1, 9, ?)").run(JSON.stringify(board));
  sql.prepare("INSERT INTO shared_map_trash VALUES (?, ?, ?, ?)").run("old-pin", JSON.stringify({ id: "old-pin" }), 8, 1700000000000);
  sql.exec(migrations[2]);
  assert.equal(sql.prepare("SELECT revision FROM map_canvas_board WHERE id = 1").get().revision, 9);
  assert.deepEqual(JSON.parse(sql.prepare("SELECT value FROM map_canvas_board WHERE id = 1").get().value), board);
  assert.equal(sql.prepare("SELECT id FROM map_canvas_trash WHERE id = ?").get("old-pin").id, "old-pin");
  const names = new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  assert.ok(names.has("shared_map_board"), "legacy pin table stays available to the old Worker during cutover");
  assert.ok(names.has("shared_map_trash"), "legacy trash table stays available to the old Worker during cutover");
  sql.close();
});
