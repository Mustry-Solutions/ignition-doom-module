# Changelog

All notable changes to Mustry Doom. Format follows Keep a Changelog; versions
are semver. Ignition's module version is numeric only, so releases are plain
`x.y.z` tags.

## [Unreleased]

### Added

- Strife. `config.game = strife` runs Chocolate Strife (`engine/patches/0004`)
  from the operator's `strife1.wad` in the gateway's wads folder, with
  `voices.wad` fetched as a companion when present (else `-novoice`). No
  free Strife data exists, so the module ships the engine only. Folder
  save slots (`strfsav<N>.ssg/`), `output.gold`, `output.questFlags` and
  `Gold`/`QuestFlags` tags. The whole Chocolate Doom family is in. (#7)

## [0.2.0] - 2026-09-21

Three games, one component. Heretic ships with its shareware episode; Hexen
ships as an engine for the `hexen.wad` you own; bring your own WAD for all
of them. The engine build is reproducible again.

### Added

- Heretic. `config.game = heretic` runs Chocolate Heretic, built from the
  same upstream (`engine/patches/0002`), with Raven's shareware episode City
  of the Damned. Same controls, telemetry, saves (`saves/<user>/game-heretic1/`),
  operator WADs and deathmatch relay. `[Doom]Players/<player>/Game` names
  the game a player is in. (#5)
- Hexen. `config.game = hexen` runs Chocolate Hexen (`engine/patches/0003`)
  from the operator's `hexen.wad` in the gateway's wads folder: the module
  ships the engine but no Hexen IWAD, because the demo's archive grants no
  redistribution. `config.playerClass` (fighter, cleric, mage),
  `output.playerClass` and a `PlayerClass` tag. Save slots can be a set of
  files (Hexen's hub archives), stored under `slot<N>/`. The 4-level demo can
  host and join netgames; Chocolate's mode table used to refuse it. (#6)
- Bring your own WAD. `config.iwad` and `config.pwads` play IWADs and PWADs
  the gateway operator placed in `data/modules/com.mustrysolutions.doom/wads/`.
  Downloads need a delegate-issued ticket (403 for anyone else), an unknown
  IWAD falls back to shareware with `output.wadError` set, PWADs on shareware
  Doom data are skipped (the engine would refuse them), Doom II-style IWADs
  warp by map alone, and each custom IWAD keeps its own save slots.
  `output.iwad`, `output.availableWads`. The module still ships no registered
  WAD. (#2)
- `GET /system/doom-relay/` answers with the relay's status: live arenas,
  whether each has a server, how many peers. No player names.
- Engine stdout goes to the browser console at `debug` level (`[doom] ...`).
- Demo project: a launcher at `/` with a card per game and an overview page
  per game (`/doom`, `/heretic`, `/hexen`), generated from one table
  (`ops/verify/tools/build_launcher.py`). Three pills in the control-room
  header show whether the Doom module, Embr Charts and a tag history provider
  are present, with a tooltip saying where to get a missing one.
- README: a "full experience" table listing the three optional pieces.
- `ops/`: container names and ports can be overridden per checkout, so a
  worktree can run a second dev gateway beside the main one; environment
  variables win over `.env`. `ops/fetch-hexen-demo.sh` puts the Hexen demo
  on the dev gateway (never in the repo).

### Changed

- Demo project: the control room moved from `/` to `/doom/control-room`;
  every game view's title links back to the launcher.
- The engine build (`engine/build.sh`) now produces three engines from the
  pinned doom-wasm commit plus `src/heretic/` and `src/hexen/` from the
  Chocolate Doom commit doom-wasm forked from.

### Fixed

- The engine build was not reproducible and, from the Docker image, produced
  a Doom that showed FRAG and "Player 4 left the game" in single player and
  ignored turn keys: `boolean` had two sizes across translation units under
  C17 (Emscripten's headers include `<stdbool.h>`). `doomtype.h` now gives C
  one `int` boolean; all engines are rebuilt from `engine/build.sh`.
- Demo project: history was silently never enabled on the demo tags since
  0.1.2. The historian lookup called `system.tag.getHistorianProviders`,
  which does not exist in 8.3; providers are now read from
  `system.tag.browseHistoricalTags("")`. Reopening the view after upgrading
  the project rebuilds the player folder with history on.
- Demo project: the chart component is not rendered at all when Embr Charts
  or a historian is missing, instead of Perspective's missing-component box
  covering the explanation.

## [0.1.2] - 2026-09-17

### Added

- `Mustry-Doom-Demo-Project.zip` on every release: the control-room and
  arena views as a Designer-importable project (`DoomDemo`). Tags are created
  on first open; history uses the "Doom Historian" profile when present, else
  the gateway's first historian, else none; the chart card explains its two
  optional modules instead of erroring.

## [0.1.1] - 2026-09-17

### Fixed

- A component whose store Perspective reused from a previous view could
  start the engine before this view's bindings applied, launching a netgame
  as the wrong role, in the wrong arena, as the wrong player. The component
  now waits for its bindings to settle, and restarts the engine if a later
  binding changes the netgame identity.
- Relay tickets are revoked per component instance instead of per session,
  so an older instance shutting down no longer kicks a newer one out of its
  arena. The relay routes by the arena the ticket was issued for.
- Gateway JUnit tests cover the save store and the ticket registry.

## [0.1.0] - 2026-09-17

The first release. Can it run Doom? Yes.

### The component

- `Doom`: Chocolate Doom (via Cloudflare's doom-wasm port) compiled to
  WebAssembly, served by the gateway, running on a canvas in a Perspective
  view. The shareware episode ships inside the module.
- Keyboard and mouse only while the game has focus; nothing leaks into the
  rest of the view. Restart without a page reload; two-way `state.running`.
- Tag-bindable controls (`data.controls.*`): hold a boolean to hold a key,
  a weapon slot on change.
- `state.paused` two-way, Doom's own pause. Bind it to an alarm.

### Telemetry and the `[Doom]` tag provider

- Health, armor, ammo, weapon, kills, items, secrets and totals, episode, map,
  level time, in-level, dead, plus netgame, lobby and player count, exported
  from the engine and mirrored to `output.*`.
- The module owns a `[Doom]` tag provider; the component streams its
  telemetry to the gateway and each player gets `[Doom]Players/<player>/*`
  with Online, Session and LastSeen. No bindings, no scripts.

### Save games

- Doom's six slots persist on the gateway per authenticated Perspective user
  and are restored into the engine before it starts. Unauthenticated
  sessions keep saves in the tab; there is no shared anonymous folder.

### Deathmatch

- The gateway relays Doom's netgame between Perspective sessions at
  `/system/doom-relay/<arena>`. Host, join, arena, player count and rules on
  the component. The host launches when the lobby is full.
- Admission by gateway-issued ticket: only sessions running the component
  reach an arena. Bare WebSockets get 403.

### Licensing

- GPL-2.0-only (the engine is GPL). Free module, no trial, no activation.
  The shareware WAD ships complete and free of charge, as its licence
  requires. No other IWAD is included and none may be added.
