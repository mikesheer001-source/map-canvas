-- Move the existing Map Canvas board and Recently Deleted data onto app-owned
-- table names without changing their contents or public API.
ALTER TABLE shared_map_board RENAME TO map_canvas_board;
ALTER TABLE shared_map_trash RENAME TO map_canvas_trash;
DROP INDEX IF EXISTS shared_map_trash_deleted_at;
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
