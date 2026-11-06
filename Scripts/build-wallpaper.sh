#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCES="$ROOT/App/Contents/Resources"
OUTPUT="${1:-$ROOT/dist-wallpaper}"
APP="$OUTPUT/Oasis Wallpaper.app"
TARGET_ARCH="${OASIS_WALLPAPER_ARCH:-universal}"
SIGNING_IDENTITY="${MOLE_SIGNING_IDENTITY:--}"
NODE_VERSION="v22.23.3"
NODE_CACHE="$ROOT/.build/node-cache"
MODULE_CACHE="${TMPDIR:-/tmp}/oasis-wallpaper-swift-module-cache"
case "$TARGET_ARCH" in universal) ARCHES=(arm64 x86_64);; arm64|x86_64) ARCHES=("$TARGET_ARCH");; *) echo "Unsupported architecture: $TARGET_ARCH" >&2;exit 1;; esac
command -v swiftc >/dev/null || { echo 'Install Xcode Command Line Tools first.' >&2;exit 1; }
[[ ! -e "$APP" ]] || { echo "Output already exists: $APP" >&2;exit 1; }
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Licenses" "$NODE_CACHE" "$ROOT/.build/wallpaper-native"
cp "$ROOT/Wallpaper/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/Wallpaper/Resources/"* "$APP/Contents/Resources/"
for name in OasisWeather.mjs OasisWeatherImages.mjs OasisWeatherUpload.mjs OasisWeatherMediaHttp.mjs OasisSteamWorkshop.mjs OasisCityScenery.mjs OasisWallpaperFiles.mjs MoleRequestPolicy.mjs OasisWeatherUI.js OasisWeatherScene.js OasisWeatherLandscapes.js OasisWallpaperProperties.js OasisWallpaperHealth.js OasisWorkshopBrowser.js OasisWorkshopBrowser.css OasisDesktopWallpaper.html OasisDesktopWallpaper.js OasisWeather.css OasisControls.css MoleGlass.css MoleTheme.css MoleTheme.js OasisWeatherAtlas.png OasisWeatherCloudsHD.png OasisWordmark.png Oasis.icns MoleLocalization.json; do cp "$RESOURCES/$name" "$APP/Contents/Resources/";done
cp "$ROOT/Wallpaper/Resources/OasisWallpaper.icns" "$APP/Contents/Resources/Oasis.icns"
cp "$RESOURCES/"OasisWorkshop*.mjs "$APP/Contents/Resources/"
cp -R "$RESOURCES/WeatherScenes" "$APP/Contents/Resources/"
bash "$ROOT/Scripts/build-workshop-helper.sh"
for arch in arm64 x64;do
 mkdir -p "$APP/Contents/Resources/WorkshopHelper/$arch"
 cp "$ROOT/.build/workshop-helper/$arch/DepotDownloader" "$APP/Contents/Resources/WorkshopHelper/$arch/DepotDownloader"
 chmod 755 "$APP/Contents/Resources/WorkshopHelper/$arch/DepotDownloader"
 codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" "$APP/Contents/Resources/WorkshopHelper/$arch/DepotDownloader"
done
cp "$ROOT/ThirdParty/DepotDownloader/LICENSE" "$APP/Contents/Resources/Licenses/DepotDownloader-GPL-2.0.txt"
cp "$ROOT/ThirdParty/DepotDownloader/OASIS-MODIFICATIONS.md" "$APP/Contents/Resources/Licenses/Workshop-helper-source.md"
cp "$ROOT/ThirdParty/WallpaperMachine/LICENSE" "$APP/Contents/Resources/Licenses/WallpaperMachine-LICENSE.txt"
cp "$ROOT/ThirdParty/WallpaperMachine/OASIS-MODIFICATIONS.md" "$APP/Contents/Resources/Licenses/WallpaperMachine-SOURCE.md"
cp "$ROOT/ThirdParty/Nodejs-NOTICE.md" "$APP/Contents/Resources/Licenses/Nodejs-NOTICE.md"
bash "$ROOT/Scripts/build-scene-renderer.sh"
mkdir -p "$APP/Contents/Resources/SceneRenderer"
cp "$ROOT/.build/scene-renderer/libOasisSceneRenderer.dylib" "$APP/Contents/Resources/SceneRenderer/"
codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" "$APP/Contents/Resources/SceneRenderer/libOasisSceneRenderer.dylib"
python3 - "$APP/Contents/Resources/SceneRenderer/libOasisSceneRenderer.dylib" "$ROOT/.build/wallpaper-native/OasisSceneRendererIdentity.swift" <<'PY'
import hashlib,json,sys
from pathlib import Path
binary,identity=map(Path,sys.argv[1:]);digest=hashlib.sha256(binary.read_bytes()).hexdigest()
binary.with_name('manifest.json').write_text(json.dumps({'sha256':digest}))
identity.write_text('enum OasisSceneRendererIdentity { static let sha256 = "'+digest+'" }\n')
PY
NATIVE_BINARIES=();NODE_BINARIES=()
for arch in "${ARCHES[@]}";do
 node_arch="$arch";[[ "$arch" != x86_64 ]] || node_arch=x64
 package="node-$NODE_VERSION-darwin-$node_arch";archive="$package.tar.gz"
 expected="$(awk -v name="$archive" '$2 == name { print $1 }' "$ROOT/Scripts/node-runtime.sha256")"
 [[ ${#expected} -eq 64 ]] || { echo "Missing runtime checksum: $archive" >&2;exit 1; }
 if [[ ! -f "$NODE_CACHE/$archive" ]];then curl --fail --show-error --location --proto '=https' --tlsv1.2 --retry 2 "https://nodejs.org/dist/$NODE_VERSION/$archive" -o "$NODE_CACHE/$archive.part";mv "$NODE_CACHE/$archive.part" "$NODE_CACHE/$archive";fi
 [[ "$(shasum -a 256 "$NODE_CACHE/$archive" | awk '{print $1}')" == "$expected" ]] || { echo "Runtime checksum mismatch: $archive" >&2;exit 1; }
 tar -xzf "$NODE_CACHE/$archive" -C "$NODE_CACHE" "$package/bin/node" "$package/LICENSE"
 NODE_BINARIES+=("$NODE_CACHE/$package/bin/node");cp "$NODE_CACHE/$package/LICENSE" "$APP/Contents/Resources/Licenses/Node-LICENSE.txt"
 swiftc -parse-as-library -module-cache-path "$MODULE_CACHE/$arch" -O -target "$arch-apple-macosx13.0" \
  -framework Cocoa -framework WebKit -framework Metal -framework QuartzCore -framework AVFoundation -framework CoreImage -framework CoreAudio -framework CoreLocation -framework ApplicationServices -framework IOKit -framework ServiceManagement -framework Security \
  "$ROOT/Wallpaper/OasisWallpaperApp.swift" "$ROOT/Wallpaper/OasisWallpaperUpdater.swift" "$ROOT/Wallpaper/OasisWallpaperUpdateInstall.swift" "$RESOURCES/OasisUpdaterCore.swift" "$ROOT/Wallpaper/OasisWallpaperClone.swift" "$ROOT/Wallpaper/OasisWallpaperWindowChrome.swift" "$RESOURCES/MoleWindowDragging.swift" "$RESOURCES/OasisDesktopOwnership.swift" "$RESOURCES/OasisDesktopWallpapers.swift" "$RESOURCES/OasisNativeScenes.swift" "$RESOURCES/OasisNativeWebWallpapers.swift" "$RESOURCES/OasisWeatherMedia.swift" "$RESOURCES/OasisWeatherLocation.swift" "$RESOURCES/OasisWorkshopCredentials.swift" "$RESOURCES/MoleLanguage.swift" "$RESOURCES/MoleLoginAtStartup.swift" "$ROOT/.build/wallpaper-native/OasisSceneRendererIdentity.swift" -o "$ROOT/.build/wallpaper-native/Oasis-$arch"
 NATIVE_BINARIES+=("$ROOT/.build/wallpaper-native/Oasis-$arch")
done
if [[ "$TARGET_ARCH" == universal ]];then lipo -create "${NATIVE_BINARIES[@]}" -output "$APP/Contents/MacOS/Oasis";lipo -create "${NODE_BINARIES[@]}" -output "$APP/Contents/MacOS/node";else cp "${NATIVE_BINARIES[0]}" "$APP/Contents/MacOS/Oasis";cp "${NODE_BINARIES[0]}" "$APP/Contents/MacOS/node";fi
chmod 755 "$APP/Contents/MacOS/Oasis" "$APP/Contents/MacOS/node"
SIGNING=(--force --options runtime --timestamp=none --sign "$SIGNING_IDENTITY")
if [[ "$SIGNING_IDENTITY" == "Developer ID Application:"* || -n "${MOLE_NOTARY_PROFILE:-}" ]];then SIGNING=(--force --options runtime --timestamp --sign "$SIGNING_IDENTITY");fi
codesign "${SIGNING[@]}" --entitlements "$ROOT/Scripts/node-entitlements.plist" "$APP/Contents/MacOS/node"
python3 "$ROOT/Scripts/prepare-app-entitlements.py" "$ROOT/Scripts/app-entitlements.plist" "$SIGNING_IDENTITY" "$ROOT/.build/wallpaper-native/app-entitlements.plist"
codesign "${SIGNING[@]}" --entitlements "$ROOT/.build/wallpaper-native/app-entitlements.plist" "$APP"
codesign --verify --deep --strict "$APP"
echo "Built standalone $APP ($TARGET_ARCH)"
