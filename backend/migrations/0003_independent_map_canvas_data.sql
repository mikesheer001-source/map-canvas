-- Copy the current board and Recently Deleted data into Map Canvas-owned
-- tables. Keep the legacy shared_map_* tables intact during cutover so the
-- currently deployed Worker can continue serving reads until the new Worker
-- is deployed and verified.
CREATE TABLE IF NOT EXISTS map_canvas_board (
  id INTEGER PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO map_canvas_board (id, revision, value)
  SELECT id, revision, value FROM shared_map_board;

CREATE TABLE IF NOT EXISTS map_canvas_trash (
  id TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO map_canvas_trash (id, value, version, deleted_at)
  SELECT id, value, version, deleted_at FROM shared_map_trash;
CREATE INDEX IF NOT EXISTS map_canvas_trash_deleted_at ON map_canvas_trash (deleted_at);

-- Routes and itineraries are versioned JSON records in the same dedicated D1
-- database as pins. Composite keys keep route and itinerary IDs independent.
CREATE TABLE IF NOT EXISTS map_canvas_resources (
  kind TEXT NOT NULL CHECK (kind IN ('route', 'itinerary')),
  id TEXT NOT NULL,
  value TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS map_canvas_resources_updated
  ON map_canvas_resources (kind, updated_at DESC);
