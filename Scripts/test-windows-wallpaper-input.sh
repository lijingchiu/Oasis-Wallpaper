#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA="$(mktemp -d "${TMPDIR:-/tmp}/oasis-windows-input.XXXXXX")"
trap 'rm -rf "$QA"' EXIT
clang -arch x86_64 -mmacosx-version-min=12.0 -O2 -fobjc-arc \
 -Wl,-no_pie -Wl,-pagezero_size,0x1000 -Wl,-segaddr,WINE_RESERVE,0x1000 \
 -Wl,-segaddr,__TEXT,0x200000000 -framework Cocoa -framework CoreGraphics \
 "$ROOT/Tests/windows-wallpaper-input.m" -o "$QA/input"
"$QA/input"
