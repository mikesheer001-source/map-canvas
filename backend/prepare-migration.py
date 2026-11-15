"""Prepare a fresh D1 import and verified R2 objects from a shared-map export."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
from urllib.request import urlopen

OLD_HOST = "map-canvas.mikesheer001.chatgpt.site"
PHOTO_PATH = re.compile(r"/api/shared-map/photo/([a-f0-9]{64})")
PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_PHOTO_BYTES = 5 * 1024 * 1024


def migrate_photo(value, origin, output, photos):
    if not value:
        return value
    url = urlsplit(value)
    if url.hostname != OLD_HOST:
        return value
    match = PHOTO_PATH.fullmatch(url.path)
    if not match or url.scheme != "https":
        raise ValueError("Unexpected ChatGPT-hosted photo URL")
    digest = match[1]
    if digest not in photos:
        with urlopen(f"https://{OLD_HOST}{url.path}", timeout=30) as response:
            content = response.read(MAX_PHOTO_BYTES + 1)
            content_type = response.headers.get_content_type()
        if (len(content) > MAX_PHOTO_BYTES or content_type not in PHOTO_TYPES
                or hashlib.sha256(content).hexdigest() != digest):
            raise ValueError(f"Could not verify source photo {digest}")
        (output / digest).write_bytes(content)
        photos[digest] = content_type
    return origin + url.path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("new_origin")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    url = urlsplit(args.new_origin)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
        parser.error("new_origin must be an HTTPS origin")
    origin = url.geturl().rstrip("/")
    if url.hostname.endswith(".chatgpt.site"):
        parser.error("new_origin must be independent of ChatGPT Sites")
    snapshot = json.loads(args.snapshot.read_text())
    entries = snapshot["entries"]
    revision = snapshot["revision"]
    if type(revision) is not int or revision < 1 or not isinstance(entries, list) or len(entries) > 500:
        raise ValueError("Invalid map snapshot")
    ids = set()
    photos = {}
    args.output.mkdir(parents=True, exist_ok=False)
    for pin in entries:
        if not isinstance(pin["id"], str) or pin["id"] in ids or type(pin["version"]) is not int or not 1 <= pin["version"] <= revision:
            raise ValueError("Invalid pin identity or version")
        if not (-85 <= pin["lat"] <= 85 and -180 <= pin["lng"] <= 180):
            raise ValueError("Invalid pin coordinates")
        ids.add(pin["id"])
        if "photo" in pin:
            pin["photo"] = migrate_photo(pin["photo"], origin, args.output, photos)
        if "gallery" in pin:
            pin["gallery"] = [migrate_photo(value, origin, args.output, photos) for value in pin["gallery"]]
    value = json.dumps({"entries": entries, "tombstones": {}}, ensure_ascii=False, separators=(",", ":"))
    if len(value.encode()) > 1700000:
        raise ValueError("Map exceeds the shared-board size limit")
    escaped = value.replace("'", "''")
    (args.output / "import.sql").write_text(
        f"INSERT INTO shared_map_board(id, revision, value) VALUES (1, {revision}, '{escaped}');\n",
        encoding="utf-8",
    )
    (args.output / "photos.json").write_text(json.dumps(photos, indent=2) + "\n")
    (args.output / "expected.json").write_text(json.dumps(snapshot, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Prepared {len(entries)} pins and {len(photos)} uploaded photos at revision {revision}.")


if __name__ == "__main__":
    main()
