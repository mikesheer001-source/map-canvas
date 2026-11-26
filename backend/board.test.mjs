import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { createBoardStore } from "./board.mjs";

const seed = Array.from({ length: 12 }, (_, index) => pin("hostel-" + index, "Fixture pin " + index));

const boardMigration = await readFile(new URL("./migrations/0001_shared_map_board.sql", import.meta.url), "utf8");
const trashMigration = await readFile(new URL("./migrations/0002_map_canvas_trash.sql", import.meta.url), "utf8");
const mapCanvasMigration = await readFile(new URL("./migrations/0003_independent_map_canvas_data.sql", import.meta.url), "utf8");

function createDatabase(entries = seed) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(boardMigration);
  sql.exec(trashMigration);
  sql.exec(mapCanvasMigration);
  sql.prepare("INSERT INTO map_canvas_board VALUES (1, 1, ?)").run(JSON.stringify({
    entries: entries.map((entry) => ({ ...entry, version: 1 })), tombstones: {},
  }));
  function prepare(query, args = []) {
    return {
      async first() { return sql.prepare(query).get(...args) ?? null; },
      async all() { return { results: sql.prepare(query).all(...args) }; },
      bind(...values) { return prepare(query, values); },
      runSync() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; },
      async run() { return this.runSync(); },
      batchResult() {
        if (query.trimStart().startsWith("SELECT")) return { results: sql.prepare(query).all(...args) };
        return this.runSync();
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.batchResult());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function pin(id, title) {
  return { id, title, kind: "place", lat: 21, lng: 105, notes: "See photo", photo: "https://example.com/image.jpg", gallery: ["https://example.com/second.jpg"] };
}

const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";

test("shared clients create, edit, delete, restore and keep photos and notes", async () => {
  const db = createDatabase();
  const phone = createBoardStore(db);
  const laptop = createBoardStore(db);
  assert.equal((await phone.list()).entries.length, 12);
  const created = await phone.put(id1, pin(id1, "Cafe"), null);
  assert.equal((await laptop.list()).entries.find((p) => p.id === id1).photo, "https://example.com/image.jpg");
  const edited = await laptop.put(id1, { ...created.entry, title: "Edited" }, created.entry.version);
  await assert.rejects(phone.put(id1, { ...created.entry, title: "Old" }, created.entry.version), (error) => error.status === 409);
  const deleted = await laptop.remove(id1, edited.entry.version);
  assert.equal((await phone.list()).entries.some((p) => p.id === id1), false);
  const restored = await phone.put(id1, edited.entry, deleted.version);
  assert.equal(restored.entry.notes, "See photo");
  assert.equal((await laptop.list()).entries.find((p) => p.id === id1).title, "Edited");
});

test("concurrent writes preserve unrelated pins and reject edits of the same version", async () => {
  const db = createDatabase();
  const a = createBoardStore(db);
  const b = createBoardStore(db);
  await Promise.all([a.put(id1, pin(id1, "One"), null), b.put(id2, pin(id2, "Two"), null)]);
  assert.equal((await a.list()).entries.filter((p) => [id1, id2].includes(p.id)).length, 2);
  const version = (await a.list()).entries.find((p) => p.id === id1).version;
  const attempts = await Promise.allSettled([
    a.put(id1, pin(id1, "Edit A"), version), b.put(id1, pin(id1, "Edit B"), version),
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected")[0].reason.status, 409);
});

test("an empty replaced map stays empty and conflicting imports cannot overwrite changes", async () => {
  const db = createDatabase();
  const a = createBoardStore(db);
  const b = createBoardStore(db);
  const initial = await a.list();
  await b.put(id1, pin(id1, "New"), null);
  await assert.rejects(a.import([], "replace", initial.revision), (error) => error.status === 409);
  const latest = await a.list();
  await a.import([], "replace", latest.revision);
  assert.equal((await b.list()).entries.length, 0);
  assert.equal((await createBoardStore(db).list()).entries.length, 0);
});

test("rejects unsafe image and destination URLs", async () => {
  const board = createBoardStore(createDatabase());
  await assert.rejects(board.put(id1, { ...pin(id1, "Cafe"), photo: "javascript:alert(1)" }, null));
  await assert.rejects(board.put(id1, { ...pin(id1, "Cafe"), gallery: ["http://example.com/a.png"] }, null));
  await assert.rejects(board.put(id1, { ...pin(id1, "Cafe"), link: "javascript:alert(1)" }, null));
  assert.equal((await board.list()).entries.length, 12);
});

test("shared trash restores the entire entry and expires exactly seven days after deletion", async () => {
  const db = createDatabase([]);
  let time = 1700000000000;
  const week = 7 * 24 * 60 * 60 * 1000;
  const phone = createBoardStore(db, () => time);
  const laptop = createBoardStore(db, () => time);
  const { entry } = await phone.put(id1, pin(id1, "Cafe"), null);
  const firstDeletion = await phone.remove(id1, entry.version);
  assert.deepEqual((await laptop.listDeleted()).entries.map((item) => ({ ...item })), [
    { id: id1, title: "Cafe", version: firstDeletion.version, deletedAt: time, expiresAt: time + week },
  ]);
  assert.deepEqual((await laptop.list()).entries, []);
  const result = await Promise.allSettled([
    laptop.restore(id1, firstDeletion.version), phone.restore(id1, firstDeletion.version),
  ]);
  const successful = result.filter((attempt) => attempt.status === "fulfilled");
  assert.equal(successful.length, 1);
  const restored = successful[0].value.entry;
  assert.deepEqual(restored, { ...entry, version: restored.version });
  assert.deepEqual((await phone.listDeleted()).entries, []);

  const secondDeletion = await phone.remove(id1, restored.version);
  await assert.rejects(laptop.restore(id1, firstDeletion.version), { status: 409 });
  time += week - 1;
  assert.equal((await laptop.listDeleted()).entries.length, 1);
  time++;
  await assert.rejects(laptop.restore(id1, secondDeletion.version), { status: 404 });
  await assert.rejects(phone.put(id1, restored, secondDeletion.version), { status: 409 });
  assert.deepEqual((await laptop.listDeleted()).entries, []);
});

test("replace archives omitted pins and merging the same ID clears its trash record", async () => {
  const board = createBoardStore(createDatabase([pin(id1, "One"), pin(id2, "Two")]));
  const initial = await board.list();
  const replaced = await board.import([pin(id2, "Two")], "replace", initial.revision);
  assert.deepEqual((await board.listDeleted()).entries.map(({ id }) => id), [id1]);
  await board.import([pin(id1, "Merged back")], "merge", replaced.revision);
  assert.deepEqual((await board.listDeleted()).entries, []);
  assert.deepEqual((await board.list()).entries.map(({ title }) => title), ["Two", "Merged back"]);
});

test("a read-only trash listing leaves the expired records available for backup", async () => {
  const db = createDatabase([]);
  let time = 1700000000000;
  const board = createBoardStore(db, () => time);
  const added = await board.put(id1, pin(id1, "Demo"), null);
  await board.remove(id1, added.entry.version);
  time += 7 * 24 * 60 * 60 * 1000;
  assert.deepEqual((await board.listDeleted(false)).entries, []);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM map_canvas_trash").first()).count, 1);
  assert.deepEqual((await board.listDeleted()).entries, []);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM map_canvas_trash").first()).count, 0);
});
