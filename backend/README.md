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
