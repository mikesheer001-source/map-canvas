# Map Canvas

A public, shared map for places, notes and photos. Open https://mikesheer001-source.github.io/map-canvas/ to use it without signing in.

Pin additions, edits, moves, deletions and photo uploads save to the shared map and appear on other devices. The Undo and Redo buttons reverse recent changes from the current browser session. If someone else edits the same pin, refresh and review it before retrying.

## Google Sheets and backups

Export **CSV (Sheets)** and use **File → Import → Upload** in Google Sheets. After editing, download the sheet as CSV and import it back on the map. **Merge** adds entries and updates matching IDs. **Replace** replaces the shared map after confirmation. Export **JSON (site)** for a full backup, or use GeoJSON for compatible mapping tools.

A browser with edits from the previous local-only version can download its old snapshot in **Settings → Download previous browser edits**. Review the snapshot before importing it with Merge. It contains the full older map and may overwrite newer changes or restore pins deleted since then.

## Availability

The GitHub Pages frontend connects to the shared map service at `https://map-canvas.mikesheer001.chatgpt.site/api/shared-map`. If the service is unavailable, the last loaded snapshot stays visible and editing resumes after the connection returns. Existing browser-only feature and theme settings remain on that browser.

## Testing

GitHub Actions runs Node tests and Chromium/WebKit browser checks.
