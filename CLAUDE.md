# CLAUDE.md

Ignition 8.3 Perspective module with ONE component: Doom (Chocolate Doom →
WebAssembly). Structure and conventions mirror mustry-perspective-component-module
(Gradle + io.ia.sdk.modl, React 16 class component + TypeScript strict on the web
side, Java scopes for registration). Read README.md first.

## Licences — non-negotiable

- The module is **GPL-2.0-only** (the engine is GPL). Never copy code from the
  Apache-2.0 component module wholesale; re-derive patterns.
- Never add a non-shareware IWAD (doom.wad, doom2.wad, ...) to the repo or the
  module. The shareware `doom1.wad` ships complete and free of charge only.
- `freeModule` stays true. This can never be a paid module.

## Layout

- `engine/` — how the committed engine build is produced (pinned upstream +
  patches + `build.sh`). The outputs live in
  `gateway/src/main/resources/mounted/doom/` next to `doom1.wad` and `default.cfg`
  and are served at `/res/mustry-doom/doom/`.
- `web/typescript/components/doom/` — `doomLogic.ts` (pure, node-tested: args,
  stdout protocol, key defs, control diffing), `doomProps.ts` (PropertyTree →
  props), `doomEngine.ts` (DOM: script loading, one-instance guard, synthetic
  keys), `Doom.tsx` (the class component).
- `common/` descriptor + `doom.props.json`; `gateway/` hook mounts resources;
  `designer/` hook registers the palette entry.
- Component identity must match in `Doom.COMPONENT_ID` (Java) and
  `COMPONENT_TYPE` (TSX).
- The canvas MUST have id="canvas": SDL's Emscripten backend hardcodes that
  selector for sizing. Sizing rule: the component sets the canvas's inline CSS
  size to the frame; SDL derives the backing store (× devicePixelRatio) and
  re-reads the CSS size on a window resize event. Never set canvas.width/height.

## Key bindings must agree in three places

`gateway/.../default.cfg` (DOS scancodes the engine reads),
`doomLogic.CONTROL_KEYS` (the browser keys the tag controls synthesise) and
`engine/README.md` (the table). Change one, change all three.

## Build & verify

```bash
./gradlew build                 # .modl + jest + Java
cd web && npx tsc --noEmit && npm test
ops/fresh.sh                    # unattended dev gateway on :9188
ops/deploy.sh                   # reload a new build
ops/e2e.sh [--fresh|--no-deploy] # Playwright smoke test (e2e/), what CI runs
```

Never call a change done because the gateway returned 200: open
http://localhost:9188/data/perspective/client/verify, click the game and see
E1M1 render. Check the browser console is clean.
