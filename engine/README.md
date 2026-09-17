# Engine

The game engine is [Chocolate Doom](https://www.chocolate-doom.org/) compiled to
WebAssembly with Emscripten, via Cloudflare's
[doom-wasm](https://github.com/cloudflare/doom-wasm) port (GPL-2.0). The
compiled output is committed in `gateway/src/main/resources/mounted/doom/` so
building the module never needs Emscripten:

| File | What | Origin |
|---|---|---|
| `websockets-doom.js` | Emscripten glue, exports `createDoomModule()` | built by `engine/build.sh` |
| `websockets-doom.wasm` | the engine | built by `engine/build.sh` |
| `doom1.wad` | Doom shareware 1.9 IWAD (sha1 `5b2e249b9c5133ec987b3ea77596381dc0d6bc1d`) | id Software, freely redistributable in full and free of charge only |
| `default.cfg` | key bindings and engine defaults | this repo |

`build.sh` clones the pinned upstream commit, applies `patches/`, builds in the
official Emscripten Docker image (or locally with `--local`) and copies the two
outputs into place. The patches are the complete source delta from upstream,
which together with the pinned commit is the corresponding source the GPL asks
us to make available.

## Key bindings (`default.cfg`)

Values are DOS scancodes, as Chocolate Doom stores them.

| Action | Key | Scancode |
|---|---|---|
| forward / backward | W / S | 17 / 31 |
| strafe left / right | A / D | 30 / 32 |
| turn left / right | Left / Right arrow | 75 / 77 |
| fire | Space | 57 |
| use | E | 18 |
| run | Left Shift | 42 |

The component's `data.controls` synthesises exactly these keys, so the tag
bindings and the physical keyboard always agree.
