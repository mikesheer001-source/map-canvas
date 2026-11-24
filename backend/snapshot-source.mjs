import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const endpoint = "https://map-canvas.mikesheer001.chatgpt.site/api/shared-map/migration";
const token = process.env.MAP_CANVAS_EXPORT_TOKEN;
const output = process.argv[2];
if (!output || !/^[a-f0-9]{64}$/i.test(token || "")) {
  throw new Error("Provide an output directory and a MAP_CANVAS_EXPORT_TOKEN environment variable.");
}
const objectsDirectory = join(output, "objects");
await mkdir(output);
await mkdir(objectsDirectory);

async function request(parameters) {
  const response = await fetch(endpoint + "?" + new URLSearchParams(parameters), {
    headers: { Authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error("Source export returned HTTP " + response.status + ".");
  return response;
}

async function* pages(kind, field) {
  let cursor = "";
  do {
    const page = await (await request({ kind, cursor })).json();
    if (!Array.isArray(page[field]) || (page.cursor && page.cursor === cursor)) {
      throw new Error("Source pagination returned an invalid page.");
    }
    yield* page[field];
    cursor = page.cursor;
  } while (cursor);
}

const board = await (await request({ kind: "board" })).json();
if (board.legacyEntries !== 0 || board.legacySettings !== 0) {
  throw new Error("The source has legacy entries or settings. Account for them before importing.");
}
const trash = [];
for await (const row of pages("trash", "rows")) trash.push(row);

const objects = [];
for await (const { key, size } of pages("objects", "objects")) {
  const name = createHash("sha256").update(key).digest("hex");
  const file = join(objectsDirectory, name);
  const response = await request({ kind: "object", key });
  if (!response.body) throw new Error("An exported photo is empty.");
  const hash = createHash("sha256");
  let bytes = 0;
  const count = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), count, createWriteStream(file, { flags: "wx" }));
  const sha256 = hash.digest("hex");
  if (size !== bytes || (/^shared-map\/[a-f0-9]{64}$/.test(key) && !key.endsWith(sha256))) {
    throw new Error("An exported photo failed content verification.");
  }
  objects.push({ key, name, bytes, sha256, contentType: response.headers.get("Content-Type") });
}

const checkpoint = await (await request({ kind: "board" })).json();
if (checkpoint.revision !== board.revision || checkpoint.legacyEntries !== 0 || checkpoint.legacySettings !== 0) {
  throw new Error("The source changed during the export. Take a new snapshot.");
}
await writeFile(join(output, "snapshot.json"), JSON.stringify({ ...board, trash }) + "\n", { flag: "wx" });
await writeFile(join(output, "objects.json"), JSON.stringify(objects, null, 2) + "\n", { flag: "wx" });
process.stdout.write(`Captured ${board.entries.length} pins, ${trash.length} archived pins, and ${objects.length} objects at revision ${board.revision}.\n`);
