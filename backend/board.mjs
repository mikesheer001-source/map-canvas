const MAX_ENTRIES = 500;
const MAX_BOARD_BYTES = 1700000;
const MAX_ENTRY_BYTES = 100000;

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

export function createBoardStore(db) {
  async function read() {
    const row = await db.prepare("SELECT revision, value FROM shared_map_board WHERE id = 1").first();
    if (!row) throw new MapError("Shared map data has not been imported yet.", 503);
    return row;
  }

  async function update(mutator, expectedRevision = null) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await read();
      if (expectedRevision !== null && row.revision !== expectedRevision) throw new MapError("The map changed. Refresh and try again.", 409);
      const board = JSON.parse(row.value);
      const revision = row.revision + 1;
      const result = mutator(board, revision);
      const tombstones = Object.entries(board.tombstones);
      if (tombstones.length > 5000) {
        tombstones.sort((left, right) => left[1] - right[1]);
        for (const [id] of tombstones.slice(0, tombstones.length - 5000)) delete board.tombstones[id];
      }
      const value = JSON.stringify(board);
      if (board.entries.length > MAX_ENTRIES || new TextEncoder().encode(value).length > MAX_BOARD_BYTES) {
        throw new MapError("The map is full. Remove some pins or photos and try again.", 413);
      }
      const saved = await db.prepare("UPDATE shared_map_board SET value = ?, revision = ? WHERE id = 1 AND revision = ?")
        .bind(value, revision, row.revision).run();
      if (saved.meta.changes === 1) return { ...result, revision };
      if (expectedRevision !== null) throw new MapError("The map changed. Refresh and try again.", 409);
    }
    throw new MapError("The map is busy. Try again.", 409);
  }

  return {
    async list() { return publicBoard(await read()); },
    async put(id, entry, expectedVersion) {
      validateEntry(entry, id);
      if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) throw new MapError("Invalid pin version.");
      return update((board, revision) => {
        const index = board.entries.findIndex((item) => item.id === id);
        const currentVersion = index >= 0 ? board.entries[index].version : (board.tombstones[id] ?? null);
        if (currentVersion !== expectedVersion) throw new MapError("This pin changed. Refresh and try again.", 409);
        const saved = { ...entry, version: revision };
        if (index < 0) board.entries.push(saved); else board.entries[index] = saved;
        delete board.tombstones[id];
        return { entry: saved };
      });
    },
    async remove(id, expectedVersion) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MapError("Invalid pin version.");
      return update((board, revision) => {
        const index = board.entries.findIndex((item) => item.id === id);
        if (index < 0 || board.entries[index].version !== expectedVersion) throw new MapError("This pin changed. Refresh and try again.", 409);
        board.entries.splice(index, 1);
        board.tombstones[id] = revision;
        return { version: revision };
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
        if (mode === "replace") {
          for (const id of existing.keys()) {
            if (!ids.has(id)) { existing.delete(id); board.tombstones[id] = revision; }
          }
        }
        board.entries = [...existing.values()];
        return { entries: board.entries, added, updated };
      }, expectedRevision);
    },
  };
}
