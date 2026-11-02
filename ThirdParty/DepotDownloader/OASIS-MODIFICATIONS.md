# Oasis Workshop helper

Upstream: https://github.com/SteamRE/DepotDownloader/tree/DepotDownloader_3.4.0
Source archive SHA-256: 42a4846556ce5201107565ede7284cf58c91e4be062ce95122b3e8dddeae390e
License: GPL-2.0. Full modified corresponding source is retained in this directory.

Oasis modifications (2026-10-29): the helper's account store is memory-only. QR and session updates are structured events; the device name is Oasis Workshop. The native host alone persists the authorized session in macOS Keychain and sends it back over a private stdin pipe. No credentials enter browser JavaScript, arguments, environment variables, logs or files. Oasis never asks for a Steam password.

The separate helper downloads Steam-authorized Video, Web and Scene packages. For scenes it can retrieve only the owned application's assets directory as a reusable local cache; no Wallpaper Engine executable is run or redistributed. The parent controls fixed arguments, available-space checks, timeout and cancellation. There is no arbitrary 100 MB wallpaper cap.

Sequential Workshop/shared-asset downloads keep separate manifest caches. Authored hidden assets such as image/.config.json are retained; traversal, control characters, symlinks and the helper's reserved .DepotDownloader paths are rejected. Failure events expose only a phase and bounded exception type.

Build: bash Source/Scripts/build-workshop-helper.sh. .NET SDK 9+ is required for a source build; the installed helper is self-contained. Steam keys, sessions and Valve assets are not distributed.

Unayung/wallpaper-engine-mac was studied for workflow and compatibility; no code from that repository is copied here.

- Verify final Workshop asset size and SHA-1 against the Steam manifest before reporting completion; reject symbolic-link ancestors. Preallocated files no longer count as a successful download merely because their length matches.

- Accept authored zero-byte placeholders with an absent/zero digest, while still checking their exact size and rejecting nonempty mismatches. A data-only `-oasis-verify-package` command checks a matching cached Steam manifest and all asset hashes after an abnormal helper exit; it does not initialize Steam or read credentials.
