import test from "node:test";
import assert from "node:assert/strict";
import {
  formatRouteDistance, formatRouteDuration, haversineKm, nearestNeighborOrder,
  optimizeSelectedPins, splitRouteIntoChunks, MAX_ROUTE_STOPS
} from "../route-optimizer.mjs";

function pins(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: "pin-" + index, title: "Stop " + index, lat: 21 + index * 0.001, lng: 105 + index * 0.001
  }));
}

function mockTripResponse(chunk, order = chunk.map((_, i) => i), distance = 1200, duration = 300) {
  const coordinates = chunk.map(pin => [pin.lng, pin.lat]);
  const rank = new Map(order.map((inputIndex, visitIndex) => [inputIndex, visitIndex]));
  return {
    code: "Ok",
    waypoints: chunk.map((pin, inputIndex) => ({
      location: coordinates[inputIndex], waypoint_index: rank.get(inputIndex)
    })),
    trips: [{
      distance, duration,
      geometry: { type: "LineString", coordinates: order.map(index => coordinates[index]) }
    }]
  };
}

test("haversine distance is geographic and nearest-neighbor keeps selected endpoints", () => {
  assert.ok(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) > 110);
  const values = pins(5);
  const order = nearestNeighborOrder(values);
  assert.equal(order[0].id, values[0].id);
  assert.equal(order.at(-1).id, values.at(-1).id);
  assert.equal(new Set(order.map(pin => pin.id)).size, values.length);
});

test("route chunks overlap by one stop so no transfer leg is lost or double-counted", () => {
  const values = pins(205);
  const chunks = splitRouteIntoChunks(values);
  assert.deepEqual(chunks.map(chunk => chunk.length), [100, 100, 7]);
  assert.equal(chunks[0].at(-1).id, chunks[1][0].id);
  assert.equal(chunks[1].at(-1).id, chunks[2][0].id);
});

test("formats road distance and travel time clearly", () => {
  assert.equal(formatRouteDistance(850), "850 m");
  assert.equal(formatRouteDistance(12500), "12.5 km");
  assert.equal(formatRouteDuration(3600), "1 hr");
  assert.equal(formatRouteDuration(3660), "1 hr 1 min");
});

test("uses OSRM visit order and returns road distance, duration and route geometry", async () => {
  const values = pins(4);
  let requested;
  const result = await optimizeSelectedPins(values, {
    requestSpacingMs: 0,
    fetchImpl: async url => {
      requested = new URL(url);
      return new Response(JSON.stringify(mockTripResponse(values, [0, 2, 1, 3], 12345, 3660)), { status: 200 });
    }
  });
  assert.equal(requested.searchParams.get("roundtrip"), "false");
  assert.equal(requested.searchParams.get("source"), "first");
  assert.equal(requested.searchParams.get("destination"), "last");
  assert.deepEqual(result.ordered.map(pin => pin.id), ["pin-0", "pin-2", "pin-1", "pin-3"]);
  assert.equal(result.distance, 12345);
  assert.equal(result.duration, 3660);
  assert.equal(result.geometry.coordinates.length, 4);
  assert.match(result.algorithm, /brute-force/);
});

test("uses a heuristic for 10+ stops and splits 101 stops into anchored overlapping segments", async () => {
  const values = pins(101);
  const calls = [];
  const result = await optimizeSelectedPins(values, {
    requestSpacingMs: 0,
    fetchImpl: async url => {
      const parsed = new URL(url);
      const coords = parsed.pathname.split("/").at(-1).split(";").map(value => value.split(",").map(Number));
      calls.push(coords);
      const chunk = coords.map(([lng, lat], index) => ({ id: "pin-" + (index ? calls.length === 1 ? index : 98 + index : calls.length === 1 ? 0 : 99), lng, lat }));
      return new Response(JSON.stringify({
        code: "Ok",
        waypoints: coords.map((location, index) => ({ location, waypoint_index: index })),
        trips: [{ distance: 2000, duration: 600, geometry: { type: "LineString", coordinates: coords } }]
      }), { status: 200 });
    }
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.length), [100, 2]);
  assert.equal(result.segments, 2);
  assert.equal(result.ordered.length, 101);
  assert.equal(result.geometry.coordinates.length, 101);
  assert.equal(result.distance, 4000);
  assert.equal(result.duration, 1200);
  assert.match(result.algorithm, /Nearest-neighbor/);
});

test("rejects invalid coordinates, duplicate IDs, and selections above the supported limit", async () => {
  await assert.rejects(() => optimizeSelectedPins(pins(1)), /at least two/);
  const duplicate = pins(2); duplicate[1].id = duplicate[0].id;
  await assert.rejects(() => optimizeSelectedPins(duplicate), /unique pin ID/);
  const invalid = pins(2); invalid[1].lat = 100;
  await assert.rejects(() => optimizeSelectedPins(invalid), /valid, unique/);
  await assert.rejects(() => optimizeSelectedPins(pins(MAX_ROUTE_STOPS + 1)), /up to 500 stops/);
});
