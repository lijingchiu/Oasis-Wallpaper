#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/App/Contents/Resources/OasisWindows"
dest="${1:?Supply app Resources directory}/OasisWindows"
mkdir -p "$dest"
cp "$src/"*.mjs "$src/wallpaper.sb" "$dest/"
clang -arch x86_64 -mmacosx-version-min=12.0 -O2 -dynamiclib -install_name @loader_path/libOasisWallpaperAudio.dylib -framework AudioToolbox -framework CoreAudio "$src/audio.c" -o "$dest/libOasisWallpaperAudio.dylib"
codesign --force --timestamp=none --sign "${MOLE_SIGNING_IDENTITY:--}" "$dest/libOasisWallpaperAudio.dylib"
clang -arch x86_64 -mmacosx-version-min=12.0 -O2 -fobjc-arc -Wl,-no_pie -Wl,-pagezero_size,0x1000 -Wl,-segaddr,WINE_RESERVE,0x1000 -Wl,-segaddr,__TEXT,0x200000000 -Wl,-export_dynamic -framework Cocoa -framework CoreGraphics "$src/host.m" "$dest/libOasisWallpaperAudio.dylib" -o "$dest/OasisWinHost"
codesign --force --timestamp=none --sign "${MOLE_SIGNING_IDENTITY:--}" "$dest/OasisWinHost"
