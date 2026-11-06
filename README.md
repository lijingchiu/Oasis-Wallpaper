# Oasis Wallpaper

Oasis Wallpaper is a macOS desktop wallpaper application with a Steam Workshop browser, support for local video, GIF, web and scene wallpapers, per-display settings and an Oasis-style glass interface. Web wallpapers can receive desktop input after the user enables macOS Accessibility permission. It does not include the private Oasis maintenance app or the user's wallpapers, account credentials or sound library.

## Local wallpaper archives

Select a display in the library, then drop an EXE or its ZIP onto the library. Include the original data folders and DLLs when the program needs them. On first use Oasis downloads and verifies the pinned [Wine runtime](https://github.com/Gcenx/macOS_Wine_builds/releases/tag/11.21) and [DXVK graphics libraries](https://github.com/Gcenx/DXVK-macOS/releases/tag/v1.10.3-20230507-repack). Apple silicon uses Rosetta. The program runs behind the selected screen’s desktop icons with its own Windows profile. Enable Accessibility for desktop clicks. Windows drivers, custom launchers and graphics APIs beyond the installed runtime can require additional support. Self-contained Web, video and image ZIPs also import through the same library.

## Updates

Click **檢查更新** (Check for Updates) in the main window or the Oasis Wallpaper menu. The app downloads the latest stable public GitHub release, verifies its checksum and signing identity, then reopens from the same location. Install the app in a writable folder. Versions through 1.0.2 require one manual installation of 1.0.3 or later to get the updater.

## Build

Install Xcode Command Line Tools, Node.js 22, .NET SDK 9, CMake 3.25 or newer, and Rust with the `aarch64-apple-darwin`, `x86_64-apple-darwin` and `wasm32-unknown-unknown` targets. On macOS run:

```sh
bash Scripts/build-wallpaper.sh ./dist-wallpaper
```

The output is `dist-wallpaper/Oasis Wallpaper.app`. The default is an ad-hoc signed universal build for local testing; distributing an Apple-notarized build requires an appropriate signing identity and notarization. Steam downloads require the user's own entitled account and Valve assets are not included. Compatibility depends on each wallpaper's content and macOS capabilities.

This source release deliberately excludes stock photographs and user-supplied media. The original bundled photo catalog is disabled in this repository; local and Steam wallpapers remain available. See `App/Contents/Resources/WeatherScenes/LICENSES.txt` and `CREDITS.json` for historical asset attribution. Do not assume those excluded images are GPL-licensed.

## Licenses

The Oasis Wallpaper source in this repository is made available under GPL-3.0-only; see `LICENSE`. Third-party components retain their own licenses and notices. The linked scene renderer contains modified WallpaperMachine code under GPL-3.0-only, with corresponding source and modification notes in `ThirdParty/WallpaperMachine`. The separately executed Steam downloader is modified DepotDownloader under GPL-2.0; its source and notice are in `ThirdParty/DepotDownloader`. Other vendored components and trademarks retain their own terms. The application is not affiliated with Valve or Wallpaper Engine.

## Privacy

Steam credentials are stored by macOS Keychain when authorized by the user. User wallpapers and settings are stored locally and are not part of this repository. Review third-party wallpaper content and permissions before use.
