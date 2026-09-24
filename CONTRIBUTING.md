# Contributing

Thanks for your interest in improving **Mustry Doom**. This guide covers how to
build it, run it, and submit changes.

## Ground rules

- Be respectful — see our [Code of Conduct](CODE_OF_CONDUCT.md).
- By contributing you agree your work is licensed under the repository's
  [GPL-2.0-only License](LICENSE).
- Found a security issue? **Do not** open a public issue — see
  [SECURITY.md](SECURITY.md).

## The licence rules are not negotiable

This module is GPL-2.0 because the engines are, and it is free because the
shareware WADs may only be distributed free of charge. A contribution cannot
change either. Concretely:

- **Never add a non-shareware IWAD** (`doom.wad`, `doom2.wad`, `heretic.wad`,
  `hexen.wad`, `strife1.wad`, …) to the repository or the `.modl`. Hexen and
  Strife ship as engines only; the operator supplies the data they own, from
  the gateway's wads folder.
- `freeModule` stays `true`. There is no paid tier of this module.
- Code copied from an Apache-2.0 sibling module would relicense it. Re-derive
  the pattern instead.

## Prerequisites

- **JDK 17** (Temurin) — the Gradle toolchain expects it.
- **Docker** — for the local dev gateway, and for rebuilding the engines.
- Network access to Inductive Automation's Maven repository.
- Node is downloaded by the build; you do not need to install it.

## Build

```bash
./gradlew build          # .modl + jest + JUnit
cd web && npx tsc --noEmit && npm test
```

The module lands in `build/` (unsigned unless you pass signing properties; see
[RELEASING.md](RELEASING.md)).

## Run it

```bash
ops/fresh.sh             # build, sign with a throwaway cert, recreate the gateway, unattended
ops/deploy.sh            # rebuild + reload after code changes
ops/e2e.sh               # deploy + the Playwright suite (what CI runs)
ops/teardown.sh          # stop it (--purge also wipes gateway data)
```

The gateway comes up at <http://localhost:9188> (admin / password) with the
verify project mounted; open
<http://localhost:9188/data/perspective/client/verify> and click a game.

Two of the four games need data you own, and two test fixtures are downloads:

```bash
ops/fetch-hexen-demo.sh  # Hexen's free 4-level demo, for the dev gateway only
ops/fetch-freedoom.sh    # Freedoom (BSD): the free registered IWAD the PWAD test needs
# Strife: copy your own strife1.wad (and voices.wad) into engine/build/strife/
```

`ops/fresh.sh` seeds whatever it finds. Tests whose data is missing skip rather
than fail — that is also how CI runs Strife.

## Read this before changing the component

[docs/reference.md](docs/reference.md) is the engineering detail: architecture,
every prop, the games table, saves, the relay, the tag model, the dev gateway.
[CLAUDE.md](CLAUDE.md) is the shorter list of things that have already bitten
somebody — the start-up race with reused component stores, the canvas sizing
rule, the four places key bindings must agree. Several of them exist to work
around a specific, documented failure; changing one without reading is the
fastest way to reintroduce a bug that is already fixed.

If you are here to learn the SDK rather than to change this module,
[docs/ignition-8.3-sdk-notes.md](docs/ignition-8.3-sdk-notes.md) is the short
version, with pointers into the working code.

## Adding a game

Everything per-game on the browser side is the `GAMES` table in
`web/typescript/components/doom/doomLogic.ts`: engine folder, bundled IWAD (or
none), config file, save layout, IWAD names the engine accepts, netgame rules.
Add a row there, not a branch in `Doom.tsx`. The engine side is a patch under
`engine/patches/` plus a `mustry_stats.c` for that game; `engine/README.md`
explains the recipe and what each existing patch does.

## Engine binaries

The four `.wasm` engines are committed. **Commit exactly what
`engine/build.sh` produces** — it builds in a pinned Emscripten image, and the
`Engines reproducible` workflow rebuilds them and fails on a single differing
byte. A `--local` build can silently differ (that is how a broken binary
survived in this repo for weeks; see the 0.2.0 changelog).

## Pull request flow

1. Branch off `main` (`feature/…`, `fix/…`, `docs/…`).
2. Make your change and add a `CHANGELOG.md` entry under `## [Unreleased]`.
   Pure logic belongs in `doomLogic.ts` with a jest test — args, WAD planning,
   save-slot layout, control diffing are all node-testable without a browser.
   Gateway logic gets a JUnit test. Anything user-visible wants an e2e test in
   `e2e/tests/doom.spec.ts`.
3. **Verify it in a real gateway, not just in tests.** The instruction in
   CLAUDE.md is blunt for a reason: never call a change done because the
   gateway returned 200. Open the verify project, start the game, watch it
   render, and check the browser console is clean.
4. If you changed a view in `ops/verify/project`, remember the launcher and the
   per-game hubs are generated: edit the `GAMES` table in
   `ops/verify/tools/build_launcher.py`, rerun it, commit the JSON. If you
   changed something the README pictures show, rerun the screenshot job
   (`SCREENSHOTS=1 npx playwright test screenshots` in `e2e/`, then
   `ops/make-gif.py` for the animation).
5. Open a PR. **Build & test** and **E2E smoke (Ignition 8.3.6)** must pass;
   the `latest` e2e job is informational and may fail on Inductive
   Automation's release day.
6. A maintainer merges it. `main` is always releasable.

## Conventions

- Match the surrounding code style. TypeScript is strict; the component is a
  React 16 class component on purpose (that is what Perspective gives you).
- Keep logic out of `Doom.tsx`. If it can be decided without a DOM, it belongs
  in `doomLogic.ts` where it can be tested in milliseconds.
- Event names are shared between `doomSaves.ts` and `DoomModelDelegate.java`;
  change both.
- Key bindings must agree in four places — the per-game `.cfg` files, the
  `CONTROL_KEYS` table and `engine/README.md`.
- Anything the gateway serves to a page that arrives without a Perspective
  session (WAD downloads, the relay) needs a ticket from `DoomTickets`. Do not
  add an open route.
- Do not commit game data. `engine/build/` is gitignored and that is where
  fixtures live.

## Releasing

Maintainers only, and documented in [RELEASING.md](RELEASING.md): a changelog
PR, then an annotated `vX.Y.Z` tag on the merge commit. The tag sets the module
version, the workflow signs the `.modl` and publishes the release with that
changelog section as its notes.
