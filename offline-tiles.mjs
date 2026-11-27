export const OFFLINE_TILE_LIMITS = Object.freeze({
  maxTiles: 3000,
  maxBytes: 50 * 1024 * 1024,
  maxParallel: 4,
  maxZoom: 18,
});

const MAX_MERCATOR_LAT = 85.05112878;

function validBounds(bounds) {
  if (!bounds || !["west", "south", "east", "north"].every(key => Number.isFinite(Number(bounds[key])))) {
    throw new Error("Choose a valid visible map area.");
  }
  const { west, south, east, north } = Object.fromEntries(
    Object.entries(bounds).map(([key, value]) => [key, Number(value)])
  );
  if (south >= north || south < -90 || north > 90 || west < -180 || west > 180 || east < -180 || east > 180) {
    throw new Error("The selected map area has invalid bounds.");
  }
  return { west, south, east, north };
}

function tileX(longitude, zoom) {
  const count = 2 ** zoom;
  return Math.max(0, Math.min(count - 1, Math.floor((longitude + 180) / 360 * count)));
}

function tileY(latitude, zoom) {
  const count = 2 ** zoom;
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latitude));
  const radians = lat * Math.PI / 180;
  const value = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * count;
  return Math.max(0, Math.min(count - 1, Math.floor(value)));
}

export function enumerateOfflineTiles(boundsInput, minZoom, maxZoom, limit = OFFLINE_TILE_LIMITS.maxTiles) {
  const bounds = validBounds(boundsInput);
  const low = Number(minZoom), high = Number(maxZoom);
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 ||
      high > OFFLINE_TILE_LIMITS.maxZoom || low > high) {
    throw new Error("Choose a valid zoom range (0–18).");
  }
  const longitudeRanges = bounds.west <= bounds.east
    ? [[bounds.west, bounds.east]]
    : [[bounds.west, 180], [-180, bounds.east]];
  const tiles = [];
  const seen = new Set();
  for (let z = low; z <= high; z++) {
    const y0 = tileY(bounds.north, z);
    const y1 = tileY(bounds.south, z);
    for (const range of longitudeRanges) {
      const x0 = tileX(range[0], z);
      const x1 = tileX(range[1], z);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const key = z + "/" + x + "/" + y;
          if (seen.has(key)) continue;
          seen.add(key);
          tiles.push({ z, x, y });
          if (tiles.length > limit) {
            throw new Error("This area needs more than " + limit.toLocaleString() + " map tiles. Reduce the area or zoom range.");
          }
        }
      }
    }
  }
  return tiles;
}

export function countOfflineTiles(bounds, minZoom, maxZoom, limit = OFFLINE_TILE_LIMITS.maxTiles) {
  return enumerateOfflineTiles(bounds, minZoom, maxZoom, limit).length;
}

export function offlineTileUrl(template, tile) {
  return String(template)
    .replaceAll("{z}", String(tile.z))
    .replaceAll("{x}", String(tile.x))
    .replaceAll("{y}", String(tile.y))
    .replaceAll("{s}", "a")
    .replaceAll("{ratio}", "");
}
