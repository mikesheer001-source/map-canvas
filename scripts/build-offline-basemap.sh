#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

build_dir=${MAP_CANVAS_BUILD_DIR:-$(mktemp -d)}
mkdir -p "$build_dir"
build_dir="$(cd "$build_dir" && pwd)"
if [[ -z ${MAP_CANVAS_BUILD_DIR:-} ]]; then trap 'rm -rf "$build_dir"' EXIT; fi
archive_date=${MAP_CANVAS_BASEMAP_DATE:-20261114}
pmtiles_version=1.31.2
archive=go-pmtiles_${pmtiles_version}_Linux_x86_64.tar.gz
archive_sha=3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f
download() {
  curl --silent --show-error --fail --location --retry 2 --connect-timeout 12 --max-time 60 "$1" --output "$2"
}

mkdir -p vendor data/offline
if [[ ! -x "$build_dir/bin/pmtiles" ]]; then
  mkdir -p "$build_dir/bin"
  download "https://github.com/protomaps/go-pmtiles/releases/download/v${pmtiles_version}/$archive" "$build_dir/$archive"
  printf '%s  %s\n' "$archive_sha" "$build_dir/$archive" | sha256sum --check
  tar -xzf "$build_dir/$archive" -C "$build_dir/bin" pmtiles
fi
if [[ ! -s data/offline/hanoi.pmtiles || ${MAP_CANVAS_REFRESH_BASEMAP:-0} = 1 ]]; then
  # Public city coverage. The build uses no user coordinates or shared map content.
  "$build_dir/bin/pmtiles" extract "https://build.protomaps.com/$archive_date.pmtiles" \
    data/offline/hanoi.pmtiles --bbox=105.74,20.93,106.01,21.16 --maxzoom=15 --download-threads=4
fi
"$build_dir/bin/pmtiles" verify data/offline/hanoi.pmtiles
"$build_dir/bin/pmtiles" show data/offline/hanoi.pmtiles --header-json > "$build_dir/header.json"

npm install --prefix "$build_dir/npm" --ignore-scripts --no-audit --no-fund \
  pmtiles@4.5.0 @protomaps/basemaps@5.7.2 esbuild@0.27.3
"$build_dir/npm/node_modules/.bin/esbuild" "$build_dir/npm/node_modules/pmtiles/dist/esm/index.js" \
  --bundle --minify --format=esm --legal-comments=inline --outfile=vendor/pmtiles.mjs

node --input-type=module - "$build_dir" "$archive_date" <<'JS'
import {readFileSync,statSync,writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const [buildDir,date] = process.argv.slice(2);
const {layers,namedFlavor} = await import(pathToFileURL(buildDir+"/npm/node_modules/@protomaps/basemaps/dist/esm/index.js"));
const header = JSON.parse(readFileSync(buildDir+"/header.json","utf8"));
const base = "./data/offline/";
const attribution = '<a href="https://protomaps.com/">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const assets = [];
for (const flavor of ["light","dark"]) {
  const sprite = base+"sprites/"+flavor;
  const path = base+(flavor==="light" ? "style.json" : "style-dark.json");
  writeFileSync(path, JSON.stringify({
    version:8,
    glyphs:base+"fonts/{fontstack}/{range}.pbf",
    sprite,
    sources:{hanoi:{type:"vector",url:"pmtiles://hanoi",bounds:header.bounds,attribution}},
    layers:layers("hanoi",namedFlavor(flavor),{lang:"vi"})
  })+"\n");
  if (flavor==="dark") assets.push(path);
  for (const suffix of [".png",".json","@2x.png","@2x.json"]) assets.push(sprite+suffix);
}
for (const font of ["Noto Sans Regular","Noto Sans Medium","Noto Sans Italic"]) {
  for (const start of [0,256,512,768,7680,8192,8448]) {
    assets.push(base+"fonts/"+font+"/"+start+"-"+(start+255)+".pbf");
  }
}
writeFileSync(base+"manifest.json",JSON.stringify({
  version:1,
  sourceDate:date,
  bounds:header.bounds,
  minzoom:header.minzoom,
  maxzoom:header.maxzoom,
  bytes:statSync(base+"hanoi.pmtiles").size,
  attribution,
  assets
},null,2)+"\n");
JS

python3 - <<'PY'
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import subprocess
from urllib.parse import quote

sources = []
base = Path("data/offline")
for asset in json.loads((base / "manifest.json").read_text())["assets"]:
    path = Path(asset)
    relative = path.relative_to(base).as_posix()
    if relative.startswith("style"):
        continue
    if relative.startswith("sprites/"):
        relative = relative.replace("sprites/", "sprites/v4/", 1)
    sources.append((path, "https://protomaps.github.io/basemaps-assets/" + quote(relative, safe="/@")))
for filename in ("maplibre-gl.mjs", "maplibre-gl-worker.mjs", "maplibre-gl.css"):
    sources.append((Path("vendor") / filename, "https://unpkg.com/maplibre-gl@6.18.0/dist/" + filename))
sources.append((Path("vendor/maplibre-gl.LICENSE.txt"), "https://unpkg.com/maplibre-gl@6.18.0/LICENSE.txt"))
sources.append((Path("vendor/pmtiles.LICENSE.txt"), "https://raw.githubusercontent.com/protomaps/PMTiles/main/LICENSE"))
sources.append((Path("vendor/fflate.LICENSE.txt"), "https://unpkg.com/fflate@0.8.2/LICENSE"))

def download(source):
    path, url = source
    if path.is_file() and path.stat().st_size:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    subprocess.run(["curl", "-fsSL", "--retry", "2", "--connect-timeout", "12",
                    "--max-time", "45", url, "-o", str(temp)], check=True)
    temp.replace(path)

with ThreadPoolExecutor(max_workers=8) as executor:
    list(executor.map(download, sources))
PY
