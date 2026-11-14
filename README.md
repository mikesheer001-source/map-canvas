# Map Canvas — public map with manual Google Sheets import/export

Live website: https://mikesheer001-source.github.io/map-canvas/

No Google Sheets connection, Apps Script, API key or visitor sign-in is needed.
The public map is hosted on GitHub Pages and works as a static website.

## Google Sheets workflow

1. Click **Export** and choose **CSV (Sheets)**. The downloaded CSV includes
   pin IDs, titles, coordinates, descriptions, categories, picture links,
   gallery data, layers, groups and other properties.
2. Edit the CSV in Google Sheets using **File → Import → Upload**.
3. Choose **File → Download → Comma Separated Values (.csv)** in Google Sheets.
   Back on the map, choose **Import**, select the CSV, and use **Merge**
   (update matching IDs and add new pins) or **Replace** (replace all pins).
4. **Export → JSON (site)** saves a complete map backup, including deletions.
   You can also import/export GeoJSON.

## How saving and publishing differ

Adding, editing, dragging and deleting pins now **works without a backend**.
Every change automatically saves in browser localStorage and survives refreshes
on that device. Undo and redo work locally.

**Important:** Browser edits cannot automatically update everybody's public
map without a server or an authenticated publish operation. To make changes
visible across all devices, **export JSON and replace
`data/public-map.json` in this GitHub repository**, then commit the file.
This publishes the complete edited map through GitHub Pages. It can also be
done by asking ChatGPT to update the GitHub file from the exported data.

Visitors without local edits receive the updated public dataset. Visitors
with a saved local copy can choose **Settings → Reset to published map** to
discard local changes and adopt the newest published map. Back up with
Export JSON first. Clearing browser site storage can erase unexported edits.

No confirmation popup appears for ordinary pin deletion. A confirmation
remains for the destructive **Reset to published map** operation.

## Features

- Individual category-matched emoji pins, with 📍 as the default
- Pin selection, edit/delete, and existing picture/text map objects
- Dragging and resizing pins, images and text
- Import/export CSV for Google Sheets, JSON and GeoJSON
- Persistent per-browser map data, undo/redo and dark-mode settings
- Layers, groups, search, galleries, GPS and pin deep links
- OpenFreeMap and OpenStreetMap basemaps, offline shell and cached resources

## Testing

GitHub Actions runs Node tests and Chromium/WebKit automated browser checks.

## Floating toolbar removed

The lower Picture/Text toolbar and its background panel were removed, along with the unused settings toggle. Existing map photos and text are preserved. Use **Add to map** to create pins and the pin editor to attach photos and notes.
