import * as React from 'react';
import {
    AbstractUIElementStore,
    Component,
    ComponentMeta,
    ComponentProps,
    ComponentStoreDelegate,
    PComponent,
    PropertyTree,
    Size2d
} from '@inductiveautomation/perspective-client';
import {
    base64ToBytes, buildArgs, bundledFiles, bytesToBase64, clampInt, CODE_ERROR, CODE_GAME_STARTED, DEFAULT_PLAY_LABEL, diffControls,
    DoomControls, DoomStats, engineSize, GameDef, GameFiles, GameMode, GAMES, heldKeys, isBundledIwad, isFatalLine, isValidSlot, MAX_SAVE_BYTES, requestedIwad,
    normGame, parseEngineLine, PAUSE_KEY, arenaKey, Phase, PixelSize, planWads, readStats, relayUrl, SAVE_DIR, saveDescription, saveSlotPath,
    belongsToSlot, slotFileNames, statWrites, wadFileName, wadGameMode, wadKey, ZERO_STATS
} from './doomLogic';
import { DoomSavesState, DoomStoreDelegate, WadAccess } from './doomSaves';
import {
    CANVAS_ID, claimEngine, dispatchKey, DoomModule, fetchWad, KEYBOARD_ELEMENT, loadEngine, pressKey, releaseEngine
} from './doomEngine';
import { DoomProps, mapDoomProps } from './doomProps';

/** Operator WADs resolved and downloaded for one engine start. */
interface PreparedWads {
    game: GameFiles;
    /** Files to write into the engine's filesystem before main(): [name, bytes]. */
    files: Array<[string, Uint8Array]>;
    /** Keys the gateway reported in its wads folder. */
    available: string[];
    error: string;
}

function bundledWads(game: GameDef): PreparedWads {
    return { game: bundledFiles(game), files: [], available: [], error: '' };
}

/** What a netgame is keyed on; a change after start means the engine is in the wrong game. */
function netIdentity(cfg: { multiplayer: string; arena: string; player: string }): string {
    return `${cfg.multiplayer}|${arenaKey(cfg.arena)}|${cfg.player}`;
}

/** Which game and WADs the engine runs; the same reused-store race applies (a bound game/iwad landing after start). */
function wadIdentity(cfg: { game: string; iwad: string; pwads: string[] }): string {
    const game = GAMES[normGame(cfg.game)];
    const pwads = (Array.isArray(cfg.pwads) ? cfg.pwads : []).map((p) => wadKey(p)).filter((k) => k !== null);
    return `${game.id}|${isBundledIwad(cfg.iwad, game) ? game.bundledIwad : wadKey(cfg.iwad)}|${pwads.join(',')}`;
}

// Must match Doom.COMPONENT_ID on the Java side.
export const COMPONENT_TYPE = 'mustrysolutions.perspective.fun.doom';

interface DoomState {
    phase: Phase;
    message: string;
    focused: boolean;
}

/**
 * Doom in a Perspective view. The engine (Chocolate Doom → WebAssembly) draws
 * on a canvas the component owns; the component only starts it, feeds it keys
 * (physical keyboard when the canvas is focused, synthetic ones from
 * data.controls) and mirrors its stdout into output.*/
export class Doom extends Component<ComponentProps<DoomProps, DoomSavesState>, DoomState> {

    private canvas: HTMLCanvasElement | null = null;
    private frame: HTMLDivElement | null = null;
    private frameObserver: ResizeObserver | null = null;
    private module: DoomModule | null = null;
    private started = false;
    private quitting = false;
    private enginePaused = false;
    private appliedControls: DoomControls | null = null;
    private titleObserver: MutationObserver | null = null;
    private pageTitle = '';
    private statsTimer: number | null = null;
    private lastStats: DoomStats | null = null;
    private unmounting = false;
    /** A start was asked for while bindings were still settling. */
    private startRequested = false;
    /** Set once a props update arrived after mount (or when nothing is bound). */
    private propsSettled = false;
    private settleTimer: number | null = null;
    /** The netgame identity the running engine was started with. */
    private startedNet: string | null = null;
    private startedWads: string | null = null;
    /** The game and WADs the running engine was started with (saves are keyed by its IWAD). */
    private gameDef: GameDef = GAMES.doom;
    private game: GameFiles = bundledFiles(GAMES.doom);

    constructor(props: ComponentProps<DoomProps, DoomSavesState>) {
        super(props);
        this.state = { phase: 'idle', message: '', focused: false };
    }

    componentDidMount(): void {
        this.writeOutputs('idle', '');
        // Bound config props that resolve to their current value never produce
        // an update; after this window we treat the bindings as settled.
        this.settleTimer = window.setTimeout(() => {
            this.settleTimer = null;
            this.propsSettled = true;
            if (this.startRequested && !this.started) {
                this.start();
            }
        }, 1500);
        if (this.props.props.config.persistSaves) {
            this.saves()?.requestSlots(this.saveGame(this.props.props.config.iwad, GAMES[normGame(this.props.props.config.game)]));
        }
        if (this.props.props.config.autoStart) {
            this.start();
        }
    }

    componentDidUpdate(prev: ComponentProps<DoomProps, DoomSavesState>): void {
        const p = this.props.props;
        if (p !== prev.props) {
            this.propsSettled = true;
        }
        if (p.config.autoStart && !prev.props.config.autoStart && !this.started) {
            this.start();
        }
        // Retry a deferred start only when the props object itself changed
        // (a binding delivered), never on our own setState round-trips.
        if (this.startRequested && !this.started && p !== prev.props) {
            this.start();
        }
        // A netgame started on stale props (a reused store rendered once with
        // the previous view's values) would sit in the wrong arena or role.
        // When the bindings then deliver a different identity, restart on it.
        if (this.started && this.startedNet !== null && p !== prev.props) {
            const now = netIdentity(p.config);
            if (now !== this.startedNet) {
                this.quit('Restarting for ' + now);
                this.startRequested = true;
                this.start();
            }
        }
        // Likewise a bound config.iwad / config.pwads that lands after the
        // engine started: restart on the WADs the view actually asked for.
        if (this.started && this.startedWads !== null && p !== prev.props) {
            const now = wadIdentity(p.config);
            if (now !== this.startedWads) {
                this.quit('Restarting with ' + now.split('|').slice(0, 2).join(' '));
                this.startRequested = true;
                this.start();
            }
        }
        const d = this.props.delegate;
        const pd = prev.delegate;
        if (d && (!pd || d.slots !== pd.slots || d.owner !== pd.owner)) {
            this.props.store.props.write('output.savedSlots', d.slots.length);
            this.props.store.props.write('output.saveOwner', d.owner);
        }
        if (d && (!pd || d.player !== pd.player)) {
            this.props.store.props.write('output.player', d.player);
        }
        // state.running is two-way: a binding flipping it starts or quits the
        // engine; the component writes it back as the engine comes and goes.
        if (p.running && !prev.props.running && !this.started) {
            this.start();
        } else if (!p.running && prev.props.running && this.started) {
            this.quit('Stopped');
        }
        if (this.state.phase === 'running' || this.state.phase === 'paused') {
            this.applyControls(p.controls);
            if (p.paused !== this.enginePaused) {
                this.setPaused(p.paused);
            }
        }
    }

    componentWillUnmount(): void {
        this.unmounting = true;
        if (this.settleTimer !== null) {
            window.clearTimeout(this.settleTimer);
            this.settleTimer = null;
        }
        this.unwatchFrame();
        this.stopStats();
        this.quit();
    }

    // --- live telemetry -------------------------------------------------------
    // The engine exports Mustry_Stat(id) (see engine/patches); poll it a few
    // times a second and mirror changed values into output.* so they can be
    // bound to tags and historized. Zeroed when the engine stops.

    private startStats(): void {
        this.stopStats();
        const interval = clampInt(this.props.props.config.statsIntervalMs, 100, 5000, 250);
        this.statsTimer = window.setInterval(this.pollStats, interval);
        this.pollStats();
    }

    private stopStats(): void {
        if (this.statsTimer !== null) {
            window.clearInterval(this.statsTimer);
            this.statsTimer = null;
        }
        if (this.lastStats) {
            this.publishStats(ZERO_STATS);
        }
    }

    private pollStats = (): void => {
        const m = this.module;
        if (!m) {
            return;
        }
        let stats: DoomStats;
        try {
            stats = readStats((id) => m.ccall('Mustry_Stat', 'number', ['number'], [id]) as number);
        } catch {
            return;
        }
        this.publishStats(stats);
    };

    private publishStats(stats: DoomStats): void {
        const w = this.props.store.props;
        const writes = statWrites(this.lastStats, stats);
        for (const [path, value] of writes) {
            w.write(path, value);
        }
        this.lastStats = { ...stats };
        // The gateway mirrors these into its own [Doom] tag provider; only the
        // changed keys travel, and a zeroed snapshot when the engine stops.
        if (writes.length > 0 && this.props.props.config.publishTelemetry) {
            const changed: Record<string, number | boolean> = {};
            for (const [path, value] of writes) {
                changed[path.replace(/^output\./, '')] = value;
            }
            this.saves()?.publishTelemetry(this.props.props.config.player, this.module !== null, changed, this.gameDef.id);
        }
    }

    // --- sizing -----------------------------------------------------------------
    // SDL's Emscripten backend owns the canvas: it sets the CSS size to the
    // engine window and the backing store to that times devicePixelRatio, and
    // it re-reads the CSS size on a window resize event. So we never touch
    // canvas.width/height; we set the CSS size to the frame's box and, on frame
    // changes, nudge SDL with a resize event so it resizes its own backing store
    // (the same path a browser window resize takes).

    private frameSize(): PixelSize {
        return engineSize(this.frame ? this.frame.clientWidth : 0, this.frame ? this.frame.clientHeight : 0);
    }

    private syncCanvasSize(): PixelSize {
        const size = this.frameSize();
        if (this.canvas) {
            this.canvas.style.width = `${size.width}px`;
            this.canvas.style.height = `${size.height}px`;
        }
        return size;
    }

    private watchFrame(): void {
        if (this.frameObserver || !this.frame || typeof ResizeObserver === 'undefined') {
            return;
        }
        this.frameObserver = new ResizeObserver(() => {
            this.syncCanvasSize();
            window.dispatchEvent(new Event('resize'));
        });
        this.frameObserver.observe(this.frame);
    }

    private unwatchFrame(): void {
        if (this.frameObserver) {
            this.frameObserver.disconnect();
            this.frameObserver = null;
        }
    }

    // --- lifecycle ------------------------------------------------------------

    /**
     * True until the view's config bindings have had a chance to apply. A
     * bound config prop (declared in the view's propConfig) delivers through
     * a props update; Perspective can hand a reused component store to a new
     * view and render it once with the previous values before that update
     * arrives, and starting on those would launch the engine as the wrong
     * role, in the wrong arena, as the wrong player. Views with no bound
     * config props are never held back. A settle timer bounds the wait for
     * bindings that resolve to the same value and thus never trigger an
     * update.
     */
    private bindingsPending(): boolean {
        if (this.propsSettled) {
            return false;
        }
        try {
            const store = this.props.store as unknown as { def?: { propConfig?: Record<string, { binding?: unknown }> } };
            const cfgs = (store.def && store.def.propConfig) || {};
            const bound = Object.keys(cfgs).some((k) => k.startsWith('props.config.') && !!(cfgs[k] && cfgs[k].binding));
            if (!bound) {
                this.propsSettled = true;
            }
        } catch {
            this.propsSettled = true;
        }
        return !this.propsSettled;
    }

    private start = (): void => {
        if (this.started || !this.canvas) {
            return;
        }
        if (this.bindingsPending()) {
            // Bindings still settling: retry once they deliver (componentDidUpdate
            // calls start() again when the props change, or the settle timer fires).
            if (!this.startRequested) {
                this.startRequested = true;
                this.setMessage('waiting for bindings');
            }
            return;
        }
        this.startRequested = false;
        this.startedNet = this.props.props.config.multiplayer === 'off' ? null : netIdentity(this.props.props.config);
        this.startedWads = wadIdentity(this.props.props.config);
        if (!claimEngine(this)) {
            this.setPhase('busy', 'Another Doom component already owns this page. One marine per tab.');
            return;
        }
        this.started = true;
        this.quitting = false;
        this.enginePaused = false;
        this.setPhase('loading', 'Loading engine…');
        this.props.store.props.write('state.running', true);
        const canvas = this.canvas;
        const size = this.syncCanvasSize();
        this.pageTitle = document.title;
        const cfg0 = this.props.props.config;
        const gameDef = GAMES[normGame(cfg0.game)];
        // A netgame needs a relay ticket from the gateway (admission control);
        // fetch it alongside the engine so main() can start with the URL.
        const ticket: Promise<string | undefined> = cfg0.multiplayer === 'off'
            ? Promise.resolve(undefined)
            : (this.saves()?.requestTicket(arenaKey(cfg0.arena), cfg0.player)
                ?? Promise.reject(new Error('no gateway delegate: cannot join a netgame')));
        // Operator-supplied WADs are fetched alongside the engine; the plan
        // decides what actually runs (shareware when the IWAD is not there).
        const wads: Promise<PreparedWads> = this.prepareWads(cfg0, gameDef);
        Promise.all([loadEngine(gameDef), ticket, wads])
            .then(([factory, relayTicket, prepared]) => {
                // A game without a bundled IWAD and none on the gateway has nothing
                // to preload: stop before the module exists, not after a 404.
                if (prepared.game.iwad === '') {
                    throw new Error(prepared.error || `${gameDef.title} has no IWAD to run`);
                }
                return factory({
                canvas,
                noInitialRun: true,
                locateFile: (path) => gameDef.enginePath + path,
                print: this.onStdout,
                printErr: this.onStderr,
                preRun: [(m) => {
                    // Keyboard only while the canvas is focused — never the whole page.
                    m.ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = KEYBOARD_ELEMENT;
                    if (prepared.game.iwad === gameDef.bundledIwad) {
                        const iwad = wadFileName(gameDef.bundledIwad);
                        m.FS.createPreloadedFile('', iwad, gameDef.enginePath + iwad, true, true);
                    }
                    for (const [name, bytes] of prepared.files) {
                        m.FS.writeFile('/' + name, bytes);
                    }
                    m.FS.createPreloadedFile('', gameDef.configFile, gameDef.enginePath + gameDef.configFile, true, true);
                    // Save games: restore the user's slots from the gateway into the
                    // -savedir directory so the game's Load Game menu lists them.
                    m.FS.mkdir(SAVE_DIR);
                    if (gameDef.slotDir) {
                        for (let i = 0; i < 7; i++) {
                            try { m.FS.mkdir(`${SAVE_DIR}/${gameDef.slotDir(i)}`); } catch { /* exists */ }
                        }
                    }
                    this.restoreSlots(m, this.saveGame(prepared.game.iwad, gameDef), gameDef);
                }],
                onDoomSaveGame: (slot: number) => this.onSaveGame(slot),
                onExit: () => this.onExit(),
                onAbort: (what) => this.onFatal(`Engine aborted: ${String(what)}`)
            }).then((m) => [m, relayTicket, prepared] as const);
            })
            .then(([m, relayTicket, prepared]) => {
                this.module = m;
                this.gameDef = gameDef;
                this.game = prepared.game;
                this.watchTitle();
                // Same snapshot the ticket was issued for: a binding-driven arena
                // that changes between the request and main() must not produce
                // a ticket for one arena and a URL for another.
                const relay = cfg0.multiplayer === 'off' ? undefined : relayUrl(cfg0, window.location, relayTicket);
                m.callMain(buildArgs(cfg0, size, relay, prepared.game));
                this.watchFrame();
                // Chocolate Doom is up as soon as main returns to the browser loop;
                // the protocol's "game started" (10) confirms the first tic ran.
                this.setPhase('running', 'Running');
                this.startStats();
                this.appliedControls = null;
                this.applyControls(this.props.props.controls);
                if (this.props.props.paused) {
                    this.setPaused(true);
                }
            })
            .catch((e) => this.onFatal(String(e && (e as Error).message || e)));
    };

    // --- operator-supplied WADs ---------------------------------------------------

    /**
     * The save-game key for an IWAD: "" for Doom's bundled shareware (the
     * gateway's original layout), else the WAD key, so Heretic's shareware
     * saves live in their own game-heretic1 folder like any other IWAD.
     */
    private saveGame(iwad: string, game: GameDef): string {
        const key = isBundledIwad(iwad, game) ? game.bundledIwad : requestedIwad(iwad, game);
        return key === GAMES.doom.bundledIwad ? '' : key;
    }

    /**
     * Resolve config.iwad / config.pwads: ask the delegate what the gateway has
     * (and for a download ticket), fetch what the plan needs, sniff the IWAD's
     * game mode for -warp, and list the right save slots. Never rejects: the
     * bundled game with output.wadError set is the worst case.
     */
    private prepareWads(cfg: { iwad: string; pwads: string[]; persistSaves: boolean }, game: GameDef): Promise<PreparedWads> {
        const wanted = !isBundledIwad(cfg.iwad, game) || cfg.pwads.some((p) => typeof p === 'string' && p.trim() !== '');
        if (!wanted) {
            const bundled = bundledWads(game);
            this.writeWadOutputs(bundled);
            return Promise.resolve(bundled);
        }
        const saves = this.saves();
        const access: Promise<WadAccess | null> = saves ? saves.requestWads().catch(() => null) : Promise.resolve(null);
        return access
            .then((a) => {
                const plan = planWads(cfg, a ? a.wads : null, game);
                const problems = plan.error ? [plan.error] : [];
                const fetched = plan.fetch.map((k) => fetchWad(k, a ? a.ticket : '')
                    .then((bytes) => [k, bytes] as const)
                    .catch((e: Error) => {
                        problems.push(`${wadFileName(k)}: ${e.message}`);
                        return [k, null] as const;
                    }));
                return Promise.all(fetched).then((got) => {
                    let iwad = plan.iwad;
                    let mode: GameMode = 'shareware';
                    let pwads: string[] = [];
                    const companions: string[] = [];
                    const files: Array<[string, Uint8Array]> = [];
                    for (const [k, bytes] of got) {
                        if (!bytes) {
                            if (k === plan.iwad) {
                                problems.push(`${wadFileName(k)} is no longer on the gateway; playing ${game.bundledIwad}`);
                                iwad = game.bundledIwad;
                            } else if (!problems.some((p) => p.startsWith(wadFileName(k)))) {
                                problems.push(`${wadFileName(k)} is no longer on the gateway; skipped`);
                            }
                            continue;
                        }
                        if (k === plan.iwad) {
                            mode = wadGameMode(bytes);
                            files.push([wadFileName(k), bytes]);
                        } else if (plan.companions.includes(k)) {
                            companions.push(k);
                            files.push([wadFileName(k), bytes]);
                        } else {
                            pwads.push(k);
                            files.push([wadFileName(k), bytes]);
                        }
                    }
                    if (game.companions && game.companions.some((c) => !companions.includes(c))) {
                        problems.push(`${game.companions.filter((c) => !companions.includes(c)).map(wadFileName).join(', ')} not in the gateway's wads folder; ${game.title} runs without it (${game.companionMissingArg || ''})`.trim());
                    }
                    if (iwad === game.bundledIwad) {
                        mode = 'shareware';
                    }
                    if (mode === 'shareware' && game.sharewareRefusesPwads && pwads.length > 0) {
                        // D_DoomMain: "You cannot -file with the shareware version. Register!"
                        problems.push(`PWADs need a registered IWAD (the engine refuses -file with shareware data); ${pwads.map(wadFileName).join(', ')} skipped`);
                        pwads = [];
                    }
                    const prepared: PreparedWads = {
                        game: { iwad, pwads, commercial: mode === 'commercial', companions },
                        files: files.filter(([name]) => name === wadFileName(iwad) || pwads.some((k) => wadFileName(k) === name)
                            || companions.some((k) => wadFileName(k) === name)),
                        available: a ? a.wads : [],
                        error: problems.join('; ')
                    };
                    this.writeWadOutputs(prepared);
                    // The slots listed at mount were for the configured game; a
                    // fallback (or a binding that changed since) needs the right ones.
                    const saveKey = this.saveGame(iwad, game);
                    if (cfg.persistSaves && saves && saves.mapStateToProps().slotsIwad !== saveKey) {
                        return saves.loadSlots(saveKey).then(() => prepared);
                    }
                    return prepared;
                });
            });
    }

    private writeWadOutputs(prepared: PreparedWads): void {
        const w = this.props.store.props;
        w.write('output.iwad', prepared.game.iwad);
        w.write('output.wadError', prepared.error);
        w.write('output.availableWads', prepared.available);
        if (prepared.error) {
            this.setMessage(prepared.error);
        }
    }

    /**
     * Ask the engine to shut down (Chocolate Doom's I_Quit → exit()). Emscripten
     * runs onExit synchronously inside the call and then throws ExitStatus, so
     * by the time this returns the component is back in a restartable state.
     */
    private quit(message = 'Engine exited'): void {
        if (this.module && !this.quitting) {
            this.quitting = true;
            this.stopStats();
            try {
                if (this.canvas) {
                    heldKeys(this.props.props.controls).forEach((k) => dispatchKey(this.canvas!, 'keyup', k));
                }
                this.module.ccall('I_Quit', null, [], []);
            } catch {
                // exit() unwinds through here by design (Emscripten throws ExitStatus).
            }
            this.finish('exited', message);
        }
        this.unwatchTitle();
        releaseEngine(this);
    }

    private onExit(): void {
        if (this.quitting) {
            return; // quit() reports the outcome itself
        }
        this.finish('exited', 'Engine exited');
    }

    private onFatal(message: string): void {
        this.finish('error', message);
        this.fire(CODE_ERROR, message);
    }

    /** Common teardown after the engine stops, leaving the component restartable. */
    private finish(phase: 'exited' | 'error', message: string): void {
        this.stopStats();
        this.module = null;
        this.started = false;
        this.startedNet = null;
        this.startedWads = null;
        this.enginePaused = false;
        this.appliedControls = null;
        releaseEngine(this);
        this.unwatchTitle();
        this.unwatchFrame();
        if (this.unmounting) {
            return;
        }
        this.setPhase(phase, message);
        this.props.store.props.write('state.running', false);
    }

    private onStdout = (text: string): void => {
        console.debug(`[doom] ${text}`); // engine stdout, for the browser console at verbose level
        const msg = parseEngineLine(text);
        if (msg.code !== 0) {
            this.fire(msg.code, msg.message);
            if (msg.code === CODE_GAME_STARTED && this.state.phase === 'loading') {
                this.setPhase('running', msg.message);
                return;
            }
        }
        this.setMessage(msg.message);
    };

    private onStderr = (text: string): void => {
        if (isFatalLine(text)) {
            this.onFatal(text);
        } else {
            this.setMessage(text);
        }
    };

    // --- controls -------------------------------------------------------------

    private applyControls(next: DoomControls): void {
        if (!this.canvas || !this.module) {
            return;
        }
        const prev = this.appliedControls || { ...next, weapon: 0, forward: false, backward: false, strafeLeft: false,
            strafeRight: false, turnLeft: false, turnRight: false, fire: false, use: false, run: false, menu: false, confirm: false };
        for (const a of diffControls(prev, next)) {
            if (a.kind === 'press') {
                pressKey(this.canvas, a.def);
            } else {
                dispatchKey(this.canvas, a.kind === 'down' ? 'keydown' : 'keyup', a.def);
            }
        }
        this.appliedControls = { ...next };
    }

    /** Doom's own pause (the PAUSE key toggles it), tracked so state.paused stays two-way. */
    private setPaused(paused: boolean): void {
        if (!this.canvas || !this.module || paused === this.enginePaused) {
            return;
        }
        pressKey(this.canvas, PAUSE_KEY);
        this.enginePaused = paused;
        this.props.store.props.write('state.paused', paused);
        this.setPhase(paused ? 'paused' : 'running', paused ? 'Paused' : 'Running');
    }

    // --- save games -----------------------------------------------------------

    private saves(): DoomStoreDelegate | null {
        const d = this.props.store.delegate;
        return d instanceof DoomStoreDelegate ? d : null;
    }

    private restoreSlots(m: DoomModule, game: string, def: GameDef): void {
        if (!this.props.props.config.persistSaves) {
            return;
        }
        // Read the delegate itself, not this.props.delegate: a listing that
        // arrived during start() may not have rendered yet. Slots of another
        // game are never restored (a Doom II save in shareware is a crash).
        const saves = this.saves();
        const state = saves ? saves.mapStateToProps() : null;
        const slots = state && state.slotsIwad === game ? state.slots : [];
        for (const s of slots) {
            if (!isValidSlot(s.slot)) {
                continue;
            }
            try {
                if (s.files) {
                    // Hexen/Strife: every file of the slot, under the engine's own
                    // names; a folder slot's files carry their folder (Strife).
                    for (const f of s.files) {
                        if (belongsToSlot(def, s.slot, f.name)) {
                            const dir = f.name.includes('/') ? f.name.slice(0, f.name.indexOf('/')) : '';
                            if (dir) {
                                try { m.FS.mkdir(`${SAVE_DIR}/${dir}`); } catch { /* exists */ }
                            }
                            m.FS.writeFile(`${SAVE_DIR}/${f.name}`, base64ToBytes(f.data));
                        }
                    }
                } else if (s.data) {
                    m.FS.writeFile(saveSlotPath(s.slot, def), base64ToBytes(s.data));
                }
            } catch (e) {
                this.setMessage(`Could not restore save slot ${s.slot + 1}: ${String(e)}`);
            }
        }
    }

    /** Engine hook (mustry_stats.c): a slot file was just written. */
    private onSaveGame(slot: number): void {
        const m = this.module;
        if (!m || !isValidSlot(slot)) {
            return;
        }
        // One file for Doom and Heretic; Hexen writes the slot's main file plus
        // one archive per visited hub map, all persisted together.
        let bytes: Uint8Array;
        const files: Array<{ name: string; data: string }> = [];
        try {
            bytes = m.FS.readFile(saveSlotPath(slot, this.gameDef));
            if (this.gameDef.slotFiles || this.gameDef.slotDir) {
                for (const name of slotFileNames(this.gameDef, slot, (p) => m.FS.readdir(p))) {
                    const data = m.FS.readFile(`${SAVE_DIR}/${name}`);
                    if (data.length > MAX_SAVE_BYTES) {
                        this.setMessage(`Save slot ${slot + 1}: ${name} is ${data.length} bytes, too large to persist`);
                        return;
                    }
                    files.push({ name, data: bytesToBase64(data) });
                }
            }
        } catch (e) {
            this.setMessage(`Save slot ${slot + 1} written but unreadable: ${String(e)}`);
            return;
        }
        if (bytes.length > MAX_SAVE_BYTES) {
            this.setMessage(`Save slot ${slot + 1} is ${bytes.length} bytes, too large to persist`);
            return;
        }
        const description = saveDescription(bytes);
        this.props.store.props.write('output.lastSaveSlot', slot + 1);
        this.props.store.props.write('output.lastSaveDescription', description);
        const saves = this.props.props.config.persistSaves ? this.saves() : null;
        const authenticated = !!(this.props.delegate && this.props.delegate.authenticated);
        if (saves && authenticated) {
            const key = this.saveGame(this.game.iwad, this.gameDef);
            if (files.length > 0) {
                saves.putSlotFiles(slot, description, files, key);
            } else {
                saves.putSlot(slot, description, bytesToBase64(bytes), key);
            }
            this.setMessage(`Saved slot ${slot + 1} "${description}" to the gateway`);
        } else if (saves) {
            this.setMessage(`Saved slot ${slot + 1} "${description}" (this tab only: log in to keep saves on the gateway)`);
        } else {
            this.setMessage(`Saved slot ${slot + 1} "${description}" (this tab only)`);
        }
    }

    // --- page title guard -----------------------------------------------------
    // SDL sets document.title to the window title ("DOOM Shareware - ...").
    // Perspective owns the tab title; put it back whenever the engine changes it.

    private watchTitle(): void {
        const el = document.querySelector('head > title');
        if (!el || this.titleObserver) {
            return;
        }
        this.titleObserver = new MutationObserver(() => {
            if (document.title !== this.pageTitle && /doom/i.test(document.title)) {
                document.title = this.pageTitle;
            }
        });
        this.titleObserver.observe(el, { childList: true, characterData: true, subtree: true });
    }

    private unwatchTitle(): void {
        if (this.titleObserver) {
            this.titleObserver.disconnect();
            this.titleObserver = null;
            if (this.pageTitle && /doom/i.test(document.title)) {
                document.title = this.pageTitle;
            }
        }
    }

    // --- state / outputs / events -------------------------------------------

    private setPhase(phase: Phase, message: string): void {
        this.setState({ phase, message });
        this.writeOutputs(phase, message);
    }

    private setMessage(message: string): void {
        this.setState({ message });
        this.props.store.props.write('output.message', message);
    }

    private writeOutputs(phase: Phase, message: string): void {
        const w = this.props.store.props;
        w.write('output.state', phase);
        w.write('output.message', message);
        if (phase === 'idle') {
            w.write('output.iwad', '');
            w.write('output.wadError', '');
        }
    }

    private fire(code: number, message: string): void {
        this.props.componentEvents.fireComponentEvent('onGameEvent', { code, message });
    }

    // --- keyboard gating ------------------------------------------------------
    // With config.keyboard off, real key events must not reach SDL's listener on
    // the canvas; synthetic ones (isTrusted false) still may.

    private onCanvasKey = (e: React.KeyboardEvent<HTMLCanvasElement>): void => {
        if (!this.props.props.config.keyboard && e.nativeEvent.isTrusted) {
            e.stopPropagation();
            e.preventDefault();
        }
    };

    private setCanvas = (el: HTMLCanvasElement | null): void => {
        this.canvas = el;
    };

    private setFrame = (el: HTMLDivElement | null): void => {
        this.frame = el;
    };

    // --- render -----------------------------------------------------------------

    render() {
        const cfg = this.props.props.config;
        const { phase, message, focused } = this.state;
        const classes = ['mustry-doom', `mustry-doom--${phase}`];
        if (cfg.pixelated) {
            classes.push('mustry-doom--pixelated');
        }
        const showSplash = phase === 'idle';
        const label = cfg.playLabel.trim() !== '' ? cfg.playLabel : DEFAULT_PLAY_LABEL;
        return (
            <div {...this.props.emit({ classes })}>
                <div className="mustry-doom__frame" ref={this.setFrame}>
                    <canvas
                        ref={this.setCanvas}
                        id={CANVAS_ID}
                        className="mustry-doom__canvas"
                        tabIndex={cfg.keyboard ? 0 : -1}
                        onKeyDownCapture={this.onCanvasKey}
                        onKeyUpCapture={this.onCanvasKey}
                        onFocus={() => this.setState({ focused: true })}
                        onBlur={() => this.setState({ focused: false })}
                        onContextMenu={(e) => e.preventDefault()}
                    />
                    {showSplash && (
                        <button type="button" className="mustry-doom__splash" onClick={this.start}>
                            <span className="mustry-doom__splash-title">DOOM</span>
                            <span className="mustry-doom__splash-label">{label}</span>
                            <span className="mustry-doom__splash-hint">Shareware episode · 1993 · runs on your gateway</span>
                        </button>
                    )}
                    {(phase === 'busy' || phase === 'error' || phase === 'exited') && (
                        <div className="mustry-doom__overlay">
                            <span className="mustry-doom__overlay-title">{phase === 'error' ? 'Engine error' : phase === 'busy' ? 'Busy' : 'Exited'}</span>
                            <span className="mustry-doom__overlay-text">{message}</span>
                            {phase !== 'busy' && (
                                <button type="button" className="mustry-doom__restart" onClick={this.start}>Restart</button>
                            )}
                        </div>
                    )}
                </div>
                {cfg.showHud && (
                    <div className="mustry-doom__hud">
                        <span className={`mustry-doom__dot mustry-doom__dot--${phase}`} />
                        <span className="mustry-doom__state">{phase}</span>
                        <span className="mustry-doom__message" title={message}>{message}</span>
                        {cfg.keyboard && (phase === 'running' || phase === 'paused') && (
                            <span className="mustry-doom__focus">{focused ? 'keyboard: game' : 'click the game to give it the keyboard'}</span>
                        )}
                    </div>
                )}
            </div>
        );
    }
}

export class DoomMeta implements ComponentMeta {

    getComponentType(): string {
        return COMPONENT_TYPE;
    }

    getViewComponent(): PComponent {
        return Doom as unknown as PComponent;
    }

    getDefaultSize(): Size2d {
        return { width: 640, height: 428 };
    }

    getPropsReducer(tree: PropertyTree): DoomProps {
        return mapDoomProps(tree);
    }

    createDelegate(component: AbstractUIElementStore): ComponentStoreDelegate {
        return new DoomStoreDelegate(component);
    }
}
