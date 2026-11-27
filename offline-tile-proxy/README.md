# Map Canvas offline tile proxy

This is a **separate Cloudflare Worker** used only for user-started OpenFreeMap offline-area downloads. It is independent of the Map Canvas API Worker and has **no D1 or R2 bindings**, so deploying it does not perform or depend on the pending Map Canvas database migration/cutover.

Deploy from this directory:

\`npx wrangler@4.92.0 deploy\`

Wrangler prints the Worker URL. Copy its origin (for example, \`https://map-canvas-tiles.YOUR-WORKERS-DEV-SUBDOMAIN.workers.dev\`) into Map Canvas → Offline map areas → Tile proxy URL.

The proxy accepts requests only from the Map Canvas GitHub Pages origin (and localhost for development), permits only HTTPS \`tiles.openfreemap.org\` upstream URLs, sends the app-specific User-Agent and Referer, and forwards the provider's cache headers. It does not store map data itself; the browser service worker caches downloaded resources locally.

No API token, database, bucket, or application secret is required by this Worker.
