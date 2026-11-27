# Map Canvas

A public, shared map for places, notes and photos. Open https://mikesheer001-source.github.io/map-canvas/ to use it without signing in.

Pin additions, edits, moves, deletions and photo uploads save to the shared map and appear on other devices. The Undo and Redo buttons reverse recent changes from the current browser session. Open **Recently Deleted** below the map entries to restore shared pins and their photos within seven days. If someone else edits the same pin, refresh and review it before retrying.

## Google Sheets and backups

Export **CSV (Sheets)** and use **File → Import → Upload** in Google Sheets. After editing, download the sheet as CSV and import it back on the map. **Merge** adds entries and updates matching IDs. **Replace** replaces the shared map after confirmation. Export **JSON (site)** for a full backup, or use GeoJSON for compatible mapping tools.

A browser with edits from the previous local-only version can download its old snapshot in **Settings → Download previous browser edits**. Review the snapshot before importing it with Merge. It contains the full older map and may overwrite newer changes or restore pins deleted since then.

## Availability

The GitHub Pages frontend connects to the Cloudflare shared map service at `https://map-canvas-api.mikesheer001.workers.dev/api/shared-map`. D1 stores pins and Recently Deleted, and R2 stores uploaded photos. If the service is unavailable, the last loaded snapshot stays visible. Pins and canvas drawing edits can be queued on this device and synced when the connection returns; version conflicts are kept locally for review rather than overwriting newer shared edits. Existing browser-only feature and theme settings remain on that browser.

## Testing

GitHub Actions runs Node tests and Chromium/WebKit browser checks.


## Offline map areas and editing

Use the download arrow on the map to save the **current visible map area**. Choose a zoom range (5–18) and a name. Each user-started OpenFreeMap download includes its vector tiles plus the light/dark styles, sprites and common Latin/Vietnamese glyph ranges. The browser downloads use a separate Cloudflare Worker that sends a Map Canvas-specific User-Agent and Referer. Deploy it once as described below, then paste the printed Worker origin into the Offline map areas dialog. This proxy is independent of the Map Canvas API and its pending D1 migration. OpenStreetMap's public raster tile service is not used for area downloads because its policy prohibits prefetching/offline-area features.

- **App-enforced limits per area:** 3,000 vector tiles, 50 MB total downloaded resources, and at most 4 parallel requests. The app enforces the limits and stops/cleans up an incomplete download if it exceeds the byte cap or the browser runs out of storage.
- **Cached locally:** app shell, OpenFreeMap styles and their required assets, downloaded vector tiles, previously viewed OpenFreeMap tiles, and up to 120 CORS-readable Map Canvas photo responses encountered while browsing. Pin data and offline edits are stored separately on this browser. External photos that do not allow CORS-readable caching may still need a connection.
- **Offline editing:** once the shared map has loaded on a device at least once, pin additions, edits, moves, deletes, and existing line/arrow/circle canvas-drawing edits are saved optimistically to the local map snapshot. IndexedDB keeps one coalesced pending operation per pin, including its original server version. New edits to the same pin replace the queued payload rather than creating duplicate requests.
- **Sync and conflicts:** queued edits sync when the app reconnects or when Sync now is selected. The server's version checks prevent stale edits from overwriting another device's changes. Conflicts remain on the device and can be exported from Offline map areas for manual review.
- **Storage:** each area is limited to 50 MB, but the browser/device may impose a lower overall storage quota or evict site data. Keep a separate JSON export for important maps and pending edits. Saved areas can be deleted from the Offline map areas dialog.


### Deploy the independent offline tile proxy

The offline-area downloader needs an app-specific User-Agent, which browser JavaScript cannot set directly. Deploy the separate, database-free proxy:

\`cd offline-tile-proxy\`
\`npx wrangler@4.92.0 deploy\`

Paste the workers.dev origin printed by Wrangler into the **Tile proxy URL** field in Map Canvas → Offline map areas. This deployment does not touch the existing Map Canvas API Worker, D1, R2, or the pending database cutover.


## Route optimization

Select **Select stops**, then click the pins to include them in a driving route. The first selected pin is the fixed start and the last selected pin is the fixed finish. Choose **Optimize route** to draw the road route and show the ordered stops, road distance, and estimated driving time (without live traffic).

Routing uses the public OSRM Trip service and OpenStreetMap road data. OSRM brute-forces routes with fewer than 10 waypoints and uses a farthest-insertion heuristic for 10 or more. A route can contain up to 500 pins: above 100, Map Canvas first creates a fast nearest-neighbor order, then optimizes overlapping segments of up to 100 stops each. That large-route result is approximate across segment boundaries, not a globally exact optimum. Routes require a network connection and drivable connectivity between stops.


## Interactive multimodal routes

Open **Multimodal transport routes**, choose bus, train, flight, ferry, or driving, select **Add route**, then click two map pins (or their sidebar entries) as origin and destination. Mode-coloured and patterned routes can be clicked for details. Routes are saved in this browser.

Driving geometry uses the public OSRM road router. Bus, train, and ferry use matching OpenStreetMap route relations when available; otherwise a straight-line approximation is explicitly labelled. Flights use an approximate great-circle path, not a live airline path. Transit and flight times use typical-speed estimates, not live timetables or schedules.
