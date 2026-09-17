// DOM-facing engine plumbing: loading the Emscripten glue script once per page,
// the one-instance-per-page guard, and synthesising keyboard events for the
// engine's SDL layer. Deliberately thin and untested (see doomLogic for logic).
import { KeyDef } from './doomLogic';

/** Where the gateway serves the engine (see MustryDoomModule.ENGINE_PATH). */
export const ENGINE_PATH = '/res/mustry-doom/doom/';
export const ENGINE_SCRIPT = ENGINE_PATH + 'websockets-doom.js';

/**
 * The canvas's element id. SDL's Emscripten backend (2.32) hardcodes its canvas
 * as the CSS selector "#canvas" and Emscripten resolves that with
 * document.querySelector, so the element must literally have id="canvas" or SDL
 * never sizes it (and renders into the void). One engine per page (see
 * claimEngine), so the page-global id is acceptable. The keyboard target is a
 * hint we set to the same selector, so keys only reach the game while the
 * canvas is focused.
 */
export const CANVAS_ID = 'canvas';
export const KEYBOARD_ELEMENT = '#' + CANVAS_ID;

/** The subset of the Emscripten Module object the component touches. */
export interface DoomModule {
    canvas: HTMLCanvasElement;
    callMain(args: string[]): void;
    ccall(name: string, returnType: string | null, argTypes: string[], args: unknown[]): unknown;
    FS: { createPreloadedFile(parent: string, name: string, url: string, canRead: boolean, canWrite: boolean): void };
    ENV: Record<string, string>;
}

export interface DoomModuleConfig {
    canvas: HTMLCanvasElement;
    noInitialRun: boolean;
    locateFile(path: string, prefix: string): string;
    print(text: string): void;
    printErr(text: string): void;
    preRun: Array<(m: DoomModule) => void>;
    onExit?(code: number): void;
    onAbort?(what: unknown): void;
}

export type DoomFactory = (config: DoomModuleConfig) => Promise<DoomModule>;

let factoryPromise: Promise<DoomFactory> | null = null;

/** Injects the engine's glue script once and resolves its module factory. */
export function loadEngine(): Promise<DoomFactory> {
    if (!factoryPromise) {
        factoryPromise = new Promise<DoomFactory>((resolve, reject) => {
            const existing = (window as unknown as { createDoomModule?: DoomFactory }).createDoomModule;
            if (existing) {
                resolve(existing);
                return;
            }
            const s = document.createElement('script');
            s.src = ENGINE_SCRIPT;
            s.async = true;
            s.onload = () => {
                const f = (window as unknown as { createDoomModule?: DoomFactory }).createDoomModule;
                if (f) {
                    resolve(f);
                } else {
                    reject(new Error('Engine script loaded but createDoomModule is missing'));
                }
            };
            s.onerror = () => {
                factoryPromise = null;
                reject(new Error(`Could not load ${ENGINE_SCRIPT}`));
            };
            document.head.appendChild(s);
        });
    }
    return factoryPromise;
}

// --- one running engine per page -------------------------------------------
// The Emscripten build keeps SDL's audio/keyboard state in page globals, and
// 64 MB of linear memory per instance adds up. One marine per browser tab.
let owner: object | null = null;

export function claimEngine(who: object): boolean {
    if (owner && owner !== who) {
        return false;
    }
    owner = who;
    return true;
}

export function releaseEngine(who: object): void {
    if (owner === who) {
        owner = null;
    }
}

export function engineOwner(): object | null {
    return owner;
}

// --- keys -------------------------------------------------------------------
/**
 * SDL listens on the canvas (we point SDL_EMSCRIPTEN_KEYBOARD_ELEMENT at it),
 * so a synthetic KeyboardEvent dispatched there drives the game exactly like a
 * real key. key/code/keyCode are all set: SDL versions differ in which they read.
 */
export function dispatchKey(target: EventTarget, type: 'keydown' | 'keyup', def: KeyDef): void {
    const ev = new KeyboardEvent(type, {
        key: def.key, code: def.code, keyCode: def.keyCode, which: def.keyCode,
        bubbles: true, cancelable: true
    } as KeyboardEventInit);
    target.dispatchEvent(ev);
}

export function pressKey(target: EventTarget, def: KeyDef, holdMs = 60): void {
    dispatchKey(target, 'keydown', def);
    window.setTimeout(() => dispatchKey(target, 'keyup', def), holdMs);
}
