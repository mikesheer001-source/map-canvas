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
TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000


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


def migrate_pin(pin, origin, output, photos):
    if "photo" in pin:
        pin["photo"] = migrate_photo(pin["photo"], origin, output, photos)
    if "gallery" in pin:
        pin["gallery"] = [migrate_photo(value, origin, output, photos) for value in pin["gallery"]]
    for credit in pin.get("photoCredits", []):
        if "src" in credit:
            credit["src"] = migrate_photo(credit["src"], origin, output, photos)
    return pin


def sql_text(value):
    return "'" + value.replace("'", "''") + "'"


def append_value(sql, table, identity, value):
    # Keep statements below D1's SQL length limit even for multibyte text.
    for offset in range(0, len(value), 18000):
        chunk = sql_text(value[offset:offset + 18000])
        sql.append(f"UPDATE {table} SET value = value || {chunk} WHERE id = {identity};")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("new_origin")
    parser.add_argument("output", type=Path)
    parser.add_argument("--preview", action="store_true",
                        help="Rehearse from the public pins response without deletion history.")
    args = parser.parse_args()

    url = urlsplit(args.new_origin)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.path not in ("", "/") or url.query or url.fragment:
        parser.error("new_origin must be an HTTPS origin")
    origin = url.geturl().rstrip("/")
    if url.hostname.endswith(".chatgpt.site"):
        parser.error("new_origin must be independent of ChatGPT Sites")
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8-sig"))
    entries = snapshot["entries"]
    revision = snapshot["revision"]
    if not args.preview and not {"tombstones", "trash"} <= snapshot.keys():
        raise ValueError("The final import needs the source board tombstones and full trash rows.")
    tombstones = snapshot.get("tombstones", {})
    trash = snapshot.get("trash", [])
    if type(revision) is not int or revision < 1 or not isinstance(entries, list) or len(entries) > 500:
        raise ValueError("Invalid map snapshot")
    if not isinstance(tombstones, dict) or not isinstance(trash, list):
        raise ValueError("Invalid deletion history")
    if any(type(version) is not int or not 1 <= version <= revision for version in tombstones.values()):
        raise ValueError("Invalid tombstone version")
    ids = set()
    photos = {}
    args.output.mkdir(parents=True, exist_ok=False)
    for pin in entries:
        if not isinstance(pin["id"], str) or pin["id"] in ids or type(pin["version"]) is not int or not 1 <= pin["version"] <= revision:
            raise ValueError("Invalid pin identity or version")
        if not (-85 <= pin["lat"] <= 85 and -180 <= pin["lng"] <= 180):
            raise ValueError("Invalid pin coordinates")
        ids.add(pin["id"])
        migrate_pin(pin, origin, args.output, photos)
    value = json.dumps({"entries": entries, "tombstones": tombstones}, ensure_ascii=False, separators=(",", ":"))
    if len(value.encode()) > 1700000:
        raise ValueError("Map exceeds the shared-board size limit")
    sql = [f"INSERT INTO shared_map_board(id, revision, value) VALUES (1, {revision}, '');"]
    append_value(sql, "shared_map_board", "1", value)
    expected_trash = []
    for row in trash:
        pin = json.loads(row["value"])
        pin_id = row["id"]
        version = row["version"]
        deleted_at = row["deleted_at"]
        if (not isinstance(pin_id, str) or pin["id"] != pin_id or pin_id in ids
                or type(version) is not int or not 1 <= version <= revision
                or type(deleted_at) is not int or deleted_at < 0):
            raise ValueError("Invalid deleted pin")
        ids.add(pin_id)
        migrate_pin(pin, origin, args.output, photos)
        value = json.dumps(pin, ensure_ascii=False, separators=(",", ":"))
        identity = sql_text(pin_id)
        sql.append(f"INSERT INTO shared_map_trash(id, value, version, deleted_at) VALUES ({identity}, '', {version}, {deleted_at});")
        append_value(sql, "shared_map_trash", identity, value)
        expected_trash.append({
            "id": pin_id, "title": pin["title"], "version": version,
            "deletedAt": deleted_at, "expiresAt": deleted_at + TRASH_RETENTION_MS,
        })
    expected_trash.sort(key=lambda pin: (-pin["deletedAt"], pin["id"]))
    (args.output / "import.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    (args.output / "photos.json").write_text(json.dumps(photos, indent=2) + "\n", encoding="utf-8")
    (args.output / "expected.json").write_text(
        json.dumps({"entries": entries, "revision": revision}, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (args.output / "expected-trash.json").write_text(json.dumps(expected_trash, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Prepared {len(entries)} pins, {len(trash)} archived pins and {len(photos)} photos at revision {revision}.")


if __name__ == "__main__":
    main()
