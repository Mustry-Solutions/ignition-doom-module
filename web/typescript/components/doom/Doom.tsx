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
    base64ToBytes, buildArgs, bytesToBase64, clampInt, CODE_ERROR, CODE_GAME_STARTED, DEFAULT_PLAY_LABEL, diffControls,
    DoomControls, DoomStats, engineSize, heldKeys, isFatalLine, isValidSlot, MAX_SAVE_BYTES, parseEngineLine, PAUSE_KEY,
    arenaKey, Phase, PixelSize, readStats, relayUrl, SAVE_DIR, saveDescription, saveSlotPath, statWrites, ZERO_STATS
} from './doomLogic';
import { DoomSavesState, DoomStoreDelegate } from './doomSaves';
import {
    CANVAS_ID, claimEngine, dispatchKey, DoomModule, ENGINE_PATH, KEYBOARD_ELEMENT, loadEngine, pressKey, releaseEngine
} from './doomEngine';
import { DoomProps, mapDoomProps } from './doomProps';

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

    constructor(props: ComponentProps<DoomProps, DoomSavesState>) {
        super(props);
        this.state = { phase: 'idle', message: '', focused: false };
    }

    componentDidMount(): void {
        this.writeOutputs('idle', '');
        if (this.props.props.config.persistSaves) {
            this.saves()?.requestSlots();
        }
        if (this.props.props.config.autoStart) {
            this.start();
        }
    }

    componentDidUpdate(prev: ComponentProps<DoomProps, DoomSavesState>): void {
        const p = this.props.props;
        if (p.config.autoStart && !prev.props.config.autoStart && !this.started) {
            this.start();
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
            this.saves()?.publishTelemetry(this.props.props.config.player, this.module !== null, changed);
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

    private start = (): void => {
        if (this.started || !this.canvas) {
            return;
        }
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
        // A netgame needs a relay ticket from the gateway (admission control);
        // fetch it alongside the engine so main() can start with the URL.
        const ticket: Promise<string | undefined> = cfg0.multiplayer === 'off'
            ? Promise.resolve(undefined)
            : (this.saves()?.requestTicket(arenaKey(cfg0.arena), cfg0.player)
                ?? Promise.reject(new Error('no gateway delegate: cannot join a netgame')));
        Promise.all([loadEngine(), ticket])
            .then(([factory, relayTicket]) => factory({
                canvas,
                noInitialRun: true,
                locateFile: (path) => ENGINE_PATH + path,
                print: this.onStdout,
                printErr: this.onStderr,
                preRun: [(m) => {
                    // Keyboard only while the canvas is focused — never the whole page.
                    m.ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = KEYBOARD_ELEMENT;
                    m.FS.createPreloadedFile('', 'doom1.wad', ENGINE_PATH + 'doom1.wad', true, true);
                    m.FS.createPreloadedFile('', 'default.cfg', ENGINE_PATH + 'default.cfg', true, true);
                    // Save games: restore the user's slots from the gateway into the
                    // -savedir directory so Doom's Load Game menu lists them.
                    m.FS.mkdir(SAVE_DIR);
                    this.restoreSlots(m);
                }],
                onDoomSaveGame: (slot: number) => this.onSaveGame(slot),
                onExit: () => this.onExit(),
                onAbort: (what) => this.onFatal(`Engine aborted: ${String(what)}`)
            }).then((m) => [m, relayTicket] as const))
            .then(([m, relayTicket]) => {
                this.module = m;
                this.watchTitle();
                const cfg = this.props.props.config;
                const relay = cfg.multiplayer === 'off' ? undefined : relayUrl(cfg, window.location, relayTicket);
                m.callMain(buildArgs(cfg, size, relay));
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

    private restoreSlots(m: DoomModule): void {
        if (!this.props.props.config.persistSaves) {
            return;
        }
        const slots = (this.props.delegate && this.props.delegate.slots) || [];
        for (const s of slots) {
            if (!s.data || !isValidSlot(s.slot)) {
                continue;
            }
            try {
                m.FS.writeFile(saveSlotPath(s.slot), base64ToBytes(s.data));
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
        let bytes: Uint8Array;
        try {
            bytes = m.FS.readFile(saveSlotPath(slot));
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
            saves.putSlot(slot, description, bytesToBase64(bytes));
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
