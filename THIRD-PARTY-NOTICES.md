# Third-party notices

| Component | Licence | Where |
|---|---|---|
| [Chocolate Doom](https://github.com/chocolate-doom/chocolate-doom) | GPL-2.0 | compiled into `gateway/src/main/resources/mounted/doom/websockets-doom.{js,wasm}` |
| [doom-wasm](https://github.com/cloudflare/doom-wasm) (Cloudflare's Emscripten port of Chocolate Doom) | GPL-2.0 | same; pinned commit + patches in `engine/` |
| [Emscripten](https://emscripten.org/) runtime glue | MIT / UIUC | embedded in `websockets-doom.js` |
| SDL2, SDL2_mixer, SDL2_net (Emscripten ports) | zlib | linked into the wasm |
| DOOM Shareware 1.9 `doom1.wad` | id Software shareware licence: redistributable complete and free of charge only | `gateway/src/main/resources/mounted/doom/doom1.wad` |
| [Ignition SDK](https://github.com/inductiveautomation/ignition-sdk-examples) | Inductive Automation SDK licence (compile-time only) | not redistributed |

DOOM is a trademark of id Software LLC.
