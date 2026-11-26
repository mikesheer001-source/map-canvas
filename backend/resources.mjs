import { MapError } from "./board.mjs";

const KINDS = new Set(["route", "itinerary"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const MAX_RESOURCE_BYTES = 250_000;
const MAX_ROUTE_POINTS = 5_000;
const MAX_ITINERARY_DAYS = 60;
const MAX_DAY_STOPS = 100;

function assertKind(kind) {
  if (!KINDS.has(kind)) throw new MapError("Resource type unavailable.", 404);
}

function validCoordinatePair(point) {
  if (Array.isArray(point)) {
    const [lng, lat] = point;
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
  }
  if (!point || typeof point !== "object" || Array.isArray(point)) return false;
  const lat = point.lat;
  const lng = point.lng ?? point.lon;
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
}

function normalizeResource(kind, id, value) {
  assertKind(kind);
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new MapError("Invalid resource ID.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MapError("Resource data must be an object.");
  if (value.id != null && value.id !== id) throw new MapError("Resource ID does not match its URL.");
  if (value.title != null && (typeof value.title !== "string" || value.title.length > 140)) {
    throw new MapError("Resource title is invalid.");
  }

  const resource = { ...value, id };
  delete resource.version;
  delete resource.updatedAt;
  if (kind === "route") {
    const points = resource.points ?? resource.waypoints;
    if (points != null && (!Array.isArray(points) || points.length > MAX_ROUTE_POINTS || points.some(point => !validCoordinatePair(point)))) {
      throw new MapError("Route points must contain valid latitude/longitude coordinates.");
    }
  }
  if (kind === "itinerary" && resource.days != null) {
    if (!Array.isArray(resource.days) || resource.days.length > MAX_ITINERARY_DAYS || resource.days.some(day =>
      !day || typeof day !== "object" || Array.isArray(day) ||
      (day.stops != null && (!Array.isArray(day.stops) || day.stops.length > MAX_DAY_STOPS))
    )) throw new MapError("Itinerary days or stops are invalid.");
  }

  let serialized;
  try { serialized = JSON.stringify(resource); }
  catch { throw new MapError("Resource data is not valid JSON."); }
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESOURCE_BYTES) {
    throw new MapError("Resource data is too large.", 413);
  }
  return serialized;
}

function toPublicResource(row) {
  return {
    ...JSON.parse(row.value),
    id: row.id,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export function createResourceStore(db, now = Date.now) {
  return {
    async list(kind) {
      assertKind(kind);
      const { results } = await db.prepare(
        "SELECT id, value, version, updated_at FROM map_canvas_resources " +
        "WHERE kind = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id"
      ).bind(kind).all();
      return { items: results.map(toPublicResource) };
    },

    async put(kind, id, value, expectedVersion) {
      const serialized = normalizeResource(kind, id, value);
      const updatedAt = now();
      if (expectedVersion === null) {
        const result = await db.prepare(
          "INSERT OR IGNORE INTO map_canvas_resources (kind, id, value, version, updated_at) " +
          "VALUES (?, ?, ?, 1, ?)"
        ).bind(kind, id, serialized, updatedAt).run();
        if (result.meta.changes !== 1) throw new MapError("This resource already exists. Refresh and retry.", 409);
      } else {
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MapError("Invalid resource version.");
        const result = await db.prepare(
          "UPDATE map_canvas_resources SET value = ?, version = version + 1, updated_at = ?, deleted_at = NULL " +
          "WHERE kind = ? AND id = ? AND version = ?"
        ).bind(serialized, updatedAt, kind, id, expectedVersion).run();
        if (result.meta.changes !== 1) throw new MapError("This resource changed. Refresh and try again.", 409);
      }
      const row = await db.prepare(
        "SELECT id, value, version, updated_at FROM map_canvas_resources WHERE kind = ? AND id = ?"
      ).bind(kind, id).first();
      return { item: toPublicResource(row) };
    },

    async remove(kind, id, expectedVersion) {
      assertKind(kind);
      if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new MapError("Invalid resource ID.");
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MapError("Invalid resource version.");
      const deletedAt = now();
      const result = await db.prepare(
        "UPDATE map_canvas_resources SET version = version + 1, updated_at = ?, deleted_at = ? " +
        "WHERE kind = ? AND id = ? AND version = ? AND deleted_at IS NULL"
      ).bind(deletedAt, deletedAt, kind, id, expectedVersion).run();
      if (result.meta.changes !== 1) throw new MapError("This resource changed or no longer exists. Refresh and retry.", 409);
      return { id, kind, deleted: true, version: expectedVersion + 1 };
    },
  };
}
