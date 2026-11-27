import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const endpoint = "https://map-canvas-api.mikesheer001.workers.dev/api/shared-map/pins";
const validId = /^(?:[a-f0-9]{8}-[a-f0-9-]{27,36}|hostel-[0-9]+)$/i;
const maxBytes = 2_000_000;

export async function readPublicPins({ call = fetch, now = () => new Date() } = {}) {
  const response = await call(endpoint, {
    method: "GET",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Live pin read failed: HTTP ${response.status}`);
  const raw = await response.text();
  if (Buffer.byteLength(raw) > maxBytes) throw new Error("Public pin response is unexpectedly large.");
  const { revision, entries } = JSON.parse(raw);
  if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(entries) || entries.length > 500)
    throw new Error("Invalid live pin board.");
  const ids = new Set();
  for (const pin of entries) {
    if (!pin || typeof pin.id !== "string" || !validId.test(pin.id) || ids.has(pin.id) ||
        typeof pin.title !== "string" || !Number.isSafeInteger(pin.version) ||
        pin.version < 1 || pin.version > revision ||
        !Number.isFinite(pin.lat) || Math.abs(pin.lat) > 85 ||
        !Number.isFinite(pin.lng) || Math.abs(pin.lng) > 180)
      throw new Error("Invalid or duplicate live pin record.");
    ids.add(pin.id);
  }
  return { revision, entries, capturedAt: now().toISOString() };
}

export async function exportPublicPins(directory, options = {}) {
  const { revision, entries, capturedAt } = await readPublicPins(options);
  const pinsDir = join(directory, "pins");
  await mkdir(pinsDir, { recursive: true });
  const index = [];
  for (const pin of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    const path = `pins/${pin.id}.json`;
    await writeFile(join(directory, path), JSON.stringify(pin) + "\n", { flag: "wx" });
    index.push({ id: pin.id, title: pin.title, category: pin.category ?? "", kind: pin.kind,
      lat: pin.lat, lng: pin.lng, version: pin.version, path });
  }
  const snapshot = { schemaVersion: 1, source: endpoint, capturedAt, revision, pinCount: index.length, pins: index };
  await writeFile(join(directory, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx" });
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Specify an empty snapshot output directory.");
  const { revision, pinCount, capturedAt } = await exportPublicPins(process.argv[2]);
  console.log(JSON.stringify({ revision, pinCount, capturedAt, result: "read-only live snapshot exported" }));
}
