# Map Canvas Cloudflare backend

The public GitHub Pages map talks to this Worker using the existing shared-map routes. D1 holds pins, pin versions, deletion markers, and Recently Deleted. R2 holds uploaded photos. Existing third-party image links stay with their pins. Website visitors use the shared routes without signing in.

## Deploy to your Cloudflare account

From this directory, run Wrangler via `npx wrangler@4.92.0`. Sign in with `wrangler login`, or use a Cloudflare account ID and deployment API token in your environment.

1. Create a D1 database with `wrangler d1 create map-canvas`. Activate R2 in your account and create a bucket with `wrangler r2 bucket create map-canvas-photos`.
2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and fill in the database UUID. Set the resource names if you chose different names. Keep writes off for the initial deployment.
3. Run `wrangler d1 migrations apply DB --remote` and `wrangler deploy`. Record the HTTPS origin printed by Wrangler.
4. From the matching Sites source checkout, deploy the authenticated migration export route. Set `MAP_CANVAS_EXPORT_SHA256` to the SHA-256 hex digest of a randomly generated 64-character hex export token, then set `MAP_CANVAS_PAUSE_SHARED_WRITES=true`. Run `node snapshot-source.mjs /path/to/source-backup` with the original token in the process environment as `MAP_CANVAS_EXPORT_TOKEN`. The backup includes the board, deletion markers, complete trash records, and verified copies of the source bucket objects. Keep it outside Git. Remove the temporary export access after migration.
5. Run `python prepare-migration.py /path/to/source-backup/snapshot.json https://YOUR-WORKER.workers.dev /path/to/new-import`. It preserves revision, pin fields, and trash expiry, and updates Sites-hosted image and photo credit URLs. For a rehearsal, use `--preview` with the public pins response.
6. Upload each file in the source's `objects.json` manifest to `map-canvas-photos` at its original key, preserving Content-Type. Verify the uploaded bytes against the manifest. Run `wrangler d1 execute DB --remote --file /path/to/new-import/import.sql` against the empty destination. Compare the new `/api/shared-map/pins` response to `expected.json`, check the recoverable items in `/api/shared-map/trash`, and confirm the migrated photo URLs serve the expected bytes.

## Cut over GitHub Pages

Verify create, edit, delete, restore, a same-pin version conflict, and an upload using a disposable Cloudflare board. Use the GitHub Pages origin to check browser access. Keep source writes paused from the final snapshot through the switch so clients cannot edit both databases. Enable `MAP_WRITES_ENABLED` on the verified destination. Update `SHARED_MAP_URL` in the latest `app.js`, the frontend README, the browser test route, and the cache versions in HTML and the service worker. Publish and confirm that the live frontend reads and writes the new Worker. Keep the source accessible during verification and reconcile new edits before reverting.

Keep secrets and migration snapshots outside the public repository. Pin and photo exports can be retained separately from the deployment code for recovery.

Run `node --test backend/board.test.mjs` from the repo root to check version conflicts, archive expiry, restore, and replacement behavior.


## Dedicated Map Canvas data

The D1 database bound as DB and named map-canvas is dedicated to this app. It replaces the former externally hosted shared-store persistence; it is not a database shared with another app. Migration 0003_independent_map_canvas_data.sql copies the existing pin and Recently Deleted rows into map_canvas_board and map_canvas_trash. The legacy shared_map_* tables remain as a rollback snapshot so the currently deployed Worker can keep serving reads until the new Worker is deployed.

- **Pins:** map_canvas_board stores the versioned pin board; map_canvas_trash stores deleted pins and their seven-day restore window.
- **Routes and itineraries:** map_canvas_resources stores versioned JSON records with separate route and itinerary namespaces, optimistic concurrency checks, and soft deletion.
- **Photos:** the map-canvas-photos R2 bucket stores uploaded image bytes; D1 stores the corresponding URLs and pin metadata.

The existing /api/shared-map URL is retained for frontend compatibility. New resource endpoints are:
- GET /api/shared-map/routes and GET /api/shared-map/itineraries
- PUT /api/shared-map/routes/{id} and PUT /api/shared-map/itineraries/{id}
- DELETE /api/shared-map/routes/{id} and DELETE /api/shared-map/itineraries/{id}

For PUT, send a JSON body with item and expectedVersion: null to create a record. For an update or restore, send the current version number. DELETE requires the current expectedVersion. The server increments versions and rejects stale writes with HTTP 409. Route coordinate arrays are validated when supplied; itinerary day and stop counts are bounded. Each resource is limited to 250 KB.

D1 is used for structured records and version-checked updates; KV is intentionally not used because these writes need transactional consistency. R2 remains the right place for image blobs. The app still has no sign-in, so the existing public map API remains publicly readable and writable: do not store private or sensitive information here. This storage item adds the backend contract; it does not add route/itinerary editing UI.

For a safe cutover, first set MAP_WRITES_ENABLED=false on the currently deployed Worker to pause edits while keeping reads available. From the backend directory, apply the migration and deploy the new Worker with writes still disabled:

npx wrangler@4.92.0 d1 migrations apply DB --remote
npx wrangler@4.92.0 deploy

Verify GET pins, trash, routes and itineraries against the new Worker. Only then set MAP_WRITES_ENABLED=true. The legacy shared_map_* tables are retained as a rollback snapshot; the new Worker reads and writes the map_canvas_* tables.
