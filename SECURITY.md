# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, use one of these private channels:

- **GitHub Private Vulnerability Reporting** — on this repository, go to the
  **Security** tab → **Report a vulnerability** (preferred).
- **Email** — `hello@mustrysolutions.com` with the details below.

Please include:

- the module version and the Ignition version of the gateway,
- whether the session was authenticated, and with what roles,
- a description of the issue and its impact,
- steps to reproduce.

We aim to acknowledge reports within a few business days, keep you updated on
remediation, and credit you (if you wish) once a fix ships.

## Scope

This is a game, but it is a game with a gateway scope, and the gateway-side
parts are where a real issue would be. Worth stating plainly:

- **Per-user files on the gateway.** Save games are written under
  `data/modules/com.mustrysolutions.doom/saves/<user>/`. The owner is derived
  on the gateway from the Perspective session's authenticated user, never from
  anything the page sends; unauthenticated sessions get no folder at all and
  keep their saves in the browser tab. Slot names are generated, not taken
  from the page, and the store rejects a file name that is not a plain name
  (one optional folder for the games whose slot is a directory). **A page
  reaching another user's saves, or writing outside that tree, is in scope.**
- **Operator-supplied WADs.** Files the operator places in
  `data/modules/com.mustrysolutions.doom/wads/` are served by a data route
  that requires a ticket issued to a Perspective session running the
  component; everything else gets 403. Names are resolved case-insensitively
  inside that one folder and nothing else is resolvable. **Reading a file
  outside the wads folder, or without a ticket, is in scope.**
- **The deathmatch relay.** A WebSocket hub at `/system/doom-relay/<arena>`
  forwards Doom's own network frames between sessions. Admission needs a
  ticket issued per component instance; the relay reads only the 8-byte header
  and never interprets the payload, and it has a 64 KB frame cap and an idle
  timeout. **Joining an arena without a ticket, reaching a socket you were not
  admitted to, or crashing the gateway through the relay is in scope.**
- **Tickets** are random 24-byte tokens, scoped (a WAD ticket cannot open a
  relay socket and vice versa), expiring, and revoked when the component
  instance that owns them goes away.
- **A WebAssembly engine in the browser.** The module ships Chocolate Doom,
  Heretic, Hexen and Strife compiled to WebAssembly. They run in the page's
  sandbox, not on the gateway, and they are upstream C with a long history of
  malformed-WAD bugs. A crafted WAD that crashes the engine *in the browser
  tab* is an upstream matter and out of scope here; one that reaches the
  gateway, another user, or data outside the tab is in scope.
- **The `[Doom]` tag provider** is written from component telemetry. Values are
  numbers and the player name is sanitised into a single path segment; a
  player name that escapes its folder would be in scope.

Out of scope: that the module exists at all, that an operator can install a
game on a production gateway, gateway misconfiguration (open authentication,
no identity provider), and anything requiring gateway admin rights the
attacker already has. We are happy to advise on those anyway.

## Supported versions

Pre-1.0, fixes land on the latest release line. Please test against the most
recent release before reporting.
