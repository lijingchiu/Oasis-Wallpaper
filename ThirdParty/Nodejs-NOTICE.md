# Bundled Node.js runtime

Mole GUI releases include Node.js v22.23.3 (Jod LTS) from the official
https://nodejs.org/dist/v22.23.3/ distribution. Users do not need to install Node.js.

The build verifies the official macOS arm64 and x64 archives against pinned
SHA-256 values in `Scripts/node-runtime.sha256`, then combines their executables
into one universal runtime. Only the runtime executable and upstream license
are included; npm, headers, documentation and developer tools are omitted.

Node.js and its bundled dependencies are provided under their upstream licenses.
The complete upstream LICENSE is included in each built app at
`Contents/Resources/Licenses/Node-LICENSE.txt`.
