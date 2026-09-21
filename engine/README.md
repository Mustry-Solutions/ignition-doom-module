# Engine

The game engines are [Chocolate Doom](https://www.chocolate-doom.org/) and
Chocolate Heretic compiled to WebAssembly with Emscripten, via Cloudflare's
[doom-wasm](https://github.com/cloudflare/doom-wasm) port (GPL-2.0). The
compiled output is committed under `gateway/src/main/resources/mounted/<game>/`
so building the module never needs Emscripten:

| File | What | Origin |
|---|---|---|
| `doom/websockets-doom.js` | Emscripten glue, exports `createDoomModule()` | built by `engine/build.sh` |
| `doom/websockets-doom.wasm` | the Doom engine | built by `engine/build.sh` |
| `doom/doom1.wad` | Doom shareware 1.9 IWAD (sha1 `5b2e249b9c5133ec987b3ea77596381dc0d6bc1d`) | id Software, freely redistributable in full and free of charge only |
| `doom/default.cfg` | key bindings and engine defaults | this repo |
| `heretic/websockets-heretic.js` | Emscripten glue; also exports `createDoomModule()` (the page keys engines by script URL) | built by `engine/build.sh` |
| `heretic/websockets-heretic.wasm` | the Heretic engine | built by `engine/build.sh` |
| `heretic/heretic1.wad` | Heretic shareware 1.2 IWAD (sha1 `b4c50ca9bea07f7c35250a1a11906091971c05ae`), from `htic_v12.zip` on the idgames archive | Raven Software / id Software; freely distributable by electronic means, no commercial use |
| `heretic/heretic.cfg` | the same key bindings for Heretic | this repo |
| `hexen/websockets-hexen.{js,wasm}` | the Hexen engine (no IWAD ships; see `0003` below) | built by `engine/build.sh` |
| `hexen/hexen.cfg` | the same key bindings for Hexen | this repo |

`build.sh` clones the pinned doom-wasm commit, restores `src/heretic/` from
the Chocolate Doom commit doom-wasm was cut from (doom-wasm dropped the other
games), applies `patches/`, builds in the official Emscripten Docker image (or
locally with `--local`) and copies the outputs into place. The patches are the
complete source delta from upstream, which together with the pinned commits is
the corresponding source the GPL asks us to make available:

- `0001` adapts doom-wasm to the current Emscripten, builds a `MODULARIZE`d
  factory, adds the Doom telemetry/save hooks, and gives `boolean` one ABI:
  upstream's `doomtype.h` picks a 1-byte `bool` in files that saw `<stdbool.h>`
  and a 4-byte enum elsewhere, and Emscripten's own headers pull `stdbool.h`
  in, so under the image's default C17 the two halves of the engine disagreed
  about `sizeof(boolean)` and shared globals (`playeringame[]`, `netgame`,
  `paused`) read as garbage: single-player Doom showed FRAG and "Player 4 left
  the game". A `--local` build under a C23-default clang never showed it,
  which is why the binary committed before this fix was not reproducible
  from the Docker build.
- `0003` does the same for Hexen (`src/hexen/` from the same commit), adds a
  `{hexen, shareware}` row to `d_mode.c`'s netgame table so the 4-level demo
  can host and join, and defaults `graphical_startup` off (its separate SDL
  window breaks the canvas renderer in headless Chromium). Hexen ships no
  IWAD: the demo's archive carries no redistribution grant, so
  `mounted/hexen/` holds the engine and `hexen.cfg` only and the operator
  supplies `hexen.wad`.
- `0002` wires Heretic into the build (`src/Makefile.am`, `configure.ac`),
  restores two mouse bindings doom-wasm dropped that Heretic's `g_game.c`
  needs (`mouseb_speed`, `mouseb_useartifact`, in `m_controls` and the
  `m_config` defaults table), and ports the three game-side changes doom-wasm
  made for Doom: the browser-driven main loop (`emscripten_set_main_loop`),
  the `doom: 10, game started` line and the save hook, plus
  `src/heretic/mustry_stats.c` with the same stat ids.

## Key bindings (`default.cfg`, `heretic.cfg`, `hexen.cfg`)

Values are DOS scancodes, as Chocolate Doom stores them. Both games use the
same table.

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
