# Hanoi offline basemap

The site stores one copy of this Hanoi street basemap per device. Each saved area has its own local snapshot of pins, notes, and available photos. The basemap contains public map data and is independent of the shared pin service.

The basemap covers central Hanoi (105.74°E to 106.01°E, 20.93°N to 21.16°N) and supplies vector tiles up to zoom 15. The interface can zoom in further using those tiles.

## Attribution

Basemap [Protomaps](https://protomaps.com), with data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). The archive is an unmodified regional subset of the [Protomaps November 14, 2026 daily build](https://maps.protomaps.com/builds/).

MapLibre GL JS, PMTiles and fflate license texts are in `vendor/`. Map styles, glyphs and sprites are from [Protomaps Basemaps](https://docs.protomaps.com/basemaps/maplibre) and [Basemaps Assets](https://github.com/protomaps/basemaps-assets).

To rebuild on Linux x86-64 with Node.js and Python 3, run `bash scripts/build-offline-basemap.sh`. To refresh the archive, set `MAP_CANVAS_REFRESH_BASEMAP=1` and `MAP_CANVAS_BASEMAP_DATE` to an available daily build date (`YYYYMMDD`).
