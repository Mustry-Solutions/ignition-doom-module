# CLAUDE.md

Ignition 8.3 Perspective module with ONE component: Doom (Chocolate Doom →
WebAssembly). Structure and conventions mirror mustry-perspective-component-module
(Gradle + io.ia.sdk.modl, React 16 class component + TypeScript strict on the web
side, Java scopes for registration). README.md is the product page; the
engineering detail (architecture, props, tag model, build, dev gateway, tests)
is docs/reference.md. Keep new technical detail there, not in the README.

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

## Save games (component ⇄ gateway)

Browser: `doomSaves.ts` (a `ComponentStoreDelegate`, created by `DoomMeta.createDelegate`)
fires `doom-saves-list` / `doom-saves-put` and receives `doom-saves-slots` /
`doom-saves-error`. Gateway: `DoomModelDelegate` (registered per component id in
the hook's `ComponentModelDelegateRegistry`) answers them and persists files via
`DoomSaveStore` under `data/modules/com.mustrysolutions.doom/saves/<user>/`.
The engine calls `Module.onDoomSaveGame(slot)` (EM_JS in `mustry_stats.c`,
called from `G_DoSaveGame`) after a slot file lands in `-savedir /saves`.
Event names live in both `doomSaves.ts` and `DoomModelDelegate.java`; change both.

## Telemetry → the [Doom] tag provider

`DoomTagProvider` (gateway) owns a ManagedTagProvider named `Doom`
(persistTags + allowTagCustomization). The component's `publishStats` sends the
changed output keys as a `doom-telemetry` event through the same store/model
delegate pair as the saves; `DoomModelDelegate` resolves the player
(`config.player` → session user → `anonymous-<session>`), creates
`Players/<player>/*` on first sight and updates values; on delegate shutdown
the player goes `Online=false`. The verify project mirrors it per player with
expression tags (`doom.setupPlayer(name)`), NOT a UDT: UDT parameter
substitution (`{Player}`, even `{InstanceName}`) never resolved in types made
through `system.tag.configure` on 8.3.6, and a reference tag onto the managed
provider stayed at Uncertain_InitialValue while an expression tag works.

## Deathmatch relay

`DoomRelayServlet` (Jetty EE10 `JettyWebSocketServlet`, registered through
`WebResourceManager.addServlet("doom-relay", ...)` so it answers at
`/system/doom-relay/<arena>`). Frame = `[to:u32 LE][from:u32 LE][doom packet]`
(doom-wasm `net_websockets.c`); the `-server` engine is id 1 and announces
with `to=0`; `-connect 1` joiners pick random ids. The hub routes by `to`,
tracks the server socket per arena, and closes joiners when the host leaves.
The gateway's exact Jetty version (12.0.27) is a compile-only dependency in
`gateway/build.gradle.kts`; bump it together with the Ignition image. Browser:
`relayUrl()` derives `ws(s)://<page host>/system/doom-relay/<arena>`;
`buildArgs()` emits `-wss <url> -server -nodes N [-deathmatch|-altdeath]` or
`-wss <url> -connect 1`. The host auto-launches at `-nodes` (net_gui.c). Admission: `DoomRelayTickets`
(per delegate instance = session@componentPath, + arena; reusable because the engine reconnects mid-game; 4 h TTL; revoked when THAT delegate shuts down, never per session: an older component instance dying must not kick a newer one); the store delegate's
`requestTicket()` -> `doom-relay-ticket` -> `doom-relay-ticket-ok`; the servlet
creator redeems `?ticket=` and returns null (403) otherwise. Saves: `owner()` is
null for unauthenticated sessions, the page then keeps slots in the tab.

## Operator WADs (bring your own)

`DoomWadStore` reads `data/modules/com.mustrysolutions.doom/wads/`; the hook
serves one file per `GET /data/mustry-doom/wads/<name>` behind a
`DoomRelayTickets.issueWad` ticket (`X-Doom-Ticket`; the relay refuses WAD
tickets and vice versa). Browser: `planWads()` (doomLogic) decides what runs
from the delegate's `doom-wads-ok` listing, `prepareWads()` (Doom.tsx)
fetches and writes the files into the engine FS before main(). Engine facts
that shape it: Chocolate Doom identifies an IWAD by FILE NAME (`KNOWN_IWADS`
in doomLogic; anything else is "Unknown or invalid IWAD file"), refuses
`-file` with shareware data, and reads `-warp` as one number for MAP01-style
IWADs (`wadGameMode()` sniffs the lump directory). Saves of a custom IWAD go
to `saves/<user>/game-<iwad>/`. The e2e fixture is doom1.wad seeded as
`wads/doom.wad` by `seed_verify_wads` (ops/lib.sh); a registered IWAD is
never in the repo, so PWAD loading proper is untested by CI. Data routes on
8.3 MUST set `.accessControl(...)` or `mount()` throws "Access control must be
specified".

## Start gating (why Doom.tsx waits before main())

Perspective can hand a NEW view a REUSED component store (same address, e.g.
`0:4`) and render it once with the previous view's props before this view's
bindings apply. Starting the engine in that window launches it with schema
defaults: wrong role/arena/player. Two guards, both needed:
1. `bindingsPending()`: with bound config props declared in the view's
   propConfig, `start()` waits for the first props update after mount, or a
   1.5 s settle window (bindings resolving to the same value never update).
   Do NOT gate on `props.getQualities()`: a delivered property binding may
   have no quality entry, which hung the demo view forever.
2. `netIdentity()`: if a netgame started and a later props update changes
   multiplayer/arena/player, quit and restart on the new identity. Turns any
   remaining race into a short delay. Retry only when `p !== prev.props`
   (a setState round-trip must not retrigger: React error #185).
   `wadIdentity()` does the same for a bound `config.iwad`/`pwads` (the WAD
   e2e failed without it: the click landed before the binding).
Symptom that led here: full e2e suite failed the deathmatch test 5/5 while
the test alone passed; host ticket issued for arena `default`.

## Key bindings must agree in three places

`gateway/.../default.cfg` (DOS scancodes the engine reads),
`doomLogic.CONTROL_KEYS` (the browser keys the tag controls synthesise) and
`engine/README.md` (the table). Change one, change all three.

## Dev gateway config seeding

`ops/gateway-config/` holds file-based 8.3 gateway config (the "Doom Historian"
TimescaleDB profile). `ops/fresh.sh` copies it into the **external** collection
(`data/config/resources/external/<module>/<type>/<name>/`) only AFTER the
gateway's first clean RUNNING. Lessons paid for: pre-creating the config tree
FAULTS the gateway ("Unable to create 'core' resource collection"); files
dropped into the gateway-owned `core` collection are swept away; `docker cp`
renames a folder when the destination is missing; and every resource.json
needs an `attributes.uuid` or it is "not loaded". The historian module itself
is staged by `ops/stage-historian.sh` (sibling repo, dev-signed); acceptance in
`accept_staged_module` covers every `.modl` in `ops/modules`. `wrapper.log`
inside the container is a symlink to stdout: use `docker logs`, not `grep`.

## Demo view facts (DoomDemo)

- Alarm-status tag property that actually updates in 8.3 bindings:
  `[default]<tag>.AlarmActiveUnackCount` (documented `ActiveUnackCount` reads
  null). Subscribe with a *tag* binding + transform, never an expression.
- Alarm status table id is `ia.display.alarmstatustable`; give it >= 220 px or
  the rows hide under its toolbar/filter chips.
- Tag-history bindings: `dateRange.rangeType/mostRecent/mostRecentUnits(MIN)`,
  `aggregate: LastValue`; no `{view.params.*}` indirection in tag paths.
- Embr Chart.js (`embr.chart.chart-js`) takes `{x: epochMs, y}` points with
  `scales.x.type = "time"` (moment adapter is bundled).
- The e2e spec relies on toggle DOM order fire, forward, turnLeft, use,
  lineRunning and on the readout text patterns; keep them when restyling.

## Verify project tags

The `[default]Doom/*` tag model (line tag with alarm, one expression-tag folder
per player) is created by `doom.setupTags()` + `doom.setupPlayer(name)` in the
project library (`ops/verify/project/ignition/script-python/doom/code.py`),
called from the DoomDemo view root's `events.system.onStartup`. Idempotent. A gateway
event-script resource (`ignition/event-scripts/startup.py`) was tried and
proven NOT to run on a fresh 8.3.6 gateway with the project mounted from first
boot, so do not reintroduce it without confirming the 8.3 format.

## Build & verify

```bash
./gradlew build                 # .modl + jest + Java (gateway JUnit: save store, relay tickets)
cd web && npx tsc --noEmit && npm test
ops/fresh.sh                    # unattended dev gateway on :9188
ops/deploy.sh                   # reload a new build
ops/e2e.sh [--fresh|--no-deploy] # Playwright smoke test (e2e/), what CI runs
```

The verify project has no identity provider (8.3 sets that in the Designer,
not in files), so the AUTHENTICATED save path is covered by DoomSaveStoreTest
and by hand via the demo view's log-in link, not by Playwright.

Never call a change done because the gateway returned 200: open
http://localhost:9188/data/perspective/client/verify, click the game and see
E1M1 render. Check the browser console is clean.
