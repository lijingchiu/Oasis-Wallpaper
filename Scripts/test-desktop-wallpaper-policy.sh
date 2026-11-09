#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
QA="$(mktemp -d "${TMPDIR:-/tmp}/oasis-desktop-policy.XXXXXX")"
trap 'rm -rf "$QA"' EXIT
printf '%s\n' 'enum OasisSceneRendererIdentity { static let sha256 = "" }' > "$QA/renderer.swift"
swiftc -parse-as-library -module-cache-path "${TMPDIR:-/tmp}/mole-gui-swift-module-cache/$(uname -m)" \
 Tests/desktop-wallpaper-policy.swift App/Contents/Resources/OasisDesktopOwnership.swift App/Contents/Resources/OasisDesktopWallpapers.swift \
 App/Contents/Resources/OasisNativeWebWallpapers.swift App/Contents/Resources/OasisNativeScenes.swift "$QA/renderer.swift" \
 -framework Cocoa -framework WebKit -framework CoreImage -framework QuartzCore -framework Metal \
 -framework Security -framework IOKit -framework ApplicationServices -framework CoreAudio -o "$QA/policy"
"$QA/policy"
