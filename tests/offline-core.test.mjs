import test from "node:test";
import assert from "node:assert/strict";
import {
  coalesceQueuedChange,
  mergePendingChanges,
  stripOfflineFlags,
  formatOfflineBytes,
} from "../offline-store.mjs";
import {
  enumerateOfflineTiles,
  countOfflineTiles,
  offlineTileUrl,
  OFFLINE_TILE_LIMITS,
} from "../offline-tiles.mjs";

const bounds = { west: -0.1, south: -0.1, east: 0.1, north: 0.1 };

test("enumerates deterministic XYZ tiles for the selected zoom range", () => {
  const tiles = enumerateOfflineTiles(bounds, 2, 4);
  assert.ok(tiles.length > 0);
  assert.equal(new Set(tiles.map(tile => tile.z + "/" + tile.x + "/" + tile.y)).size, tiles.length);
  assert.equal(countOfflineTiles(bounds, 2, 4), tiles.length);
  assert.deepEqual(tiles[0], { z: 2, x: 1, y: 1 });
  assert.equal(offlineTileUrl("https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf", tiles[0]),
    "https://tiles.openfreemap.org/planet/2/1/1.pbf");
});

test("supports areas crossing the antimeridian without duplicating tiles", () => {
  const tiles = enumerateOfflineTiles({ west: 179, south: -1, east: -179, north: 1 }, 2, 2);
  assert.ok(tiles.some(tile => tile.x === 0));
  assert.ok(tiles.some(tile => tile.x === 3));
  assert.equal(new Set(tiles.map(tile => tile.z + "/" + tile.x + "/" + tile.y)).size, tiles.length);
});

test("rejects invalid zoom ranges and areas above the provider tile limit", () => {
  assert.throws(() => enumerateOfflineTiles(bounds, 5, 4), /zoom range/);
  assert.throws(() => enumerateOfflineTiles({ west: -180, south: -80, east: 180, north: 80 }, 0, 10), /3,000 map tiles/);
  assert.equal(OFFLINE_TILE_LIMITS.maxTiles, 3000);
  assert.equal(OFFLINE_TILE_LIMITS.maxBytes, 50 * 1024 * 1024);
  assert.equal(OFFLINE_TILE_LIMITS.maxParallel, 4);
});

test("coalesces multiple offline edits per pin and cancels a new pin deleted before sync", () => {
  const created = coalesceQueuedChange(null, {
    pinId: "new-pin", action: "save", entry: { id: "new-pin", title: "First" },
    expectedVersion: null, createdAt: 1,
  });
  const edited = coalesceQueuedChange(created, {
    pinId: "new-pin", action: "save", entry: { id: "new-pin", title: "Updated" },
    expectedVersion: 0, createdAt: 2,
  });
  assert.equal(edited.expectedVersion, null);
  assert.equal(edited.entry.title, "Updated");
  assert.equal(edited.createdAt, 1);
  assert.equal(coalesceQueuedChange(edited, {
    pinId: "new-pin", action: "delete", expectedVersion: 0, createdAt: 3,
  }).cancelled, true);
});

test("keeps the original server version and exposes conflicts instead of overwriting remote edits", () => {
  const existing = { pinId: "pin-1", action: "save", expectedVersion: 7, entry: { id: "pin-1", title: "Offline" }, createdAt: 1 };
  const next = coalesceQueuedChange(existing, {
    pinId: "pin-1", action: "save", expectedVersion: 8, entry: { id: "pin-1", title: "Offline edit 2" }, createdAt: 2,
  });
  assert.equal(next.expectedVersion, 7);
  const merged = mergePendingChanges(
    [{ id: "pin-1", title: "Remote edit", version: 8 }, { id: "pin-2", title: "Remote pin", version: 1 }],
    [{ ...next, status: "conflict", conflict: "version changed" }]
  );
  assert.equal(merged.find(pin => pin.id === "pin-1").title, "Offline edit 2");
  assert.equal(merged.find(pin => pin.id === "pin-1").syncConflict, true);
  assert.equal(stripOfflineFlags(merged[0]).pendingSync, undefined);
});

test("formats cached area sizes clearly", () => {
  assert.equal(formatOfflineBytes(512), "512 B");
  assert.equal(formatOfflineBytes(2048), "2.0 KB");
  assert.equal(formatOfflineBytes(2 * 1024 * 1024), "2.0 MB");
});
