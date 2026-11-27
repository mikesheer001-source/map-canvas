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


### Researched transport options

Click a saved multimodal route to open its comparison panel. The panel queries the public Transitous MOTIS 2 journey-planning API for scheduled public transport and direct driving options around the selected departure time. It displays operators, departures/arrivals, duration, stops, transfers and fare products when the underlying feed supplies them. It also links to operator fare/route pages when supplied, plus external 12Go, flight-search and driving-direction pages.

Fare amounts are never estimated: a missing fare stays blank/unpriced. Feed fares are marked **unverified** because they are not a live checkout quote; saved research older than 24 hours is marked stale and is not used for cheapest/best-value rankings. Cheapest and best-value picks are withheld when any option lacks a comparable fare or currencies differ. Best value means the lowest fare among options within 25% of the fastest itinerary. The selected departure date/time, research timestamp, source links and normalized options are saved with the route in this browser.

Transitous is a best-effort community service. Its API policy permits open-source, non-commercial use only, asks clients to keep requests light, and requires source attribution. Map Canvas links to its source and API documentation in the popup. Transitous coverage depends on regional timetable feeds; no results do not prove that a service does not exist. 12Go and Google links are external search pages, not prices imported into Map Canvas.


## Itinerary builder

Open **Itinerary builder** in the sidebar to create a named, day-by-day plan. Add existing map pins or add custom locations by entering coordinates, set each day's date, drag stops to reorder them, and add or remove days. Each adjacent stop pair can use a matching saved multimodal route, or you can create a bus, train, flight, ferry, or driving route directly from that itinerary leg. Where a route has researched timetable options, select a specific service/fare option; otherwise its route-time estimate is used.

The summary adds selected leg durations and shows selected fares by currency. It never converts currencies or invents missing fares. Travel times are estimates from the saved route or selected timetable option; feed fares remain unverified until confirmed with the operator. Totals are partial when a leg has no route or no selected fare.

Saved itineraries are stored in this browser's local storage under \`map-canvas:itineraries-v1\`; they are not uploaded to the shared map database and do not automatically sync to other devices. Saving writes a compact copy of each selected route and fare into the itinerary. Deleting a map pin leaves its saved stop name and coordinates in the itinerary and marks the pin as deleted. Deleting a route from the route library leaves its saved route/fare snapshot and estimated totals intact, and marks the route as removed from the library. Neither deletion silently removes itinerary stops or connections.

## Publish pins from ChatGPT through GitHub

Use a GitHub-connected Chat that can commit to this repository. For map content, commit one JSON submission per pin under `publish/pins/`. Include the pin data inside `entry` and set `expectedVersion` to `null` for a new pin, or to the version returned by the [live pin API](https://map-canvas-api.mikesheer001.workers.dev/api/shared-map/pins) for an update.

```json
{
  "expectedVersion": null,
  "entry": {
    "id": "7ad12a8b-a07c-49f4-923b-d92a1a674b6c",
    "kind": "place",
    "title": "Example place",
    "lat": 21.0285,
    "lng": 105.8542,
    "photo": "publish/photos/example.jpg"
  }
}
```

Use a fresh UUID for each new pin. For updates, include the existing ID and only the fields to change. Use a public HTTPS photo URL or commit a JPG, PNG, WebP, or GIF of up to 5 MiB alongside the submission under `publish/photos/`. The same formats work for `gallery` entries. Submit photo and JSON changes in the same push. The example is documentation only.

A push to `main` runs **Publish Map Canvas pins** for new or changed submissions. The workflow copies committed image files to the existing photo store, verifies their bytes, saves the pin if needed, and reads it back. Check the [workflow runs](https://github.com/mikesheer001-source/map-canvas/actions/workflows/publish-map-pins.yml) before marking a submission complete. For a version conflict, reread the live pin and commit a reviewed update. A rerun of a successful submission leaves matching pins alone. Removing a submission file does not delete the live pin. The public map and its existing editing controls require no account.
