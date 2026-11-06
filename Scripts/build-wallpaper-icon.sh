#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/Wallpaper/Resources/OasisWallpaperIcon.png"
OUTPUT="${1:?Supply the output .icns path}"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/oasis-wallpaper-icon.XXXXXXXX")"
trap 'rm -rf "$TEMP"' EXIT
ICONSET="$TEMP/OasisWallpaper.iconset"
mkdir "$ICONSET"

# Let macOS encode the small Finder representations as well as the Retina ones.
for points in 16 32 128 256 512; do
    name="icon_${points}x${points}"
    retina=$((points * 2))
    /usr/bin/sips -s format png -z "$points" "$points" "$SOURCE" --out "$ICONSET/$name.png" >/dev/null
    /usr/bin/sips -s format png -z "$retina" "$retina" "$SOURCE" --out "$ICONSET/$name@2x.png" >/dev/null
done
/usr/bin/iconutil -c icns "$ICONSET" -o "$TEMP/OasisWallpaper.icns"
mv "$TEMP/OasisWallpaper.icns" "$OUTPUT"
