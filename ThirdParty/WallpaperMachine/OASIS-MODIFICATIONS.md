# Oasis scene renderer

Upstream: WallpaperMachine/WallpaperMachine, commit 2bcf8831356ea59232b9b7f61b758d3d5148f8f0, GPL-3.0-only. Exact upstream source and vendored dependencies are retained here. Archive SHA-256: 8ad2427a9be22cc033057f689f4393061959c394dcd6be47f80f488a85425a53.

Oasis compiles Renderer/Engine and its Media, Sound, Surface and shader dependencies into a universal macOS 15+ dynamic library. It does not link MediaRemoteApp or the upstream application's media, player or system adapters. Playback is silent, capped at 30 fps and a 1920-pixel render width, paused when hidden or Reduce Motion is enabled.

Changes: remove the unnecessary PkgConfig discovery in Engine and Dependencies CMake files; replace LZ4's pkg-config lookup in Engine/src/CMakeLists.txt with CMake find_path/find_library; add Oasis-CMakeLists.txt to export the existing C API from a shared library, enable libc++ experimental jthread declarations for the build SDK, and link Apple's frameworks. The shader preprocessor resolves undefined identifiers at the end of object-like macro comparison chains to zero, matching desktop GLSL preprocessing, while preserving cycle and depth rejection. This fixes authored effects such as ASCII converter CUSTOM_BG_COL aliases; the 909 shader unit tests pass.

Build: Scripts/build-scene-renderer.sh. Requires Apple Command Line Tools, CMake 3.25+ and Rust (both aarch64-apple-darwin and x86_64-apple-darwin targets). The pinned third-party archives and SHA-256 hashes are listed in dependencies.json. Rust uses the retained Cargo.lock and vendored Naga. The corresponding source, build wrapper and integration source must accompany distributions under their respective licenses.

Valve's proprietary Wallpaper Engine asset files are not included or redistributed. A user's authorized Steam session downloads necessary base assets to their local Oasis data directory.

SceneScript factories place authored module bodies in a nested lexical scope. Authored `let`/`const scriptProperties` no longer collide with injected function parameters; inherited bindings and `this` are preserved. Six native ScriptEngine regression cases cover lexical declarations, var, implicit properties, shadowing, and handler closure state.

TEXB0004 texture variants: parse bounded condition records using project defaults; apply chosen raw, BC-compressed, or embedded-picture rectangle patches, alpha overlays and whole-level replacements; retain old padded TEXB4 layouts when no valid option table follows. Validate all geometry and byte ranges before decoding. Layout was checked against public format descriptions and a Steam-authorized real conditional BC3 texture; no third-party implementation was copied.

Referenced layers with a scene colour-blend mode keep their transparent pre-blend result in the layer composite, while their on-screen draw still uses the authored blend. This prevents an opaque copy of the background from entering masks and animated layers. GPU pixel tests cover several blend modes, alpha, and the layer's visible output; the fix was also checked against a real scene with independently controlled eye movement and blinking.
