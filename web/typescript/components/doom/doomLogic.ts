// Pure logic for the Doom component: engine arguments, the stdout protocol,
// key definitions and control diffing. No DOM, no perspective-client — node-tested.

export interface DoomConfig {
    /** Which engine and shareware episode: 'doom' (default) or 'heretic'. */
    game: GameId;
    autoStart: boolean;
    statsIntervalMs: number;
    persistSaves: boolean;
    player: string;
    publishTelemetry: boolean;
    multiplayer: Multiplayer;
    arena: string;
    players: number;
    deathmatch: NetRules;
    relayUrl: string;
    sound: boolean;
    music: boolean;
    /** Operator-supplied IWAD key ("" = the bundled shareware doom1.wad). */
    iwad: string;
    /** Operator-supplied PWAD keys, loaded in order after the IWAD. */
    pwads: string[];
    /** Hexen: fighter, cleric or mage. */
    playerClass: string;
    skill: number;
    warp: boolean;
    episode: number;
    map: number;
    keyboard: boolean;
    mouse: boolean;
    pixelated: boolean;
    showHud: boolean;
    playLabel: string;
    extraArgs: string;
}

// --- the games --------------------------------------------------------------
// Everything that differs between the Chocolate Doom family members lives in
// this table; the component never spells out a game's file names elsewhere.

export type GameId = 'doom' | 'heretic' | 'hexen' | 'strife';

export interface GameDef {
    id: GameId;
    title: string;
    /** Where the gateway serves this game's engine, IWAD and config. */
    enginePath: string;
    script: string;
    /**
     * The freely redistributable shareware IWAD that ships in the module (a WAD
     * key), or "" when the module ships none and the operator must supply
     * knownIwads[0] in the gateway's wads folder (Hexen: its demo carries no
     * redistribution grant).
     */
    bundledIwad: string;
    /** The vanilla config file the engine reads (-config). */
    configFile: string;
    /**
     * IWAD file names the engine accepts (d_iwad.c): Chocolate Doom identifies
     * an IWAD by NAME and refuses anything else as "Unknown or invalid IWAD file".
     */
    knownIwads: readonly string[];
    /** The slot file the engine writes into -savedir (the main one for multi-file games). */
    saveFile(slot: number): string;
    /**
     * Every file of a slot, when the engine keeps one per visited map next to
     * the main file (Hexen: hex<N>.hxs + hex<N><map>.hxs). Absent = one file.
     */
    slotFiles?: RegExp | ((slot: number) => RegExp);
    /** The slot is a whole folder under -savedir (Strife: strfsav<N>.ssg/ with name, mis_obj, one file per map). */
    slotDir?(slot: number): string;
    /** Companion WADs fetched from the wads folder when present, not passed with -file (Strife: voices.wad). */
    companions?: readonly string[];
    /** The engine argument when a companion is missing. */
    companionMissingArg?: string;
    /** The engine takes -class 0/1/2 (Hexen). */
    playerClasses?: readonly string[];
    /** The engine has -altdeath (Doom II rules); Heretic only has -deathmatch. */
    altdeath: boolean;
    /** The engine refuses -file with the shareware IWAD ("Register!"). Doom does, Heretic does not. */
    sharewareRefusesPwads: boolean;
    /** Highest episode -warp accepts. */
    maxEpisode: number;
}

export const GAMES: Record<GameId, GameDef> = {
    doom: {
        id: 'doom',
        title: 'Doom',
        enginePath: '/res/mustry-doom/doom/',
        script: 'websockets-doom.js',
        bundledIwad: 'doom1',
        configFile: 'default.cfg',
        knownIwads: ['doom', 'doom1', 'doom2', 'plutonia', 'tnt', 'chex', 'hacx', 'freedm', 'freedoom1', 'freedoom2'],
        saveFile: (slot) => `doomsav${slot}.dsg`,
        altdeath: true,
        sharewareRefusesPwads: true,
        maxEpisode: 4
    },
    heretic: {
        id: 'heretic',
        title: 'Heretic',
        enginePath: '/res/mustry-doom/heretic/',
        script: 'websockets-heretic.js',
        bundledIwad: 'heretic1',
        configFile: 'heretic.cfg',
        knownIwads: ['heretic', 'heretic1'],
        saveFile: (slot) => `hticsav${slot}.hsg`,
        altdeath: false,
        sharewareRefusesPwads: false,
        maxEpisode: 5
    },
    hexen: {
        id: 'hexen',
        title: 'Hexen',
        enginePath: '/res/mustry-doom/hexen/',
        script: 'websockets-hexen.js',
        bundledIwad: '',
        configFile: 'hexen.cfg',
        knownIwads: ['hexen'],
        saveFile: (slot) => `hex${slot}.hxs`,
        slotFiles: (slot) => new RegExp(`^hex${slot}(\\d\\d)?\\.hxs$`),
        playerClasses: ['fighter', 'cleric', 'mage'],
        altdeath: false,
        sharewareRefusesPwads: false,
        maxEpisode: 1
    },
    strife: {
        id: 'strife',
        title: 'Strife',
        enginePath: '/res/mustry-doom/strife/',
        script: 'websockets-strife.js',
        bundledIwad: '',
        configFile: 'strife.cfg',
        knownIwads: ['strife1'],
        saveFile: (slot) => `strfsav${slot}.ssg/name`,
        slotDir: (slot) => `strfsav${slot}.ssg`,
        companions: ['voices'],
        companionMissingArg: '-novoice',
        altdeath: true,
        sharewareRefusesPwads: false,
        maxEpisode: 1
    }
};

/**
 * The files that make up one save slot, relative to -savedir, given a way to
 * list a directory. One file, a name pattern in -savedir (Hexen) or a whole
 * folder (Strife); a folder's files come back as "<dir>/<name>".
 */
export function slotFileNames(game: GameDef, slot: number, readdir: (path: string) => string[]): string[] {
    if (game.slotDir) {
        const dir = game.slotDir(slot);
        return readdir(`${SAVE_DIR}/${dir}`).filter((n) => n !== '.' && n !== '..').sort().map((n) => `${dir}/${n}`);
    }
    if (!game.slotFiles) {
        return [game.saveFile(slot)];
    }
    const re = typeof game.slotFiles === 'function' ? game.slotFiles(slot) : game.slotFiles;
    return readdir(SAVE_DIR).filter((n) => re.test(n)).sort();
}

/** Does a persisted file name belong to this slot? Guards a restore against a mislabelled listing. */
export function belongsToSlot(game: GameDef, slot: number, name: string): boolean {
    if (game.slotDir) {
        return name.startsWith(game.slotDir(slot) + '/') && !name.slice(game.slotDir(slot).length + 1).includes('/');
    }
    if (!game.slotFiles) {
        return name === game.saveFile(slot);
    }
    const re = typeof game.slotFiles === 'function' ? game.slotFiles(slot) : game.slotFiles;
    return re.test(name);
}

/** -class for the engines that take one; -1 when not applicable or unknown. */
export function playerClassIndex(game: GameDef, name: string): number {
    if (!game.playerClasses) {
        return -1;
    }
    const i = game.playerClasses.indexOf((name || '').trim().toLowerCase());
    return i < 0 ? 0 : i;
}

export function normGame(s: unknown): GameId {
    return s === 'heretic' || s === 'hexen' || s === 'strife' ? s : 'doom';
}

export type Multiplayer = 'off' | 'host' | 'join';
export type NetRules = 'coop' | 'deathmatch' | 'altdeath';

export function normMultiplayer(s: string): Multiplayer {
    return s === 'host' || s === 'join' ? s : 'off';
}

export function normNetRules(s: string): NetRules {
    return s === 'coop' || s === 'altdeath' ? s : 'deathmatch';
}

/** A folder/URL-safe arena name; empty or junk falls back to "default". */
export function arenaKey(raw: string): string {
    const s = (raw || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
    return s === '' || s.startsWith('.') ? 'default' : s.slice(0, 64);
}

/**
 * The relay's WebSocket URL for an arena, derived from the page's own origin
 * (the gateway that serves the session), unless overridden.
 */
export function relayUrl(cfg: { relayUrl: string; arena: string }, location: { protocol: string; host: string }, ticket?: string): string {
    const override = (cfg.relayUrl || '').trim();
    const base = override !== ''
        ? override.replace(/\/+$/, '') + '/' + arenaKey(cfg.arena)
        : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/system/doom-relay/${arenaKey(cfg.arena)}`;
    return ticket ? `${base}?ticket=${encodeURIComponent(ticket)}` : base;
}

/** The boolean "hold this key" controls, in schema order. */
export const HOLD_CONTROLS = [
    'forward', 'backward', 'strafeLeft', 'strafeRight', 'turnLeft', 'turnRight',
    'fire', 'use', 'run', 'menu', 'confirm'
] as const;
export type HoldControl = typeof HOLD_CONTROLS[number];

export interface DoomControls extends Record<HoldControl, boolean> {
    /** Weapon slot to select when the value changes (1-7); 0 = no change. */
    weapon: number;
}

export const EMPTY_CONTROLS: DoomControls = {
    forward: false, backward: false, strafeLeft: false, strafeRight: false,
    turnLeft: false, turnRight: false, fire: false, use: false, run: false,
    menu: false, confirm: false, weapon: 0
};

/** A browser key as the engine's SDL layer sees it (key/code/keyCode all set). */
export interface KeyDef {
    key: string;
    code: string;
    keyCode: number;
}

/**
 * The keys behind each control. These MUST agree with the bindings in the
 * shipped default.cfg (engine/README.md) — the tag controls and the physical
 * keyboard drive the very same engine bindings.
 */
export const CONTROL_KEYS: Record<HoldControl, KeyDef> = {
    forward: { key: 'w', code: 'KeyW', keyCode: 87 },
    backward: { key: 's', code: 'KeyS', keyCode: 83 },
    strafeLeft: { key: 'a', code: 'KeyA', keyCode: 65 },
    strafeRight: { key: 'd', code: 'KeyD', keyCode: 68 },
    turnLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    turnRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    fire: { key: ' ', code: 'Space', keyCode: 32 },
    use: { key: 'e', code: 'KeyE', keyCode: 69 },
    run: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
    menu: { key: 'Escape', code: 'Escape', keyCode: 27 },
    confirm: { key: 'Enter', code: 'Enter', keyCode: 13 }
};

export const PAUSE_KEY: KeyDef = { key: 'Pause', code: 'Pause', keyCode: 19 };

export function weaponKey(slot: number): KeyDef | null {
    if (!Number.isInteger(slot) || slot < 1 || slot > 7) {
        return null;
    }
    return { key: String(slot), code: `Digit${slot}`, keyCode: 48 + slot };
}

/** One key transition the component must synthesise. */
export interface KeyAction {
    def: KeyDef;
    /** 'down' / 'up' hold or release; 'press' is a down immediately followed by up. */
    kind: 'down' | 'up' | 'press';
}

/** The key transitions between two control snapshots. */
export function diffControls(prev: DoomControls, next: DoomControls): KeyAction[] {
    const actions: KeyAction[] = [];
    for (const c of HOLD_CONTROLS) {
        if (!!prev[c] !== !!next[c]) {
            actions.push({ def: CONTROL_KEYS[c], kind: next[c] ? 'down' : 'up' });
        }
    }
    if (next.weapon !== prev.weapon) {
        const def = weaponKey(next.weapon);
        if (def) {
            actions.push({ def, kind: 'press' });
        }
    }
    return actions;
}

/** Every control that is currently held — released when the engine stops. */
export function heldKeys(controls: DoomControls): KeyDef[] {
    return HOLD_CONTROLS.filter((c) => !!controls[c]).map((c) => CONTROL_KEYS[c]);
}

/** Fallback engine window size when the frame cannot be measured: 320x200 doubled. */
export const RENDER_WIDTH = 640;
export const RENDER_HEIGHT = 400;

export interface PixelSize {
    width: number;
    height: number;
}

/**
 * The engine's window size for a frame. SDL's Emscripten backend renders at the
 * canvas's CSS size, so the canvas backing store and the window the engine is
 * told about must both equal the frame's box (Doom letterboxes to 4:3 itself).
 */
export function engineSize(frameWidth: number, frameHeight: number): PixelSize {
    const w = Math.floor(frameWidth);
    const h = Math.floor(frameHeight);
    if (!(w >= 64) || !(h >= 40)) {
        return { width: RENDER_WIDTH, height: RENDER_HEIGHT };
    }
    return { width: w, height: h };
}

// --- operator-supplied WADs ---------------------------------------------------
// The module ships doom1.wad only. Other IWADs and PWADs come from the
// gateway's data/modules/com.mustrysolutions.doom/wads/ folder, fetched by the
// page with a ticket from its delegate and written into the engine's in-memory
// filesystem before main(). Keys are case-insensitive names without ".wad".

/** Doom's bundled IWAD key; kept as a name because the gateway's save layout treats it specially. */
export const BUNDLED_IWAD = GAMES.doom.bundledIwad;
/** Where the hook serves operator WADs (see DoomGatewayHook.mountRouteHandlers). */
export const WADS_PATH = '/data/mustry-doom/wads/';
export const WAD_TICKET_HEADER = 'X-Doom-Ticket';

/** A WAD key the gateway understands, or null: one path segment, ".wad" dropped, lower case. */
export function wadKey(raw: unknown): string | null {
    if (typeof raw !== 'string') {
        return null;
    }
    const s = raw.trim();
    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(s)) {
        return null;
    }
    const k = s.toLowerCase().replace(/\.wad$/, '');
    return k === '' ? null : k;
}

/** True when the config asks for the game's bundled IWAD (empty, "doom1", "doom1.wad" or junk). */
export function isBundledIwad(iwad: string, game: GameDef = GAMES.doom): boolean {
    if (game.bundledIwad === '') {
        return false;
    }
    const k = wadKey(iwad);
    return k === null || k === game.bundledIwad;
}

/** The IWAD key a config asks for: the game's bundled one when empty, else the operator's; knownIwads[0] for games without a bundle. */
export function requestedIwad(iwad: string, game: GameDef): string {
    const k = wadKey(iwad);
    if (k !== null) {
        return k;
    }
    return game.bundledIwad || game.knownIwads[0];
}

/** The engine filesystem name for a WAD key. */
export function wadFileName(key: string): string {
    return key + '.wad';
}

export function wadUrl(key: string): string {
    return WADS_PATH + encodeURIComponent(wadFileName(key));
}

/** What the page decided to load, after checking the gateway's list. */
export interface WadPlan {
    /** IWAD key to run, BUNDLED_IWAD when falling back. */
    iwad: string;
    /** PWAD keys to fetch and pass with -file, in order. */
    pwads: string[];
    /** Companion keys (Strife's voices) to fetch and write next to the IWAD, never passed with -file. */
    companions: string[];
    /** Keys that must be fetched from the gateway (the bundled IWAD is preloaded). */
    fetch: string[];
    /** Why the config could not be honoured in full; "" when it could. */
    error: string;
}

/**
 * Resolve config.iwad / config.pwads against what the gateway has. An unknown
 * IWAD falls back to shareware, an unknown PWAD is dropped; both are named in
 * the error so the operator learns it from output.wadError, not a black canvas.
 */
export function planWads(cfg: { iwad: string; pwads: string[] }, available: string[] | null, game: GameDef = GAMES.doom): WadPlan {
    const have = new Set((available || []).map((a) => wadKey(a)).filter((k): k is string => k !== null));
    const problems: string[] = [];
    const bundled = game.bundledIwad;
    // A game without a bundled IWAD has nothing to fall back on: iwad "" then
    // means "cannot start", and the caller reports the error instead of a black canvas.
    const fallback = bundled === '' ? `${game.title} cannot start without it` : `playing ${bundled}`;
    let iwad = bundled;
    if (!isBundledIwad(cfg.iwad, game)) {
        const k = requestedIwad(cfg.iwad, game);
        const shown = wadKey(cfg.iwad) === null ? wadFileName(k) : cfg.iwad;
        if (!game.knownIwads.includes(k)) {
            problems.push(`IWAD "${shown}": the ${game.title} engine only recognises IWADs by their canonical file name (${game.knownIwads.join(', ')}); ${fallback}`);
        } else if (available === null) {
            problems.push(`IWAD "${shown}" needs the gateway channel; ${fallback}`);
        } else if (have.has(k)) {
            iwad = k;
        } else {
            const hint = bundled === '' ? ` (${game.title} ships no IWAD: put ${wadFileName(game.knownIwads[0])} there)` : '';
            problems.push(`IWAD "${shown}" is not in the gateway's wads folder${hint}; ${fallback}`);
        }
    } else if (typeof cfg.iwad === 'string' && cfg.iwad.trim() !== '' && wadKey(cfg.iwad) === null) {
        problems.push(`IWAD "${cfg.iwad}" is not a valid name; ${fallback}`);
    }
    const pwads: string[] = [];
    for (const raw of Array.isArray(cfg.pwads) ? cfg.pwads : []) {
        const k = wadKey(raw);
        if (k === null) {
            if (typeof raw === 'string' && raw.trim() !== '') {
                problems.push(`PWAD "${raw}" is not a valid name; skipped`);
            }
            continue;
        }
        if (available === null) {
            problems.push(`PWAD "${raw}" needs the gateway channel; skipped`);
        } else if (!have.has(k)) {
            problems.push(`PWAD "${raw}" is not in the gateway's wads folder; skipped`);
        } else if (!pwads.includes(k) && k !== iwad) {
            pwads.push(k);
        }
    }
    const companions = (game.companions || []).filter((c) => have.has(c) && c !== iwad);
    const fetch = iwad === bundled || iwad === '' ? [...pwads] : [iwad, ...pwads];
    fetch.push(...companions);
    return { iwad, pwads, companions, fetch, error: problems.join('; ') };
}

/** Chocolate Doom's gamemode, as far as -warp and -file care. */
export type GameMode = 'shareware' | 'registered' | 'retail' | 'commercial';

/** The lump names in a WAD's directory: header [id:4][numlumps:i32][infotableofs:i32], entries [filepos:i32][size:i32][name:8]. */
export function wadLumpNames(bytes: Uint8Array): Set<string> {
    const names = new Set<string>();
    if (bytes.length < 12) {
        return names;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numLumps = view.getInt32(4, true);
    const dirOffset = view.getInt32(8, true);
    if (numLumps <= 0 || dirOffset < 12 || dirOffset + numLumps * 16 > bytes.length) {
        return names;
    }
    for (let i = 0; i < numLumps; i++) {
        const at = dirOffset + i * 16 + 8;
        let name = '';
        for (let c = 0; c < 8 && bytes[at + c] !== 0; c++) {
            name += String.fromCharCode(bytes[at + c]);
        }
        names.add(name.toUpperCase());
    }
    return names;
}

/**
 * How Chocolate Doom will classify an IWAD (D_IdentifyVersion): MAP01 means
 * Doom II ("commercial", -warp takes one number), E4M1 retail, E3M1
 * registered, anything else shareware, which refuses -file outright.
 */
export function wadGameMode(bytes: Uint8Array): GameMode {
    const lumps = wadLumpNames(bytes);
    if (lumps.has('MAP01')) {
        return 'commercial';
    }
    if (lumps.has('E4M1')) {
        return 'retail';
    }
    if (lumps.has('E3M1')) {
        return 'registered';
    }
    return 'shareware';
}

export function wadIsCommercial(bytes: Uint8Array): boolean {
    return wadGameMode(bytes) === 'commercial';
}

/** A fetched WAD: the key and its bytes, or null when the gateway no longer had it. */
export type FetchedWad = readonly [key: string, bytes: Uint8Array | null];

/** What resolveFetched decides: the game files to run, the bytes to write, the complaints. */
export interface ResolvedWads {
    game: GameFiles;
    /** [file name, bytes] to write into the engine's filesystem before main(). */
    files: Array<[string, Uint8Array]>;
    problems: string[];
}

/**
 * Turn what actually arrived from the gateway into the engine's files and
 * command line. Pure, so the rules live in one tested place: an IWAD that
 * vanished falls back to the bundle (or nothing), companions are noted when
 * missing, and PWADs are dropped when the IWAD in play is shareware data the
 * engine refuses -file for. Problems already known from the plan come first.
 */
export function resolveFetched(plan: WadPlan, got: readonly FetchedWad[], game: GameDef, problems: string[] = []): ResolvedWads {
    const out = [...problems];
    let iwad = plan.iwad;
    let mode: GameMode = 'shareware';
    let pwads: string[] = [];
    const companions: string[] = [];
    const files: Array<[string, Uint8Array]> = [];
    for (const [k, bytes] of got) {
        if (!bytes) {
            if (k === plan.iwad) {
                out.push(game.bundledIwad
                    ? `${wadFileName(k)} is no longer on the gateway; playing ${game.bundledIwad}`
                    : `${wadFileName(k)} is no longer on the gateway; ${game.title} cannot start without it`);
                iwad = game.bundledIwad;
            } else if (!out.some((p) => p.startsWith(wadFileName(k)))) {
                out.push(`${wadFileName(k)} is no longer on the gateway; skipped`);
            }
            continue;
        }
        if (k === plan.iwad) {
            mode = wadGameMode(bytes);
        } else if (plan.companions.includes(k)) {
            companions.push(k);
        } else {
            pwads.push(k);
        }
        files.push([wadFileName(k), bytes]);
    }
    if (game.companions) {
        const missing = game.companions.filter((c) => !companions.includes(c));
        if (missing.length > 0) {
            out.push(`${missing.map(wadFileName).join(', ')} not in the gateway's wads folder; ${game.title} runs without it (${game.companionMissingArg || ''})`.trim());
        }
    }
    if (iwad === game.bundledIwad) {
        mode = 'shareware';
    }
    if (mode === 'shareware' && game.sharewareRefusesPwads && pwads.length > 0) {
        // D_DoomMain: "You cannot -file with the shareware version. Register!"
        out.push(`PWADs need a registered IWAD (the engine refuses -file with shareware data); ${pwads.map(wadFileName).join(', ')} skipped`);
        pwads = [];
    }
    const keep = new Set([wadFileName(iwad), ...pwads.map(wadFileName), ...companions.map(wadFileName)]);
    return {
        game: { iwad, pwads, commercial: mode === 'commercial', companions },
        files: files.filter(([name]) => keep.has(name)),
        problems: out
    };
}

/** What buildArgs needs to know about the WADs that will be on the engine's filesystem. */
export interface GameFiles {
    iwad: string;
    pwads: string[];
    commercial: boolean;
    /** Companion WADs that are on the engine's filesystem (Strife's voices.wad). */
    companions?: string[];
}

/** The game's shareware episode and nothing else. */
export function bundledFiles(game: GameDef = GAMES.doom): GameFiles {
    return { iwad: game.bundledIwad, pwads: [], commercial: false };
}

export const BUNDLED_GAME: GameFiles = bundledFiles(GAMES.doom);

/** Chocolate Doom/Heretic command line for a config and window size. */
export function buildArgs(cfg: DoomConfig, size: PixelSize = { width: RENDER_WIDTH, height: RENDER_HEIGHT }, relay?: string,
    files?: GameFiles): string[] {
    const game = GAMES[normGame(cfg.game)];
    const wads = files || bundledFiles(game);
    const args = [
        '-iwad', wadFileName(wads.iwad),
        '-config', game.configFile,
        '-savedir', SAVE_DIR,
        '-window', '-nogui',
        '-width', String(size.width), '-height', String(size.height)
    ];
    if (wads.pwads.length > 0) {
        args.push('-file', ...wads.pwads.map(wadFileName));
    }
    if (game.companions && game.companionMissingArg && game.companions.some((c) => !(wads.companions || []).includes(c))) {
        args.push(game.companionMissingArg);
    }
    if (!cfg.sound) {
        args.push('-nosfx');
    }
    if (!cfg.music) {
        args.push('-nomusic');
    }
    if (!cfg.mouse) {
        args.push('-nomouse');
    }
    const skill = clampInt(cfg.skill, 1, 5, 3);
    args.push('-skill', String(skill));
    if (game.playerClasses) {
        args.push('-class', String(playerClassIndex(game, cfg.playerClass)));
    }
    if (cfg.warp) {
        // Doom II has no episodes: -warp takes the map alone.
        if (wads.commercial) {
            args.push('-warp', String(clampInt(cfg.map, 1, 32, 1)));
        } else {
            args.push('-warp', String(clampInt(cfg.episode, 1, game.maxEpisode, 1)), String(clampInt(cfg.map, 1, 9, 1)));
        }
    }
    // Netgame over the gateway relay (doom-wasm's -wss transport). The host
    // is the Doom server (id 1) and launches once -nodes players are in the
    // lobby; joiners connect to id 1. Rules apply on the host's side.
    if (cfg.multiplayer !== 'off' && relay) {
        args.push('-wss', relay);
        if (cfg.multiplayer === 'host') {
            args.push('-server', '-nodes', String(clampInt(cfg.players, 2, 4, 2)));
            if (cfg.deathmatch === 'deathmatch' || (cfg.deathmatch === 'altdeath' && !game.altdeath)) {
                args.push('-deathmatch');
            } else if (cfg.deathmatch === 'altdeath') {
                args.push('-altdeath');
            }
        } else {
            args.push('-connect', '1');
        }
    }
    args.push(...splitArgs(cfg.extraArgs));
    return args;
}

export function splitArgs(s: string): string[] {
    return (s || '').split(/\s+/).map((a) => a.trim()).filter((a) => a.length > 0);
}

export function clampInt(v: number, min: number, max: number, dflt: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
        return dflt;
    }
    return Math.max(min, Math.min(max, Math.round(v)));
}

/** A parsed engine stdout line. */
export interface EngineMessage {
    /** doom-wasm protocol code; 0 for free text. */
    code: number;
    message: string;
}

const PROTOCOL = /^doom:\s*(\d+),\s*(.*)$/;

/** doom-wasm prefixes lifecycle messages with "doom: <code>, <text>". */
export function parseEngineLine(line: string): EngineMessage {
    const m = PROTOCOL.exec(line.trim());
    if (m) {
        return { code: parseInt(m[1], 10), message: m[2] };
    }
    return { code: 0, message: line };
}

export const CODE_GAME_STARTED = 10;
export const CODE_ERROR = -1;

/** stderr lines that mean the engine died (Chocolate Doom's I_Error). */
export function isFatalLine(line: string): boolean {
    return /^(Error:|I_Error|Aborted|RuntimeError)/.test(line.trim());
}

export type Phase = 'idle' | 'loading' | 'running' | 'paused' | 'exited' | 'error' | 'busy';

export const DEFAULT_PLAY_LABEL = 'Click to play';

// --- live telemetry ---------------------------------------------------------
// Mirrors the MSTAT_* ids in the engine patch (src/doom/mustry_stats.c).

export const STAT_IDS = {
    inLevel: 0, health: 1, armor: 2, ammo: 3, weapon: 4, kills: 5, items: 6, secrets: 7,
    totalKills: 8, totalItems: 9, totalSecrets: 10, episode: 11, map: 12, levelSeconds: 13, dead: 14,
    netgame: 16, inLobby: 17, netPlayers: 18, playerClass: 19, gold: 20, questFlags: 21
} as const;
export type StatKey = keyof typeof STAT_IDS;
export const STAT_KEYS = Object.keys(STAT_IDS) as StatKey[];

export type DoomStats = Record<StatKey, number>;

export const ZERO_STATS: DoomStats = STAT_KEYS.reduce((acc, k) => {
    acc[k] = 0;
    return acc;
}, {} as DoomStats);

/** Read every stat through a raw reader (the engine's Mustry_Stat export). */
export function readStats(read: (id: number) => number): DoomStats {
    const out = {} as DoomStats;
    for (const k of STAT_KEYS) {
        const v = read(STAT_IDS[k]);
        out[k] = Number.isFinite(v) ? v : 0;
    }
    return out;
}

/** The output writes needed to go from prev to next (only changed keys). */
export function statWrites(prev: DoomStats | null, next: DoomStats): Array<[string, number | boolean]> {
    const writes: Array<[string, number | boolean]> = [];
    for (const k of STAT_KEYS) {
        if (!prev || prev[k] !== next[k]) {
            const v = next[k];
            writes.push([`output.${k}`, k === 'inLevel' || k === 'dead' || k === 'netgame' || k === 'inLobby' ? v !== 0 : v]);
        }
    }
    return writes;
}

// --- save games ---------------------------------------------------------------
// Chocolate Doom writes slot files doomsav<N>.dsg (Heretic: hticsav<N>.hsg) into the -savedir directory
// (SAVE_DIR below, in the engine's in-memory filesystem). A save begins with a
// 24-byte, NUL-padded description typed by the player.

export const SAVE_DIR = '/saves';
export const SAVE_SLOTS = 6;
export const SAVE_STRING_SIZE = 24;
/** Upper bound accepted for one slot; vanilla saves are tens of KB. */
export const MAX_SAVE_BYTES = 2 * 1024 * 1024;

export function saveSlotPath(slot: number, game: GameDef = GAMES.doom): string {
    return `${SAVE_DIR}/${game.saveFile(slot)}`;
}

export function isValidSlot(slot: unknown): slot is number {
    return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < SAVE_SLOTS;
}

/** The player's description from a save file's header (first 24 bytes, NUL-terminated). */
export function saveDescription(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < Math.min(SAVE_STRING_SIZE, bytes.length); i++) {
        const c = bytes[i];
        if (c === 0) {
            break;
        }
        s += String.fromCharCode(c);
    }
    return s.trim();
}

export function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

/** A slot as the gateway hands it to the page. */
export interface SavedSlot {
    slot: number;
    description: string;
    savedAt: string;
    /** Base64 file contents; absent in listings that only carry metadata. */
    data?: string;
    /** A multi-file slot (Hexen): the engine's own file names with base64 contents. */
    files?: Array<{ name: string; data: string }>;
}
