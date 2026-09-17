# Mustry Doom

**Can it run Doom? Your Ignition gateway can.**

A free Perspective component that runs the 1993 shareware episode of Doom
inside your SCADA. Tags fire the shotgun. Alarms pause the game. The marine's
health lands in your historian next to the pump pressures. Two operators can
deathmatch each other through the gateway.

It is of no industrial value whatsoever. That is the point.

- Ignition **8.3.6+**, Perspective
- One component: `Doom`, under the `Mustry Solutions` palette category
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

---

## Install

1. Download `Mustry-Doom.modl` from the [releases page](https://github.com/Mustry-Solutions/ignition-doom-module/releases).
2. Gateway, Config, Modules, install. Accept the certificate and the licence.
3. Designer: drag **Doom** from the palette into a view. Save. Open the
   session. Click to play.

That is the whole setup. Nothing else to configure.

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

---

## Where the data lives

| Data | Where |
|---|---|
| Live telemetry | `[Doom]Players/<player>/*`, the module's own tag provider |
| Save games | `data/modules/com.mustrysolutions.doom/saves/<user>/` on the gateway |
| Deathmatch traffic | Relayed by the gateway at `/system/doom-relay/<arena>`, never stored |
| The game itself | Runs in the browser tab. The gateway serves the engine and the shareware WAD. |

The player name defaults to the session's authenticated user, or to a
per-session name when there is none. Save games are stored only for
authenticated users, telemetry is keyed per player, and a session can only
ever reach its own.

---

## Licensing

The engine is [Chocolate Doom](https://www.chocolate-doom.org/), GPL-2.0, so
the module is GPL-2.0. The shareware episode is id Software's and may only be
redistributed complete and free of charge, which is why this module is free
and always will be. Registered Doom, Doom II and other IWADs are not included
and must not be added. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

DOOM is a trademark of id Software LLC. Mustry Solutions is not affiliated with
id Software, Bethesda, Cloudflare or Inductive Automation.

---

## Going deeper

- [Reference](docs/reference.md): architecture, every prop, the tag model,
  building from source, the dev gateway, the tests.
- [Engine](engine/README.md): how Chocolate Doom is built to WebAssembly and
  what was patched.

Made by [Mustry Solutions](https://mustrysolutions.com), who also make
Ignition modules with industrial value.
