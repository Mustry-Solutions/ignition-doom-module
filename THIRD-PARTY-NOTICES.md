# Third-party notices

| Component | Licence | Where |
|---|---|---|
| [Chocolate Doom](https://github.com/chocolate-doom/chocolate-doom) (Doom, Heretic, Hexen and Strife) | GPL-2.0 | compiled into `gateway/src/main/resources/mounted/{doom,heretic,hexen,strife}/websockets-*.{js,wasm}`; `src/{heretic,hexen,strife}/` from upstream commit `749f4942` |
| [doom-wasm](https://github.com/cloudflare/doom-wasm) (Cloudflare's Emscripten port of Chocolate Doom) | GPL-2.0 | same; pinned commit + patches in `engine/` |
| [Emscripten](https://emscripten.org/) runtime glue | MIT / UIUC | embedded in `websockets-doom.js` |
| SDL2, SDL2_mixer, SDL2_net (Emscripten ports) | zlib | linked into the wasm |
| DOOM Shareware 1.9 `doom1.wad` | id Software shareware licence: redistributable complete and free of charge only | `gateway/src/main/resources/mounted/doom/doom1.wad` |
| Heretic Shareware 1.2 `heretic1.wad` (from `htic_v12.zip`, idgames archive) | Raven Software / id Software Limited Use Software License Agreement (LICENSE.DOC in the archive): electronic distribution permitted royalty-free in compressed form; no commercial use, no modification. The `.modl` is a zip; the module is free and unmodified data only. | `gateway/src/main/resources/mounted/heretic/heretic1.wad` |
| [Ignition SDK](https://github.com/inductiveautomation/ignition-sdk-examples) | Inductive Automation SDK licence (compile-time only) | not redistributed |

DOOM is a trademark of id Software LLC. Heretic and Hexen are trademarks of Raven Software / id Software; Strife of Rogue Entertainment / Night Dive Studios. No Hexen or Strife game data is included.
