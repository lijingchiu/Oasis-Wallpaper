# Oasis Wallpaper

Oasis Wallpaper is a macOS desktop wallpaper application with a Steam Workshop browser, support for local video, GIF, web and scene wallpapers, per-display settings and an Oasis-style glass interface. Web wallpapers can receive desktop input after the user enables macOS Accessibility permission. It does not include the private Oasis maintenance app or the user's wallpapers, account credentials or sound library.

## Local wallpaper archives

Select a display in the library, then drop a ZIP onto the library or choose it with the upload button. Keep the original folder structure, including the Unity data folder alongside the EXE. Import runs locally. The two supported Unity/Spine layouts are the single-character dress-up scene and the multi-character music player. Oasis reads their original scene, artwork, animation and controls. Other Windows programs with custom logic need a compatible player. A ZIP containing a self-contained web wallpaper or a single supported video or image can also be imported.

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
