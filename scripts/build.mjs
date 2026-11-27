import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const javascript = [
  "app.js", "enhancements.js", "sw.js", "backend/board.mjs", "backend/resources.mjs",
  "backend/test-server.mjs", "tests/database-browser.test.mjs", "offline-store.mjs", "offline-tiles.mjs", "tests/offline-core.test.mjs", "tests/offline-browser.test.mjs", "offline-tile-proxy/worker.mjs", "offline-tile-proxy/worker.test.mjs",
];
for (const file of javascript) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(file + " syntax check failed:\n" + (result.stderr || result.stdout));
}
const workerCheck = spawnSync(process.execPath, [
  "--experimental-strip-types", "--input-type=module", "-e", "await import('./backend/worker.ts')",
], { encoding: "utf8" });
if (workerCheck.status !== 0) throw new Error("Worker module check failed:\n" + (workerCheck.stderr || workerCheck.stdout));

const db = new DatabaseSync(":memory:");
for (const file of [
  "backend/migrations/0001_shared_map_board.sql",
  "backend/migrations/0002_shared_map_trash.sql",
  "backend/migrations/0003_independent_map_canvas_data.sql",
]) db.exec(await readFile(file, "utf8"));
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
for (const name of ["map_canvas_board", "map_canvas_trash", "map_canvas_resources"]) {
  assert.ok(tables.has(name), "Missing migration table " + name);
}
db.close();
process.stdout.write("Build checks passed: static app/Worker syntax and D1 migrations validated.\n");
