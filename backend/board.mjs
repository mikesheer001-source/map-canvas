const MAX_ENTRIES = 500;
const MAX_BOARD_BYTES = 1700000;
const MAX_ENTRY_BYTES = 100000;
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class MapError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function safePhoto(value) {
  if (!value) return true;
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function validateEntry(entry, id = entry?.id) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      typeof id !== "string" || !/^(?:[0-9a-f]{8}-[0-9a-f-]{27,36}|hostel-[0-9]+)$/i.test(id) || entry.id !== id ||
      typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 140 ||
      !["place", "note", "photo"].includes(entry.kind) ||
      typeof entry.lat !== "number" || !Number.isFinite(entry.lat) || Math.abs(entry.lat) > 85 ||
      typeof entry.lng !== "number" || !Number.isFinite(entry.lng) || Math.abs(entry.lng) > 180 ||
      new TextEncoder().encode(JSON.stringify(entry)).length > MAX_ENTRY_BYTES) {
    throw new MapError("This pin has invalid or oversized data.");
  }
  for (const name of ["notes", "category", "price", "rating", "photo", "link", "icon", "color", "layer", "group"]) {
    if (entry[name] != null && typeof entry[name] !== "string") throw new MapError(`Invalid ${name}.`);
  }
  if (entry.notes?.length > 4000 || entry.category?.length > 40 || entry.photo?.length > 38000) {
    throw new MapError("This pin has invalid or oversized data.");
  }
  if (entry.gallery != null && (!Array.isArray(entry.gallery) || entry.gallery.length > 12 || entry.gallery.some((photo) => typeof photo !== "string" || photo.length > 38000))) {
    throw new MapError("This pin has an invalid photo gallery.");
  }
  if ((entry.photo && !safePhoto(entry.photo)) || entry.gallery?.some((photo) => !safePhoto(photo))) {
    throw new MapError("Use HTTPS photo links or uploaded JPEG photos.");
  }
  if (entry.link) {
    try {
      const link = new URL(entry.link);
      if (link.protocol !== "https:" || link.username || link.password) throw new Error("Invalid link");
    } catch { throw new MapError("Use an HTTPS link."); }
  }
  return entry;
}

function publicBoard(row) {
  const board = JSON.parse(row.value);
  return { entries: board.entries, revision: row.revision };
}

export function createBoardStore(db, now = Date.now) {
  async function read() {
    const row = await db.prepare("SELECT revision, value FROM map_canvas_board WHERE id = 1").first();
    if (!row) throw new MapError("Shared map data has not been imported yet.", 503);
    return row;
  }

  function readDeletedPin(id) {
    return db.prepare("SELECT value, version, deleted_at FROM map_canvas_trash WHERE id = ?").bind(id).first();
  }

  async function update(mutator, expectedRevision = null) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await read();
      if (expectedRevision !== null && row.revision !== expectedRevision) throw new MapError("The map changed. Refresh and try again.", 409);
      const board = JSON.parse(row.value);
      const revision = row.revision + 1;
      const time = now();
      const { archive = [], clear = [], ...result } = await mutator(board, revision, time);
      const tombstones = Object.entries(board.tombstones);
      if (tombstones.length > 5000) {
        tombstones.sort((left, right) => left[1] - right[1]);
        for (const [id] of tombstones.slice(0, tombstones.length - 5000)) delete board.tombstones[id];
      }
      const value = JSON.stringify(board);
      if (board.entries.length > MAX_ENTRIES || new TextEncoder().encode(value).length > MAX_BOARD_BYTES) {
        throw new MapError("The map is full. Remove some pins or photos and try again.", 413);
      }
      const statements = [];
      // Run the archive changes and board update in one transaction. Only the
      // request holding the expected board revision may modify the archive.
      if (archive.length) {
        statements.push(db.prepare(`
          INSERT INTO map_canvas_trash (id, value, version, deleted_at)
          SELECT json_extract(pin.value, '$.id'), pin.value, ?, ? FROM json_each(?) AS pin
          WHERE EXISTS (SELECT 1 FROM map_canvas_board WHERE id = 1 AND revision = ?)
          ON CONFLICT(id) DO UPDATE SET value = excluded.value, version = excluded.version, deleted_at = excluded.deleted_at
        `).bind(revision, time, JSON.stringify(archive), row.revision));
      }
      if (clear.length) {
        statements.push(db.prepare(`
          DELETE FROM map_canvas_trash WHERE id IN (SELECT value FROM json_each(?))
          AND EXISTS (SELECT 1 FROM map_canvas_board WHERE id = 1 AND revision = ?)
        `).bind(JSON.stringify(clear), row.revision));
      }
      statements.push(db.prepare("UPDATE map_canvas_board SET value = ?, revision = ? WHERE id = 1 AND revision = ?")
        .bind(value, revision, row.revision));
      const saved = statements.length === 1 ? await statements[0].run() : (await db.batch(statements)).at(-1);
      if (saved.meta.changes === 1) return { ...result, revision };
      if (expectedRevision !== null) throw new MapError("The map changed. Refresh and try again.", 409);
    }
    throw new MapError("The map is busy. Try again.", 409);
  }

  return {
    async list() { return publicBoard(await read()); },
    async listDeleted(prune = true) {
      const cutoff = now() - TRASH_RETENTION_MS;
      const list = db.prepare(`
        SELECT id, version, deleted_at AS deletedAt, deleted_at + ? AS expiresAt,
        json_extract(value, '$.title') AS title
        FROM map_canvas_trash WHERE deleted_at > ? ORDER BY deleted_at DESC, id
      `).bind(TRASH_RETENTION_MS, cutoff);
      if (!prune) return { entries: (await list.all()).results };
      const [, { results }] = await db.batch([
        db.prepare("DELETE FROM map_canvas_trash WHERE deleted_at <= ?").bind(cutoff),
        list,
      ]);
      return { entries: results };
    },
    async restore(id, expectedVersion) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MapError("Invalid pin version.");
      return update(async (board, revision, time) => {
        const deleted = await readDeletedPin(id);
        if (!deleted || deleted.deleted_at <= time - TRASH_RETENTION_MS) {
          throw new MapError("This pin is no longer in Recently Deleted.", 404);
        }
        if (deleted.version !== expectedVersion || board.entries.some((entry) => entry.id === id)) {
          throw new MapError("This pin changed. Refresh and try again.", 409);
        }
        const entry = { ...JSON.parse(deleted.value), version: revision };
        board.entries.push(entry);
        delete board.tombstones[id];
        return { entry, clear: [id] };
      });
    },
    async put(id, entry, expectedVersion) {
      validateEntry(entry, id);
      if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) throw new MapError("Invalid pin version.");
      return update(async (board, revision, time) => {
        const index = board.entries.findIndex((item) => item.id === id);
        const deleted = index < 0 ? await readDeletedPin(id) : null;
        const currentVersion = index >= 0 ? board.entries[index].version : (deleted?.version ?? board.tombstones[id] ?? null);
        if (currentVersion !== expectedVersion ||
            (index < 0 && expectedVersion !== null && (!deleted || deleted.deleted_at <= time - TRASH_RETENTION_MS))) throw new MapError("This pin changed. Refresh and try again.", 409);
        const saved = { ...entry, version: revision };
        if (index < 0) board.entries.push(saved); else board.entries[index] = saved;
        delete board.tombstones[id];
        return { entry: saved, clear: deleted ? [id] : [] };
      });
    },
    async remove(id, expectedVersion) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MapError("Invalid pin version.");
      return update((board, revision) => {
        const index = board.entries.findIndex((item) => item.id === id);
        if (index < 0 || board.entries[index].version !== expectedVersion) throw new MapError("This pin changed. Refresh and try again.", 409);
        const [entry] = board.entries.splice(index, 1);
        board.tombstones[id] = revision;
        return { version: revision, archive: [entry] };
      });
    },
    async import(entries, mode, expectedRevision) {
      if (!Array.isArray(entries) || entries.length > MAX_ENTRIES || !["merge", "replace"].includes(mode) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new MapError("Invalid import.");
      const ids = new Set();
      for (const entry of entries) {
        validateEntry(entry);
        if (ids.has(entry.id)) throw new MapError("Import contains duplicate pin IDs.");
        ids.add(entry.id);
      }
      return update((board, revision) => {
        const existing = new Map(board.entries.map((entry) => [entry.id, entry]));
        let added = 0;
        let updated = 0;
        for (const entry of entries) {
          if (existing.has(entry.id)) updated++; else added++;
          existing.set(entry.id, { ...entry, version: revision });
          delete board.tombstones[entry.id];
        }
        const archive = [];
        if (mode === "replace") {
          for (const [id, entry] of existing) {
            if (ids.has(id)) continue;
            archive.push(entry);
            existing.delete(id);
            board.tombstones[id] = revision;
          }
        }
        board.entries = [...existing.values()];
        return { entries: board.entries, added, updated, archive, clear: [...ids] };
      }, expectedRevision);
    },
  };
}
