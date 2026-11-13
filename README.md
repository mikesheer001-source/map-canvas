# Map Canvas

A mobile-friendly, **public, no-login map + canvas** for Hanoi. The GitHub Pages frontend shows 13 hostel locations imported from the Hostel Canvas Google Sheet. Anyone can explore the map, toggle base layers, zoom in for picture/label cards, and search/filter pins.

## Publish on GitHub Pages

This repository contains the complete static site. **One-time GitHub Pages activation is required**:

1. Visit **Settings → Pages** for this repository.
2. Under *Build and deployment*, select **Deploy from a branch**.
3. Select **main**, folder **/(root)**, then click **Save**.
4. After Pages publishes, the site URL is:
   **https://mikesheer001-source.github.io/map-canvas/**

GitHub Pages hosts only static files. It does **not** run the site's former Cloudflare D1 or R2 database or its API routes. This version is a new static implementation, not a byte-for-byte copy of the earlier ChatGPT Sites backend.

## Enable real shared Google Sheets editing (no visitor sign-in)

The site currently has seeded hostel locations even without this step, but *public writes are disabled* until you enable the shared backend. This avoids pretending a browser-only save would update the shared map.

1. Open [Hostel Canvas](https://docs.google.com/spreadsheets/d/19--eDj8Xj_ux0QanDyGGVD9y7UeAXMqwN-aO7DikXnA/edit).
2. Choose **Extensions → Apps Script**, paste the contents of [sheets-bridge.gs](sheets-bridge.gs), and save.
3. Choose **Deploy → New deployment → Web app**. Configure **Execute as: Me** and **Who has access: Anyone**, authorize the script, and copy its web app URL ending in \`/exec\`.
4. Replace the empty \`sheetWebAppUrl\` in [config.js](config.js) with the URL. Commit the update on GitHub.
5. Reload the Pages site. It now reads both the hostel tab and shared "Map Canvas" entries and can write back to the Map Canvas tab.

**Important:** This setup makes map entries publicly readable and permits anonymous contributions on your behalf. Never store private or sensitive information in these tabs. Contributors may edit/delete **their own entries on the same browser** using a per-entry random edit key; there is no sign-in. No spam throttling is enabled; public anonymous writes can be abused.

Photos can be uploaded/pasted as compressed thumbnails (small enough to store in a Sheets cell) or supplied as a public HTTPS image URL. Photo uploads in this version are not stored in GitHub, and Google Drive image storage is not automatically provisioned.

## Map controls

- **OpenFreeMap**: MapLibre vector map with OpenFreeMap Liberty style.
- **OpenStreetMap**: raster street tiles rendered by MapLibre.
- An OpenStreetMap/Leaflet fallback is attempted if MapLibre cannot initialize.
- Pins show individual category-matched emojis at every zoom; labels, prices, ratings and photo thumbnails appear from zoom **16.8**.
- Shared data is visible on one public URL, independent of devices. No login is needed to view or contribute after the Sheets bridge is deployed.
- Data from the source hostel sheet is a snapshot until the bridge is connected, after which the site refreshes it from the workbook.
- Because Google Sheets is a simple backend, this public collaboration setup does not provide large-file media storage, user accounts, or rich multiuser conflict resolution.

## Technology

Vanilla JavaScript, HTML, CSS, [MapLibre GL JS](https://maplibre.org/), [OpenFreeMap](https://openfreemap.org/), OpenStreetMap tiles, and optional Google Apps Script / Google Sheets. No build step, API key, or account required to view.

## Pin tracking and testing (November 2026)

Previously, custom HTML pin dots could shift independently of the map while zooming or panning, and a CSS rule overrode MapLibre marker positioning. Pin locations now use native map-anchored MapLibre emoji markers with transparent native GeoJSON hit areas, or Leaflet emoji markers in fallback mode. HTML note/photo cards appear only at close zoom and are hidden while the map is moving. Switching base styles restores pin layers.

Automated regression checks: `node tests/pin-regression.test.mjs`. A GitHub Actions workflow also runs Playwright tests in Chromium and WebKit, checking 45 map-coordinate projections per engine across zoom, pan, style toggles and mobile-size viewports, plus real pointer drags. Four screenshots are uploaded as workflow artifacts for visual review. These tests represent browser engine coverage, not a physical iPhone test.

## New map features (November 2026)

- Search by title, category, notes, price or rating; filter by type and category; sort by price/rating/title.
- Custom icon and color on new public entries. All pins remain individual emojis (no clustering); detailed photo/label cards appear from zoom 16.8.
- GPS location button uses browser geolocation only with consent. It never uploads the visitor's location.
- Share pin links using `?pin=ID`, including deep-link navigation on load.
- Undo/redo up to 30 successful writes in the current tab session. Each action is persisted to Sheets and uses version checks; conflicting external edits will prevent unsafe rollback.
- Offline: service worker caches the site shell and some previously viewed OpenFreeMap assets (bounded to 180 resources), plus the last successful shared-pin snapshot in browser storage. **Offline does not guarantee a complete street map**. OpenStreetMap raster tiles are not predownloaded or cached for offline use.
- Google Sheets two-way bridge now includes **Icon** and **Color** in columns M and N. Deploy the updated `sheets-bridge.gs` to Apps Script and configure `config.js` with its public /exec URL. Until then, edits remain disabled; the GitHub Pages frontend cannot itself host a Sheets backend.

## Phase 1: reliability and recovery

The Apps Script bridge includes an append-only **Map Canvas History** tab,
recording before/after snapshots for every successful save and delete.
**Do not publicly share the Google Sheet**: history rows contain hashed edit
credentials. The public map's read endpoint never returns the history.

For owner recovery, back up the workbook, open the Apps Script editor, change
`OWNER_RECOVERY_ROW` to the history row number, run
`mapCanvasOwnerPreview` to inspect the event, then run
`mapCanvasOwnerRestore` to restore the previous state. Recovery refuses
to overwrite a newer pin revision.

Write throttling and per-key creation quotas were removed at the owner’s request. The backend still validates entries, checks edit keys and versions, and keeps audit history. Public anonymous writes can be spammed or exhaust Google Apps Script quotas.

**Not yet activated:** the Apps Script web app requires one-time owner
authorization and deployment. The connected Google Sheets integration
cannot publish an Apps Script web app. Until the deployment URL is added to
`config.js`, public editing and server-side recovery are unavailable.

## Canvas additions (November 2026)

The public map now includes nine more features:

- **Drag pins:** existing shared pins can be repositioned on MapLibre or Leaflet by the browser holding their original edit key. Save is verified against the shared sheet.
- **Movable pictures:** choose Picture from the canvas toolbar, tap the map and upload or paste an image. At close zoom, drag the image or use the lower-right handle to resize it. Uploaded images are highly compressed for Sheets.
- **Floating text:** choose Text and tap a location, then finish the entry editor to save. Pictures and text are geographically anchored. Previously saved line, arrow, and circle objects remain visible but cannot be newly created from the toolbar.
- **Bulk import/export:** CSV, JSON, GeoJSON (point features). Export the current filtered results as CSV, GeoJSON or JSON. Bulk import processes up to 25 pins per network request and verifies each group; the shared tab holds up to 500 pins.
- **Toggle layers and browse nested groups:** use sidebar layer checkboxes, layer filter, group path filter, and the editor's Layer / Group fields (for example `Travel/Hanoi/Cafes`). Hiding a parent group hides nested subgroups.
- **Shared live refresh:** when the Apps Script URL is configured, visible browsers check for remote changes every 20 seconds, with a refresh on tab activation. This is polling, not instantaneous websocket collaboration.
- **Photo galleries:** add up to 12 images per pin using HTTPS URLs, including up to 4 uploaded compressed small thumbnails; browse pictures in the detail panel.
- **Simplified canvas toolbar:** only Picture and Text remain. Line, Arrow, Circle and Measure are removed at the owner's request.

The bridge now stores Canvas metadata in Google Sheet column **O**. An existing deployment must be updated with the *current* `sheets-bridge.gs` code to support galleries, layers and bulk import; older deployments do not support these new fields. Public saving, image placement edits, and live collaboration remain inactive until the owner deploys the Apps Script web app and places its `/exec` URL into `config.js`.

There is no spam throttling, per the map owner's instruction; anonymous uploads and writes can be misused or exhaust the Google Apps Script quotas. The audit history continues to support owner-only recovery.

## Personal feature settings (November 2026)

The **gear button (Settings)** in the header opens switches for map display,
Picture/Text tools, GPS, search, layers, import/export, galleries,
automatic shared refresh and more. Changes apply immediately, are saved to
`localStorage` as `map-canvas:feature-settings-v1`, and are restored after a
reload or browser restart. **Restore defaults** turns every feature back on.
Disabled features are hidden and stopped in this browser; they are not removed
from shared map data. The controls are *preferences*, not permissions.

Settings are saved **per browser/device**, not to the shared Sheet, because the
site deliberately requires no account and the Sheets backend isn't activated.
Clearing browser site data or using private browsing removes the preferences.
Other visitors are unaffected. The auto-refresh switch affects background
polling, not a manual refresh. The clustering setting has been removed; pins always remain separate at every zoom.

## Individual thematic emoji pins

Nearby pins no longer cluster or merge into numbered bubbles. Each pin displays its own emoji at all zoom levels. Common categories and titles such as hostels 🏨, cafés ☕, restaurants 🍽️, gyms 🏋️, shopping 🛍️, parks 🌳, museums 🎨, and stations 🚆 map automatically to appropriate emojis. Unrecognized categories use 📍. A manually selected non-default pin emoji takes priority. The visual emoji markers are map-anchored, while underlying near-transparent native MapLibre features handle click and drag reliably; Leaflet uses emoji divIcon markers. The old clustering toggle was removed from Settings. Other collection filters and named folders remain unchanged.

## Simplified mobile canvas toolbar

Only **Picture** and **Text** remain as creation tools on the map. Line, Arrow, Circle and Measure buttons and the measuring controls were removed. The Settings dialog no longer advertises measurement; the Canvas editing tools switch controls Picture and Text together. Existing saved line, arrow and circle elements are retained and still render to avoid losing map data.

## Cache consistency fix

The canvas module now has a versioned URL in both the module import and the
offline service-worker cache. This prevents older iOS/Safari cached scripts from
trying to initialize buttons removed by a newer page. Online page assets are
fetched with `cache: "no-store"`, with offline fallback to the versioned shell.
The map also continues to initialize if a nonessential canvas feature throws.

## Selected-pin removal and dark mode

Selecting any pin now displays a removal action. For a user-owned shared pin
when the Sheets backend is connected, **Delete pin** deletes that entry from
the shared map (after confirmation). Built-in hostel pins and shared pins
without this browser's edit key use **Remove pin**, which hides them **only on
this browser**; the pin is still present for other visitors. Hidden IDs are
saved in `localStorage` under `map-canvas:hidden-pins-v1` and can be
restored with **Settings → Restore hidden pins**. This is deliberately
different from deleting someone else's shared content.

The header moon/sun control and **Settings → Dark theme** toggle the site's
color scheme. MapLibre's OpenFreeMap basemap uses the published OpenFreeMap dark
style; OpenStreetMap raster/fallback tiles are color-adjusted for night mode.
The setting is per browser, saved with the existing feature preferences,
and restored after refresh. No sign-in or Sheets connection is required.

## Shared deletion (replaces device-only hiding)

**Rebel Rooster Hostel (`hostel-4`) was removed from the public seed file.**
The UI no longer offers a device-only hide or a confirmation popup. The
selected-pin **Delete pin** action now requires an active shared Sheets
connection and applies to *everyone*. The backend records deleted IDs in a
**Map Canvas Deleted** tab (tombstones), including preset hostels, and
returns `deletedIds` in its public read endpoint. Shared entries are deleted
from the Map Canvas tab, with audit history, and deletions are confirmed by
a subsequent read before reporting success. Editing ownership keys are not
required for deletion: this deliberately makes it possible for anyone to
delete any public pin, so a malicious visitor could destroy public map content.
The owner should preserve backups. **Until the Apps Script web app is deployed
and configured in `config.js`, the Delete button is disabled**; a static
GitHub Pages site cannot accept shared writes by itself.

The seed removal is already live via GitHub Pages. The per-pin Delete action
for all other entries does not work yet because `config.js` has no Apps Script
deployment URL. Enabling it requires deploying the current
`sheets-bridge.gs` as a public web app, then setting that URL. The public
delete endpoint deliberately has no confirmation step or ownership check, so
**any visitor can erase any pin** once enabled. The change history remains
available for recovery of shared entries; hostel deletions are retained as
tombstones.
