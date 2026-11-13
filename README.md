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

**Important:** This setup makes map entries publicly readable and permits anonymous contributions on your behalf. Never store private or sensitive information in these tabs. Contributors may edit/delete **their own entries on the same browser** using a per-entry random edit key; there is no sign-in. Basic hourly write limiting helps reduce abuse but cannot completely prevent spam.

Photos can be uploaded/pasted as compressed thumbnails (small enough to store in a Sheets cell) or supplied as a public HTTPS image URL. Photo uploads in this version are not stored in GitHub, and Google Drive image storage is not automatically provisioned.

## Map controls

- **OpenFreeMap**: MapLibre vector map with OpenFreeMap Liberty style.
- **OpenStreetMap**: raster street tiles rendered by MapLibre.
- An OpenStreetMap/Leaflet fallback is attempted if MapLibre cannot initialize.
- Pins show as dots until zoom level **16.8**; labels, prices, ratings, and photo thumbnails appear above that threshold.
- Shared data is visible on one public URL, independent of devices. No login is needed to view or contribute after the Sheets bridge is deployed.
- Data from the source hostel sheet is a snapshot until the bridge is connected, after which the site refreshes it from the workbook.
- Because Google Sheets is a simple backend, this public collaboration setup does not provide large-file media storage, user accounts, or rich multiuser conflict resolution.

## Technology

Vanilla JavaScript, HTML, CSS, [MapLibre GL JS](https://maplibre.org/), [OpenFreeMap](https://openfreemap.org/), OpenStreetMap tiles, and optional Google Apps Script / Google Sheets. No build step, API key, or account required to view.

## Pin tracking and testing (November 2026)

Previously, custom HTML pin dots could shift independently of the map while zooming or panning, and a CSS rule overrode MapLibre marker positioning. This was corrected by rendering all pin dots as native MapLibre GeoJSON circle layers (and native Leaflet circle markers in fallback mode); HTML note/photo cards are shown only at close zoom and hidden while the map is moving. Switching base styles restores the native pin layers.

Automated regression checks: `node tests/pin-regression.test.mjs`. A GitHub Actions workflow also runs Playwright tests in Chromium and WebKit, checking 45 map-coordinate projections per engine across zoom, pan, style toggles and mobile-size viewports, plus real pointer drags. Four screenshots are uploaded as workflow artifacts for visual review. These tests represent browser engine coverage, not a physical iPhone test.

## New map features (November 2026)

- Search by title, category, notes, price or rating; filter by type and category; sort by price/rating/title.
- Custom icon and hex color on new public entries. MapLibre-native clustering groups nearby pins at low zoom, expanding on click; detailed photo/label cards appear from zoom 16.8.
- GPS location button uses browser geolocation only with consent. It never uploads the visitor's location.
- Share pin links using `?pin=ID`, including deep-link navigation on load.
- Undo/redo up to 30 successful writes in the current tab session. Each action is persisted to Sheets and uses version checks; conflicting external edits will prevent unsafe rollback.
- Offline: service worker caches the site shell and some previously viewed OpenFreeMap assets (bounded to 180 resources), plus the last successful shared-pin snapshot in browser storage. **Offline does not guarantee a complete street map**. OpenStreetMap raster tiles are not predownloaded or cached for offline use.
- Google Sheets two-way bridge now includes **Icon** and **Color** in columns M and N. Deploy the updated `sheets-bridge.gs` to Apps Script and configure `config.js` with its public /exec URL. Until then, edits remain disabled; the GitHub Pages frontend cannot itself host a Sheets backend.
