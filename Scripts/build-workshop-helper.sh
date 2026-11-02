#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/ThirdParty/DepotDownloader/DepotDownloader/DepotDownloader.csproj"
OUTPUT="$ROOT/.build/workshop-helper"
mkdir -p "$OUTPUT"
SOURCE_HASH="$(python3 - "$ROOT/ThirdParty/DepotDownloader" <<'PY'
from pathlib import Path
import hashlib,sys
root=Path(sys.argv[1]);result=hashlib.sha256()
for path in sorted(root.rglob('*')):
    if not path.is_file() or any(part in ('bin','obj') for part in path.relative_to(root).parts):continue
    result.update(str(path.relative_to(root)).encode());result.update(path.read_bytes())
print(result.hexdigest())
PY
)"
if [[ -f "$OUTPUT/source.sha256" && "$(cat "$OUTPUT/source.sha256")" == "$SOURCE_HASH" && -f "$OUTPUT/arm64/DepotDownloader" && -f "$OUTPUT/x64/DepotDownloader" ]]; then
    exit 0
fi
export NUGET_PACKAGES="$ROOT/.build/nuget/packages"
export NUGET_HTTP_CACHE_PATH="$ROOT/.build/nuget/http-cache"
export DOTNET_CLI_HOME="$ROOT/.build/dotnet-cli"
for ARCH in arm64 x64; do
    dotnet publish "$PROJECT" --configuration Release --runtime "osx-$ARCH" \
        --self-contained true -p:PublishSingleFile=true \
        -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true \
        -p:DebugType=None -p:DebugSymbols=false --artifacts-path "$OUTPUT/artifacts" --output "$OUTPUT/$ARCH"
done
printf '%s\n' "$SOURCE_HASH" > "$OUTPUT/source.sha256"
