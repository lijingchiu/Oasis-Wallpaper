#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:?Supply the app Resources directory}/OasisArchive"
SOURCE="$ROOT/App/Contents/Resources/OasisArchive"
MANIFEST="$ROOT/ThirdParty/OasisSpineMesh/Cargo.toml"
CARGO="${OASIS_CARGO:-$(command -v cargo || true)}"
if [[ -z "$CARGO" && -x "$ROOT/.build/scene-tools/rust/bin/cargo" ]]; then
 CARGO="$ROOT/.build/scene-tools/rust/bin/cargo"
 export RUSTUP_HOME="${RUSTUP_HOME:-$ROOT/.build/scene-tools/rustup}" CARGO_HOME="${CARGO_HOME:-$ROOT/.build/scene-tools/cargo-home}"
fi
[[ -x "$CARGO" ]] || { echo 'Install Rust with the wasm32-unknown-unknown target to build the wallpaper importer.' >&2; exit 1; }
export PATH="$(dirname "$CARGO"):$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.build/wallpaper-archive}"
mkdir -p "$DEST" "$DEST/licenses"
cp "$SOURCE/"*.mjs "$SOURCE/"*.html "$SOURCE/"*.css "$SOURCE/package.json" "$SOURCE/package-lock.json" "$DEST/"
npm ci --prefix "$DEST" --include=dev --ignore-scripts --no-audit --no-fund
"$DEST/node_modules/.bin/esbuild" "$DEST/sound-source.mjs" --bundle --format=iife --platform=browser --target=safari16 --outfile="$DEST/sound-worker.js"
npm prune --prefix "$DEST" --omit=dev --ignore-scripts --no-audit --no-fund
build_log="$(mktemp "${TMPDIR:-/tmp}/oasis-mesh.XXXXXX")"
trap 'rm -f "$build_log"' EXIT
"$CARGO" build --locked --manifest-path "$MANIFEST" --release --target wasm32-unknown-unknown --message-format=json-render-diagnostics > "$build_log"
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/oasis_wallpaper_mesh.wasm" "$DEST/mesh.wasm"
python3 - "$build_log" "$DEST/licenses" <<'PY'
import json, shutil, sys
from pathlib import Path
out=Path(sys.argv[2])
for line in Path(sys.argv[1]).read_text().splitlines():
    artifact=json.loads(line)
    if artifact.get('reason')!='compiler-artifact' or not artifact['package_id'].startswith('registry+'):
        continue
    package=Path(artifact['manifest_path']).parent
    for notice in package.iterdir():
        if notice.is_file() and notice.name.upper().startswith(('LICENSE','COPYING','NOTICE')):
            shutil.copyfile(notice,out/(package.name+'-'+notice.name))
PY
