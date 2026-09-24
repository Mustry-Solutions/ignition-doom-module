# Ignition 8.3 SDK notes

Facts about the Ignition 8.3 module SDK that cost us time while building this
module, written down so they cost you less. Everything here was verified
against a real 8.3.6 gateway, and most of it is load-bearing somewhere in this
repository — the file and class names point at working code you can read.

Ignition's own [SDK documentation](https://www.sdk-docs.inductiveautomation.com/)
and the [SDK examples](https://github.com/inductiveautomation/ignition-sdk-examples)
(`ignition-8.3` branch) are the starting point. These are the gaps.

## Gateway

### A data route without access control refuses to mount

`RouteGroup.newRoute(...)` looks complete without one, and then `mount()`
throws `IllegalArgumentException: Access control must be specified`, which the
gateway logs as "Unable to mount routes for module" — your route is simply
absent and everything else keeps working. Always call `.accessControl(...)`
(or `.requirePermission(...)`).

An `AccessControlStrategy` is a one-method interface, so a custom rule is a
lambda returning `RouteAccess.GRANTED` / `FORBIDDEN`. This module admits a
request that carries a ticket its own component handed out:

```java
static final AccessControlStrategy WAD_TICKET = (RequestContext req) -> {
    String ticket = req.getRequest().getHeader(TICKET_HEADER);
    if (ticket == null) {
        ticket = req.getParameter("ticket");
    }
    return DoomTickets.redeemWad(ticket) ? RouteAccess.GRANTED : RouteAccess.FORBIDDEN;
};
```

See `DoomGatewayHook.mountRouteHandlers`. Routes land at
`/data/<mountPathAlias>/...`; static files from `getMountedResourceFolder()`
land at `/res/<mountPathAlias>/...`.

### WebSocket servlets: register through WebResourceManager

A module can serve WebSockets by registering a Jetty EE10
`JettyWebSocketServlet` with
`context.getWebResourceManager().addServlet("name", Servlet.class)`; it then
answers at `/system/<name>/...`. The gateway's Jetty version is not on the
module classpath through the SDK, so declare exactly the gateway's version as
`compileOnly` and never bundle it:

```kotlin
compileOnly("org.eclipse.jetty.ee10.websocket:jetty-ee10-websocket-jetty-server:12.0.27")
```

Bump it together with the Ignition version you target. On 8.3.6 the upgrade
works with no further ceremony; on 8.3.1 (see
[DivCurl/ignition-doom](https://github.com/DivCurl/ignition-doom)) Ignition
wrapped the request in an `HttpServletRequestWrapper` that Jetty's upgrade
refused, and the workaround was to unwrap it in an overridden `service()`.
Worth knowing if you support older 8.3 gateways.

A plain `GET` on the same servlet (no upgrade) is an easy status endpoint:
`DoomRelayServlet.doGet` answers with JSON listing its live arenas.

### Managed tag providers create tags without a project

`context.getTagManager().getOrCreateManagedProvider(config)` gives a provider
your module owns. With `persistTags(true)` the tags survive a restart; with
`allowTagCustomization(true)` an engineer can add history or alarms to them in
the Designer and keep those settings. `configureTag(path, DataType)` then
`updateValue(path, value, QualityCode.Good, timestamp)` is the whole API.

Two things we learned the hard way in the demo project that consumes such a
provider:

- **UDT parameter substitution does not resolve** in UDT types created through
  `system.tag.configure` on 8.3.6 — neither `{Player}` nor `{InstanceName}`.
  One expression tag per instance works; a UDT does not.
- A **reference tag** pointing at a managed provider's tag stayed at
  `Uncertain_InitialValue`; an **expression tag** reading the same path works.

### Config resources and the config UI

Annotated Java records plus `ResourceTypeMeta.newBuilder` (`.singleton()`,
`.categoryName()`, `.defaultConfig()`, `.buildValidator()`) with
`SingletonResourceHandler` / `NamedResourceHandler` (`.onChange()` for hot
reload). They persist as
`data/config/resources/core/<module-id>/<type>/config.json`.

8.3 **auto-generates a config page only for extension points.** A singleton
resource type is searchable but gets no page; mount your own with
`getWebResourceManager().getNavigationModel().getPlatform().addCategory(...)`
and a SystemJS module.

**Saving a resource whose content did not change fires no `onChange`.** If
your hot-apply path re-reads state that lives *outside* the resource (a secret
provider, a file, a remote system), re-apply explicitly after
`updateResource(...).get()` — otherwise the operator presses Save and nothing
happens.

### Things the platform does not tell you

- **No public API exposes the running Ignition version.** The install's own
  record is `lib/install-info.txt` (a plain `Properties` file, key
  `gateway.version`); the `lib` directory is the sibling of
  `getSystemManager().getDataDir()`. A module's *own* version:
  `getModuleManager().getModule(id).getInfo().getVersion().getBasicString()`.
- `getSystemPropertiesManager().getSystemName()` replaced 8.1's
  `getSystemProperties()`.
- `GatewayContext.getMetricRegistry()` (Dropwizard) is public. Raw metric names
  are mostly unprefixed and hyphen-separated
  (`databases.active-connections`, `perspective.sessions`); instance segments
  can contain spaces. Log them rather than guessing.
- Logging is logback 1.3.x, and appenders can be attached programmatically to
  the root logger via `LoggerFactory.getILoggerFactory()`.
- `system.tag.getHistorianProviders` does **not** exist in 8.3 scripting;
  `system.tag.browseHistoricalTags("")` is how you find providers.

## Perspective components

### A component store can be reused for a new view

Perspective may hand a **new** view a **reused** component store (same address,
e.g. `0:4`) and render it once with the *previous* view's props before this
view's bindings apply. Anything that acts on props at mount — starting an
engine, opening a connection, writing a tag — can therefore act on the wrong
values for a few hundred milliseconds.

Two guards, both needed (`Doom.tsx`):

1. Wait for the first props update after mount **when the view's `propConfig`
   declares bound config props**, with a settle timeout for bindings that
   resolve to the same value and never fire an update. Do **not** gate on
   `props.getQualities()`: a delivered binding may have no quality entry at
   all, which hangs you forever.
2. Keep the identity you started with (for us: game, arena, role, player) and
   restart if a later props update changes it. Retry only when the props
   object itself changed — reacting to your own `setState` round-trip is
   React error #185.

### Gateway-side model delegates

A component can have a gateway-side partner: implement
`ComponentModelDelegate` and register it per component id in the gateway hook's
`ComponentModelDelegateRegistry`. The browser side extends
`ComponentStoreDelegate` (returned from the component descriptor's
`createDelegate`) and the two exchange named JSON events. That channel is
already authenticated as the Perspective session, which makes it the right
place to decide what a page is allowed to do:

- resolve the user (`component.getSession().getWebAuthStatus().getUser()`),
- read and write files under the gateway's data directory per user,
- hand out short-lived tickets for anything the page will fetch over plain
  HTTP or WebSocket, because those requests arrive with no session context.

`DoomModelDelegate` does all three. Note that a session can hold several
component instances over its life (view refreshes, page changes): key
per-instance state on `sessionId + componentAddressPath`, not on the session,
or an old instance shutting down will revoke a new one's access.

## Build, packaging, release

- **Module versions must be numeric** `x.y.z(.b)` in `module.xml`. A semver
  prerelease like `0.1.0-beta.1` makes the gateway reject the `.modl` at load
  with "Exception parsing module.xml". Map prerelease tags to numbers in the
  build and keep the full semver on the GitHub release.
- Use the Gradle plugin's own `license.set("license.html")` and
  `freeModule.set(...)`; both exist in `io.ia.sdk.modl` 0.4.1 and 0.5.0, and
  `assembleModlStructure` stages the file while `writeModuleXml` emits
  `<license>`. Hand-rolled zip surgery is unnecessary.
- `assembleModlStructure` is additive: stale dependency jars accumulate in the
  `.modl` unless `build/moduleContent` is wiped first.
- **Unsigned modules cannot be accepted headlessly.** Even with
  `-Dignition.allowunsignedmodules=true`, first-boot commissioning parks on
  "modules". For unattended dev gateways, sign with a throwaway certificate
  and seed `data/modules.json` while the gateway is stopped with
  `{filename, onStartup: "enabled", certFingerprint}` (SHA-1 of the
  certificate, lower case, no colons). `ops/lib.sh` in this repo does it.
- 8.3 keeps gateway configuration as files under
  `data/config/resources/<collection>/<module>/<type>/<name>/`. Seed your own
  into the **external** collection, and only after the gateway's first clean
  start: pre-creating the tree faults the gateway ("Unable to create 'core'
  resource collection"), and files dropped into the gateway-owned `core`
  collection are swept away. Every `resource.json` needs an `attributes.uuid`
  or the resource is silently "not loaded".
- Read the gateway log with `docker logs <container>`, not by exec'ing into
  the container: `wrapper.log` there is a symlink to stdout, and file reads
  under `logs/` on a busy gateway can stall for minutes.

## The browser side, if you embed WebAssembly

Not SDK, but the part of this module that was hardest to get right, and it
generalises to any Emscripten payload inside Perspective.

- **One ABI for your C types.** Chocolate Doom's `doomtype.h` defines
  `boolean` as a 1-byte `bool` in translation units that saw `<stdbool.h>` and
  as a 4-byte enum everywhere else. Emscripten's own headers include
  `<stdbool.h>`, so under the toolchain's default C17 the two halves of the
  engine disagreed about `sizeof(boolean)` and shared globals decoded as
  garbage: single-player Doom showed a deathmatch frag counter and ignored the
  turn keys. A local build under a C23-default clang hid it completely.
  **Build engine binaries in one pinned container, commit exactly what it
  produces, and have CI rebuild and diff them** (`.github/workflows/engines.yml`).
- SDL's Emscripten backend hardcodes the canvas selector `#canvas` and derives
  its backing store from the element's CSS size times `devicePixelRatio`. Set
  the CSS size only, never `canvas.width/height`, and dispatch a `resize`
  event when your container changes.
- Point `SDL_EMSCRIPTEN_KEYBOARD_ELEMENT` at the canvas so key events reach the
  game only while it has focus, and never leak into the rest of the view.
- Emscripten's `MODULARIZE=1` with `EXPORT_NAME` gives you a factory instead of
  a global; if you ship several engines they may share one export name, so key
  your loader cache on the script URL and capture the factory in the script's
  own `onload`.

---

Found something wrong, or a fact worth adding? Open an issue or a pull request.
These notes are part of [Mustry Doom](../README.md), a free module by
[Mustry Solutions](https://mustrysolutions.com?utm_source=github&utm_medium=sdknotes&utm_campaign=doom)
— we build Ignition modules as products and to order.
