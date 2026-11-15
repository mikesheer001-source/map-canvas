# Map Canvas Cloudflare backend

The public GitHub Pages map talks to this Worker using the existing shared-map routes. D1 holds the board, including pin versions. R2 holds uploaded photos. Website visitors use the shared routes without signing in.

## Deploy to your Cloudflare account

From this directory, run Wrangler via `npx wrangler@4.92.0`. Sign in with `wrangler login`, or use a Cloudflare account ID and deployment API token in your environment.

1. Create a D1 database with `wrangler d1 create map-canvas`. Activate R2 in your account and create a bucket with `wrangler r2 bucket create map-canvas-photos`.
2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and fill in the database UUID. Set the resource names if you chose different names. Keep writes off for the initial deployment.
3. Run `wrangler d1 migrations apply DB --remote` and `wrangler deploy`. Record the HTTPS origin printed by Wrangler.
4. Download a fresh JSON snapshot from the old backend's `/api/shared-map/pins` into a temporary directory. Run `python prepare-migration.py /path/to/source.json https://YOUR-WORKER.workers.dev /path/to/new-import`. The command preserves the existing pin IDs, fields, and revision, and copies any images hosted by the old backend by verifying the SHA-256 in their URLs. Third-party image links are preserved.
5. For every digest and media type in the generated `photos.json`, run `wrangler r2 object put map-canvas-photos/shared-map/DIGEST --file /path/to/new-import/DIGEST --content-type MEDIA_TYPE --remote`. Then run `wrangler d1 execute DB --remote --file /path/to/new-import/import.sql`. The import expects an empty destination board. Compare the new `/api/shared-map/pins` response to `expected.json` and check migrated photo URLs.

## Cut over GitHub Pages

Verify create, edit, delete, a same-pin version conflict, and an upload using a disposable Cloudflare board before the final cutover. Use the GitHub Pages origin in requests to check browser access. At cutover, coordinate a brief editing pause so the final snapshot captures all source edits, keep a copy of it, and verify the destination against that snapshot. Set `MAP_WRITES_ENABLED` to `true` and deploy. Update `SHARED_MAP_URL` in the latest `app.js` to the new origin plus `/api/shared-map`, update the frontend README and the app cache version used by HTML and the service worker, then publish. Confirm the deployed JavaScript fetches the new API and repeat the two-client check. Keep the source available during verification and reconcile any newer edits before rolling back.

Keep secrets and migration snapshots outside the public repository. Pin and photo exports can be retained separately from the deployment code for recovery.
