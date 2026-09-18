# Changelog

All notable changes to Mustry Doom. Format follows Keep a Changelog; versions
are semver. Ignition's module version is numeric only, so releases are plain
`x.y.z` tags.

## [Unreleased]

### Added

- `GET /system/doom-relay/` answers with the relay's status: live arenas,
  whether each has a server, how many peers. No player names; the path is
  unauthenticated.

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
