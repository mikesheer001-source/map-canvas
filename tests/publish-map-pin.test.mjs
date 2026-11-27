import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker from "../backend/worker.ts";
import { createTestEnv } from "../backend/test-server.mjs";
import { publishPin } from "../scripts/publish-map-pin.mjs";

test("publishes the file-backed photo and pin, retries safely, and rejects stale edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "map-publish-"));
  const env = await createTestEnv();
  const base = "https://map.example/api/shared-map";
  const call = (url, options) => worker.fetch(new Request(url, options), env);
  const id = "cfbfa48a-88c6-443e-94a4-fcb3216b6c15";
  const photo = "publish/photos/pixel.png";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF2sAAAAASUVORK5CYII=", "base64");
  const entry = { id, title: "Test pin", kind: "place", lat: 21, lng: 105, photo };
  try {
    await mkdir(join(root, "publish/photos"), { recursive: true });
    await writeFile(join(root, photo), png);
    const created = await publishPin({ expectedVersion: null, entry }, { base, root, call });
    assert.equal(created.title, entry.title);
    assert.match(created.photo, /\/photo\/[a-f0-9]{64}$/);
    assert.deepEqual(Buffer.from(await (await call(created.photo)).arrayBuffer()), png);
    assert.equal((await publishPin({ expectedVersion: null, entry }, { base, root, call })).version, created.version);
    const updated = await publishPin({ expectedVersion: created.version, entry: { id, notes: "Updated" } }, { base, root, call });
    assert.equal(updated.notes, "Updated");
    assert.equal(updated.photo, created.photo);
    await assert.rejects(publishPin({ expectedVersion: created.version, entry: { id, notes: "Stale" } }, { base, root, call }), /version/i);
    await assert.rejects(publishPin({ expectedVersion: updated.version, entry: { id, photo: "publish/photos/../bad.png" } }, { base, root, call }), /photo/i);
    assert.deepEqual((await (await call(base + "/pins")).json()).entries, [updated]);
  } finally {
    env.sql.close();
    await rm(root, { recursive: true, force: true });
  }
});
