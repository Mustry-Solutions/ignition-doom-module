// Pure logic for the Doom component: engine arguments, the stdout protocol,
// key definitions and control diffing. No DOM, no perspective-client — node-tested.

export interface DoomConfig {
    autoStart: boolean;
    sound: boolean;
    music: boolean;
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

/** Chocolate Doom command line for a config and window size. */
export function buildArgs(cfg: DoomConfig, size: PixelSize = { width: RENDER_WIDTH, height: RENDER_HEIGHT }): string[] {
    const args = [
        '-iwad', 'doom1.wad',
        '-config', 'default.cfg',
        '-window', '-nogui',
        '-width', String(size.width), '-height', String(size.height)
    ];
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
    if (cfg.warp) {
        args.push('-warp', String(clampInt(cfg.episode, 1, 1, 1)), String(clampInt(cfg.map, 1, 9, 1)));
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
