#!/bin/bash
# Build the GPL scene engine from the corresponding source retained in ThirdParty.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/ThirdParty/WallpaperMachine"
CACHE="$ROOT/.build"
OUTPUT="$CACHE/scene-renderer"
mkdir -p "$OUTPUT"
SOURCE_HASH="$(python3 - "$SOURCE" "$0" <<'PY'
import hashlib,sys
from pathlib import Path
h=hashlib.sha256()
for p in sorted(Path(sys.argv[1]).rglob('*')):
 if p.is_file():h.update(str(p.relative_to(sys.argv[1])).encode());h.update(p.read_bytes())
h.update(Path(sys.argv[2]).read_bytes());print(h.hexdigest())
PY
)"
if [[ -f "$OUTPUT/source.sha256" && "$(cat "$OUTPUT/source.sha256")" == "$SOURCE_HASH" && -f "$OUTPUT/libOasisSceneRenderer.dylib" ]]; then
    lipo "$OUTPUT/libOasisSceneRenderer.dylib" -verify_arch arm64 x86_64
    exit 0
fi
CMAKE="${OASIS_CMAKE:-$(command -v cmake || true)}"
[[ -n "$CMAKE" ]] || CMAKE="$CACHE/scene-tools/python/cmake/data/bin/cmake"
CARGO="${OASIS_CARGO:-$(command -v cargo || true)}"
[[ -n "$CARGO" ]] || CARGO="$CACHE/scene-tools/rust/bin/cargo"
[[ -x "$CMAKE" && -x "$CARGO" ]] || { echo 'Scene renderer needs CMake 3.25+ and Rust with both macOS targets.' >&2; exit 1; }
export PATH="$(dirname "$CARGO"):$PATH"
export RUSTUP_HOME="${RUSTUP_HOME:-$CACHE/scene-tools/rustup}"
export CARGO_HOME="${CARGO_HOME:-$CACHE/scene-tools/cargo-home}"
export CARGO_TARGET_DIR="$CACHE/scene-cargo-target"
# Sources are fetched at pinned revisions and verified before extracting.
python3 - "$SOURCE/dependencies.json" "$CACHE/scene-dependencies" <<'PY'
import json,sys,hashlib,subprocess,tarfile,io,shutil
from pathlib import Path
base=Path(sys.argv[2]);base.mkdir(parents=True,exist_ok=True)
for row in json.loads(Path(sys.argv[1]).read_text()):
 target=base/row['name']
 if (target/'.oasis-extracted').is_file():continue
 if target.exists():shutil.rmtree(target)
 staging=base/(row['name']+'.extracting')
 if staging.exists():shutil.rmtree(staging)
 data=subprocess.check_output(['curl','--fail','--location','--proto','=https','--tlsv1.2','--retry','2',row['url']])
 if hashlib.sha256(data).hexdigest()!=row['sha256']:raise RuntimeError('Dependency checksum mismatch: '+row['name'])
 staging.mkdir()
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
  for member in archive.getmembers():
   parts=Path(member.name).parts[1:]
   if not parts:continue
   if '..' in parts or not(member.isfile() or member.isdir()):raise RuntimeError('Unsafe dependency archive')
   member.name=str(Path(*parts))
   if hasattr(tarfile,'data_filter'):archive.extract(member,staging,filter='data')
   else:archive.extract(member,staging)
 (staging/'.oasis-extracted').write_text(row['sha256'])
 staging.rename(target)
PY
for arch in arm64 x86_64; do
    target=aarch64-apple-darwin
    [[ "$arch" != x86_64 ]] || target=x86_64-apple-darwin
    prefix="$CACHE/scene-sdk-deps/$arch"
    for dep in json argparse quickjs lz4 freetype; do
        source="$CACHE/scene-dependencies/$dep"
        [[ "$dep" != lz4 ]] || source="$source/build/cmake"
        args=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="$arch" -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 -DCMAKE_INSTALL_PREFIX="$prefix" -DBUILD_SHARED_LIBS=OFF)
        case "$dep" in
          json) args+=(-DJSON_BuildTests=OFF) ;;
          argparse) args+=(-DARGPARSE_BUILD_TESTS=OFF -DARGPARSE_BUILD_SAMPLES=OFF) ;;
          quickjs) args+=(-DQJS_BUILD_EXAMPLES=OFF -DQJS_BUILD_CLI=OFF -DQJS_BUILD_TESTS=OFF) ;;
          lz4) args+=(-DLZ4_BUILD_CLI=OFF -DLZ4_BUILD_LEGACY_LZ4C=OFF) ;;
          freetype) args+=(-DFT_DISABLE_ZLIB=ON -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON) ;;
        esac
        "$CMAKE" -S "$source" -B "$CACHE/scene-dep-builds/$arch/$dep" "${args[@]}"
        "$CMAKE" --build "$CACHE/scene-dep-builds/$arch/$dep" --parallel 8
        "$CMAKE" --install "$CACHE/scene-dep-builds/$arch/$dep"
    done
    "$CARGO" build --manifest-path "$SOURCE/Renderer/Cargo.toml" -p wm-shader --features ffi --release --locked --target "$target"
    wrapper="$CACHE/scene-sdk-wrapper"
    mkdir -p "$wrapper"
    cp "$SOURCE/Oasis-CMakeLists.txt" "$wrapper/CMakeLists.txt"
    "$CMAKE" -S "$wrapper" -B "$CACHE/scene-sdk-build/$arch" \
       -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="$arch" -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 \
       -DCMAKE_PREFIX_PATH="$prefix" -DOASIS_ENGINE_SOURCE="$SOURCE/Renderer/Engine" \
       -DOASIS_RUST_SHADER="$CARGO_TARGET_DIR/$target/release/libwm_shader.a"
    "$CMAKE" --build "$CACHE/scene-sdk-build/$arch" --target OasisSceneRenderer --parallel 8
done
lipo -create "$CACHE/scene-sdk-build/arm64/libOasisSceneRenderer.dylib" "$CACHE/scene-sdk-build/x86_64/libOasisSceneRenderer.dylib" -output "$OUTPUT/libOasisSceneRenderer.dylib"
printf '%s\n' "$SOURCE_HASH" > "$OUTPUT/source.sha256"
