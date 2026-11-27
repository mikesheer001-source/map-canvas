export const OSRM_TRIP_ENDPOINT = "https://router.project-osrm.org";
export const MAX_OSRM_WAYPOINTS = 100;
export const MAX_ROUTE_STOPS = 500;

export function haversineKm(a, b) {
  const rad = value => value * Math.PI / 180;
  const lat1 = rad(Number(a.lat)), lat2 = rad(Number(b.lat));
  const dLat = lat2 - lat1, dLng = rad(Number(b.lng) - Number(a.lng));
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestNeighborOrder(pins) {
  if (pins.length < 2) return pins.slice();
  const remaining = new Set(Array.from({ length: pins.length - 2 }, (_, i) => i + 1));
  const order = [0];
  let current = 0;
  while (remaining.size) {
    let next = -1, best = Infinity;
    for (const candidate of remaining) {
      const distance = haversineKm(pins[current], pins[candidate]);
      if (distance < best) { best = distance; next = candidate; }
    }
    order.push(next);
    remaining.delete(next);
    current = next;
  }
  order.push(pins.length - 1);
  return order.map(index => pins[index]);
}

export function splitRouteIntoChunks(pins, limit = MAX_OSRM_WAYPOINTS) {
  if (!Number.isInteger(limit) || limit < 2) throw new Error("Route segment size must be at least two stops.");
  if (pins.length <= limit) return [pins.slice()];
  const chunks = [];
  for (let start = 0; start < pins.length - 1; start += limit - 1) {
    chunks.push(pins.slice(start, Math.min(start + limit, pins.length)));
  }
  return chunks;
}

export function formatRouteDistance(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1000) return Math.round(value) + " m";
  return (value / 1000).toFixed(value >= 100000 ? 0 : 1) + " km";
}

export function formatRouteDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "—";
  const minutes = Math.round(value / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return minutes + " min";
  return hours + " hr" + (remainder ? " " + remainder + " min" : "");
}

function validatePins(pins) {
  if (!Array.isArray(pins) || pins.length < 2) throw new Error("Select at least two pins with map coordinates.");
  if (pins.length > MAX_ROUTE_STOPS) throw new Error("A single optimized route supports up to " + MAX_ROUTE_STOPS + " stops. Split larger selections into separate routes.");
  const ids = new Set();
  return pins.map((pin, index) => {
    const lat = Number(pin?.lat), lng = Number(pin?.lng);
    if (!pin || typeof pin.id !== "string" || !pin.id || ids.has(pin.id) ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 85 || Math.abs(lng) > 180) {
      throw new Error("Stop " + (index + 1) + " is missing a valid, unique pin ID or map coordinate.");
    }
    ids.add(pin.id);
    return { ...pin, lat, lng };
  });
}

async function fetchTrip(chunk, { fetchImpl, baseUrl, signal }) {
  const coordinates = chunk.map(pin => pin.lng.toFixed(6) + "," + pin.lat.toFixed(6)).join(";");
  const url = baseUrl.replace(/\/$/, "") + "/trip/v1/driving/" + coordinates +
    "?roundtrip=false&source=first&destination=last&steps=false&overview=full&geometries=geojson";
  let response;
  try {
    response = await fetchImpl(url, { signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("Could not reach the OSRM driving router. Check your connection and try again.");
  }
  if (!response.ok) throw new Error("The OSRM router returned HTTP " + response.status + ".");
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The OSRM router returned an unreadable response."); }
  if (data.code !== "Ok") {
    const messages = {
      NoTrips: "Some selected pins are not connected by a drivable road route.",
      NoSegment: "One or more selected pins could not be matched to a road.",
      TooBig: "This route segment is too large for the routing service."
    };
    throw new Error(messages[data.code] || ("Route optimization failed: " + (data.code || "unknown router error") + "."));
  }
  if (!Array.isArray(data.trips) || data.trips.length !== 1) {
    throw new Error("The router could not connect every selected pin in one continuous route.");
  }
  const trip = data.trips[0];
  if (!Array.isArray(data.waypoints) || data.waypoints.length !== chunk.length ||
      !trip.geometry || trip.geometry.type !== "LineString" ||
      !Array.isArray(trip.geometry.coordinates) || trip.geometry.coordinates.length < 2 ||
      !Number.isFinite(Number(trip.distance)) || !Number.isFinite(Number(trip.duration))) {
    throw new Error("The routing service returned incomplete route data.");
  }
  const ordered = data.waypoints
    .map((waypoint, inputIndex) => ({ waypoint, inputIndex }))
    .sort((a, b) => Number(a.waypoint.waypoint_index) - Number(b.waypoint.waypoint_index));
  if (ordered.some((item, index) => !Number.isInteger(Number(item.waypoint.waypoint_index)) ||
      Number(item.waypoint.waypoint_index) !== index)) {
    throw new Error("The routing service returned an invalid stop order.");
  }
  return {
    ordered: ordered.map(item => chunk[item.inputIndex]),
    geometry: trip.geometry,
    distance: Number(trip.distance),
    duration: Number(trip.duration)
  };
}

export async function optimizeSelectedPins(inputPins, options = {}) {
  const pins = validatePins(inputPins);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("This browser does not support route requests.");
  const baseUrl = options.baseUrl || OSRM_TRIP_ENDPOINT;
  const requestSpacingMs = Math.max(0, Number(options.requestSpacingMs ?? 1100) || 0);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const signal = options.signal;
  const oversized = pins.length > MAX_OSRM_WAYPOINTS;
  const seeded = oversized ? nearestNeighborOrder(pins) : pins;
  const chunks = splitRouteIntoChunks(seeded);
  const ordered = [];
  const coordinates = [];
  let distance = 0, duration = 0;

  for (let index = 0; index < chunks.length; index++) {
    if (signal?.aborted) throw new DOMException("Route optimization cancelled.", "AbortError");
    if (index && requestSpacingMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, requestSpacingMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Route optimization cancelled.", "AbortError"));
        }, { once: true });
      });
    }
    onProgress({ completed: index, total: chunks.length });
    const result = await fetchTrip(chunks[index], { fetchImpl, baseUrl, signal });
    ordered.push(...(index ? result.ordered.slice(1) : result.ordered));
    coordinates.push(...(index ? result.geometry.coordinates.slice(1) : result.geometry.coordinates));
    distance += result.distance;
    duration += result.duration;
    onProgress({ completed: index + 1, total: chunks.length });
  }

  const algorithm = oversized
    ? "Nearest-neighbor pre-order + OSRM farthest-insertion per 100-stop segment"
    : pins.length < 10
      ? "OSRM brute-force TSP (fixed start and finish)"
      : "OSRM farthest-insertion heuristic (fixed start and finish)";
  return {
    ordered,
    geometry: { type: "LineString", coordinates },
    distance,
    duration,
    algorithm,
    segments: chunks.length,
    approximate: pins.length >= 10
  };
}
