# Mustry Doom

**Can it run Doom? Your Ignition gateway can.**

A free Perspective component that runs the 1993 shareware episode of Doom
inside your SCADA. Tags fire the shotgun. Alarms pause the game. The marine's
health lands in your historian next to the pump pressures. Two operators can
deathmatch each other through the gateway.

It is of no industrial value whatsoever. That is the point.

![Doom paused inside a Perspective view: the line stopped, the alarm is active, the marine waits.](docs/images/hero-paused.png)

*Line 3 stopped. The alarm is unacknowledged. The marine waits.*

- Ignition **8.3.6+**, Perspective
- One component: `Doom`, under the `Mustry Solutions` palette category. It
  also plays Heretic.
- Free, no trial, no activation. GPL-2.0.

---

## What it does

**Plays Doom.** Drag the component into a view, save, click. The engine is
Chocolate Doom compiled to WebAssembly, served by the gateway, running in the
browser. Keyboard and mouse work when the game has focus and never leak into
the rest of your view.

**Takes orders from tags.** Every control is a boolean prop: `forward`,
`turnLeft`, `fire`, `use`, and the rest. Bind them to tags and a PLC input
fires the shotgun. A weapon slot prop switches guns on change.

**Obeys your alarms.** `state.paused` is two-way. Bind it to an active alarm
and production trouble freezes the marine until someone acknowledges. Doom
shows its own pause banner.

**Reports back.** Health, armor, ammo, weapon, kills, secrets, map, level
time, alive or dead: the component streams its telemetry to the gateway and
the module writes it into its own `[Doom]` tag provider, one folder per
player. No bindings, no scripts. Historize it, alarm on it, trend it.

**Remembers.** Doom's six save slots are stored on the gateway per Perspective
user. Save on the day shift, load on the night shift. Sessions without a login
keep their saves in the tab, so nobody shares a folder by accident.

**Deathmatch.** The gateway relays Doom's network between Perspective
sessions. Host in one browser, join from another. The host's game launches
when everyone is in the lobby. Only sessions running the component get into
an arena: the gateway hands each one a ticket.

**Also Heretic.** Set `config.game` to `heretic` and the same component runs
Raven's 1994 shareware episode from the same engine family: same controls,
same tags, same saves, same deathmatch relay. Elven wand instead of pistol.

---

## In pictures

The demo project from the releases page, running on a plain 8.3.6 gateway
with the Mustry TimescaleDB Historian and Embr Charts installed. The module
provides the game and the tags; the screen around them is this project.

![The control room: the game, health/armor/ammo/kills tiles fed by the [Doom] tag provider, the line alarm table, tag-bound controls and a five-minute health trend from the historian.](docs/images/control-room.png)

*The control room. Tiles and chart are ordinary tags: the component writes
its telemetry into the module's own `[Doom]` provider and the plant side
mirrors it with history and alarms. The three pills in the header are the
requirements check: this gateway has the module, Embr Charts and a historian.*

![The line is stopped: the header pill turns red, the "Line stopped" alarm sits unacknowledged in the table, and Doom shows its pause banner.](docs/images/alarm-pause.png)

*Someone stopped line 3. The alarm went active, `state.paused` followed it,
and the marine stopped mid-corridor. Acknowledge the alarm and he carries on.*

| Host | Joiner |
|---|---|
| ![The host's view in a deathmatch: the FRAG counter replaced ARMS on the status bar, two players in the game.](docs/images/deathmatch-host.png) | ![The second player's view of the same arena, in another browser.](docs/images/deathmatch-join.png) |

*Two Perspective sessions, one arena, relayed by the gateway. Note the status
bar: FRAG where ARMS used to be, and two player markers.*

---

## Install

1. Download `Mustry-Doom.modl` from the [releases page](https://github.com/Mustry-Solutions/ignition-doom-module/releases).
2. Gateway, Config, Modules, install. Accept the certificate and the licence.
3. Designer: drag **Doom** from the palette into a view. Save. Open the
   session. Click to play.

That is the whole setup. Nothing else to configure.

**What the module gives you:** the Doom component, the engine and the
shareware episode served by the gateway, the `[Doom]` tag provider that fills
itself with each player's telemetry, save games per user, and the deathmatch
relay. All of it works from a bare component with default settings.

**What it does not give you:** the control-room screen in the pictures
above. That is a demo project, and it is one download away.

### The demo project

Every release also carries `Mustry-Doom-Demo-Project.zip`. In the Designer,
File, Import, pick the zip, import everything. You get project `DoomDemo`
with a launcher at `/` that lists every game and its pages: the Doom
control room at `/doom/control-room`, the deathmatch arena at
`/arena/host/<player>` and `/arena/join/<player>`, `/wad/<iwad>` for a WAD
of your own, `/game/heretic` for Heretic, and an overview per game at
`/doom` and `/heretic`. The tags it uses are created the first time a view
opens.

**The full experience needs three things.** Two of them are optional, and
the view tells you which ones it found: three pills in the header, green when
the piece is there and grey when it is not. Hover one for what to do.

| Piece | What it adds | Where |
|---|---|---|
| **Mustry Doom** module | The game, the `[Doom]` tags, save games, deathmatch. Everything except the trend. | This repo's [releases](https://github.com/Mustry-Solutions/ignition-doom-module/releases) |
| **Embr Charts** (optional) | Draws the five-minute vitals trend. | Musson Industrial's [releases](https://github.com/mussonindustrial/embr/releases): the `Embr-Charts-Ignition83` file. Free, MIT. |
| A **tag history provider** (optional) | Data for the trend. The demo enables history on its tags when it finds one. | Any historian. We use the [Mustry TimescaleDB Historian](https://github.com/Mustry-Solutions/timescaledb-historian-module) (needs a PostgreSQL/TimescaleDB database). |

Without the optional two, the chart card says which one is missing and the
rest of the page works. Add them later and reload the page: the tags pick up
history on the next open.

---

## Five minute tour

**Pause on alarm.** Bind `state.paused` to your line's alarm state:

```
{[default]Line3/Running.AlarmActiveUnackCount} > 0
```

**Fire from a tag.** Bind `data.controls.fire` to any boolean tag. True holds
the trigger, false releases it.

**Historize the marine.** Enable history on `[Doom]Players/<player>/Health`
in the Designer. Done. It trends like any process value.

**Alarm on death.** Put a Critical alarm on `[Doom]Players/<player>/Dead`.
Label it "Marine down". Watch the alarm table light up.

**Deathmatch.** Set `config.multiplayer` to `host` on one component and
`join` on another, same `config.arena`. Open both sessions. Fight.

**Bring your own WAD.** Copy the `DOOM2.WAD` (or `HERETIC.WAD`) you own into
`data/modules/com.mustrysolutions.doom/wads/` on the gateway and set
`config.iwad` to `doom2`. Mods go next to it and into `config.pwads`. Only
sessions running the component can fetch them; everyone else gets a 403.

---

## Where the data lives

| Data | Where |
|---|---|
| Live telemetry | `[Doom]Players/<player>/*`, the module's own tag provider |
| Save games | `data/modules/com.mustrysolutions.doom/saves/<user>/` on the gateway |
| Deathmatch traffic | Relayed by the gateway at `/system/doom-relay/<arena>`, never stored |
| The game itself | Runs in the browser tab. The gateway serves the engine and the shareware WAD. |
| Your own WADs | `data/modules/com.mustrysolutions.doom/wads/` on the gateway, served to component sessions only |

The player name defaults to the session's authenticated user, or to a
per-session name when there is none. Save games are stored only for
authenticated users, telemetry is keyed per player, and a session can only
ever reach its own.

---

## Licensing

The engines are [Chocolate Doom](https://www.chocolate-doom.org/) and
Chocolate Heretic, GPL-2.0, so the module is GPL-2.0. The shareware episodes
are id Software's and Raven's and may only be redistributed complete, free of
charge and without commercial use, which is why this module is free and
always will be. Registered Doom, Doom II, Heretic and other IWADs are not
included and must not be added; the module plays the ones you own from the
gateway's wads folder. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

DOOM is a trademark of id Software LLC; Heretic of Raven Software / id
Software. Mustry Solutions is not affiliated with id Software, Raven
Software, Bethesda, Cloudflare or Inductive Automation.

---

## Going deeper

- [Reference](docs/reference.md): architecture, every prop, the tag model,
  building from source, the dev gateway, the tests.
- [Engine](engine/README.md): how Chocolate Doom is built to WebAssembly and
  what was patched.

Made by [Mustry Solutions](https://mustrysolutions.com), who also make
Ignition modules with industrial value.
