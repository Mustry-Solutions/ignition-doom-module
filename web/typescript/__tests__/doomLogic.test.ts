import {
    arenaKey, base64ToBytes, buildArgs, bytesToBase64, diffControls, EMPTY_CONTROLS, engineSize, heldKeys, isFatalLine, isValidSlot, parseEngineLine, readStats, relayUrl, saveDescription, saveSlotPath, splitArgs, STAT_IDS, statWrites, weaponKey, ZERO_STATS
} from '../components/doom/doomLogic';
import { mapDoomProps, PropReader } from '../components/doom/doomProps';

const baseConfig = {
    autoStart: false, statsIntervalMs: 250, persistSaves: true, player: '', publishTelemetry: true, multiplayer: 'off' as const, arena: 'default', players: 2, deathmatch: 'deathmatch' as const, relayUrl: '', sound: true, music: false, skill: 3, warp: true, episode: 1, map: 1,
    keyboard: true, mouse: false, pixelated: true, showHud: true, playLabel: '', extraArgs: ''
};

describe('buildArgs', () => {
    it('builds the default command line', () => {
        expect(buildArgs(baseConfig)).toEqual([
            '-iwad', 'doom1.wad', '-config', 'default.cfg', '-savedir', '/saves', '-window', '-nogui',
            '-width', '640', '-height', '400', '-nomusic', '-nomouse', '-skill', '3', '-warp', '1', '1'
        ]);
    });
    it('clamps skill and map, honours sound/music/mouse and appends extra args', () => {
        const args = buildArgs({ ...baseConfig, sound: false, music: true, mouse: true, skill: 9, map: 42, extraArgs: ' -nomonsters  -fast ' });
        expect(args).toContain('-nosfx');
        expect(args).not.toContain('-nomusic');
        expect(args).not.toContain('-nomouse');
        expect(args.slice(args.indexOf('-skill'), args.indexOf('-skill') + 2)).toEqual(['-skill', '5']);
        expect(args.slice(args.indexOf('-warp'), args.indexOf('-warp') + 3)).toEqual(['-warp', '1', '9']);
        expect(args.slice(-2)).toEqual(['-nomonsters', '-fast']);
    });
    it('omits -warp when warp is off', () => {
        expect(buildArgs({ ...baseConfig, warp: false })).not.toContain('-warp');
    });
    it('passes the frame size as the engine window', () => {
        const args = buildArgs(baseConfig, { width: 800, height: 500 });
        expect(args.slice(args.indexOf('-width'), args.indexOf('-width') + 4)).toEqual(['-width', '800', '-height', '500']);
    });
});

describe('engineSize', () => {
    it('uses the frame box when it is measurable', () => {
        expect(engineSize(800.6, 500.2)).toEqual({ width: 800, height: 500 });
    });
    it('falls back to 640x400 for an unmeasured or absurd frame', () => {
        expect(engineSize(0, 0)).toEqual({ width: 640, height: 400 });
        expect(engineSize(NaN, 300)).toEqual({ width: 640, height: 400 });
    });
});

describe('splitArgs', () => {
    it('tolerates empty and whitespace', () => {
        expect(splitArgs('')).toEqual([]);
        expect(splitArgs('   ')).toEqual([]);
        expect(splitArgs('a  b\tc')).toEqual(['a', 'b', 'c']);
    });
});

describe('parseEngineLine', () => {
    it('parses the doom-wasm protocol', () => {
        expect(parseEngineLine('doom: 10, game started')).toEqual({ code: 10, message: 'game started' });
        expect(parseEngineLine('doom: 8, uid is 42')).toEqual({ code: 8, message: 'uid is 42' });
    });
    it('treats anything else as free text', () => {
        expect(parseEngineLine('Z_Init: Init zone memory allocation daemon.')).toEqual({ code: 0, message: 'Z_Init: Init zone memory allocation daemon.' });
    });
});

describe('isFatalLine', () => {
    it('recognises engine death', () => {
        expect(isFatalLine('Error: W_GetNumForName: TITLEPIC not found!')).toBe(true);
        expect(isFatalLine('RuntimeError: unreachable')).toBe(true);
        expect(isFatalLine('R_Init: Init DOOM refresh daemon')).toBe(false);
    });
});

describe('diffControls', () => {
    it('emits down/up transitions for booleans only when they change', () => {
        const next = { ...EMPTY_CONTROLS, forward: true, fire: true };
        const a = diffControls(EMPTY_CONTROLS, next);
        expect(a.map((x) => [x.def.code, x.kind])).toEqual([['KeyW', 'down'], ['Space', 'down']]);
        expect(diffControls(next, next)).toEqual([]);
        expect(diffControls(next, { ...next, fire: false }).map((x) => [x.def.code, x.kind])).toEqual([['Space', 'up']]);
    });
    it('presses a digit when the weapon slot changes to a valid slot', () => {
        expect(diffControls(EMPTY_CONTROLS, { ...EMPTY_CONTROLS, weapon: 3 })).toEqual([{ def: weaponKey(3), kind: 'press' }]);
        expect(diffControls({ ...EMPTY_CONTROLS, weapon: 3 }, { ...EMPTY_CONTROLS, weapon: 0 })).toEqual([]);
        expect(weaponKey(8)).toBeNull();
        expect(weaponKey(2.5)).toBeNull();
    });
});

describe('heldKeys', () => {
    it('lists the keys currently down', () => {
        expect(heldKeys({ ...EMPTY_CONTROLS, run: true, turnLeft: true }).map((k) => k.code)).toEqual(['ArrowLeft', 'ShiftLeft']);
    });
});

describe('mapDoomProps', () => {
    const tree = (values: Record<string, unknown>): PropReader => ({
        readString: (p, d) => (typeof values[p] === 'string' ? values[p] as string : (d ?? '')),
        readBoolean: (p, d) => (typeof values[p] === 'boolean' ? values[p] as boolean : (d ?? false)),
        readNumber: <T>(p: string, d: T) => (typeof values[p] === 'number' ? values[p] as unknown as T : d)
    });
    it('applies defaults', () => {
        const p = mapDoomProps(tree({}));
        expect(p.config).toEqual(baseConfig);
        expect(p.controls).toEqual(EMPTY_CONTROLS);
        expect(p.paused).toBe(false);
        expect(p.running).toBe(false);
    });
    it('reads bound values', () => {
        const p = mapDoomProps(tree({ 'config.skill': 5, 'data.controls.fire': true, 'data.controls.weapon': 2, 'state.paused': true, 'state.running': true }));
        expect(p.config.skill).toBe(5);
        expect(p.controls.fire).toBe(true);
        expect(p.controls.weapon).toBe(2);
        expect(p.paused).toBe(true);
        expect(p.running).toBe(true);
    });
});

describe('telemetry', () => {
    it('reads every stat through the engine reader by id', () => {
        const stats = readStats((id) => id * 10);
        expect(stats.health).toBe(STAT_IDS.health * 10);
        expect(stats.dead).toBe(STAT_IDS.dead * 10);
        expect(Object.keys(stats).sort()).toEqual(Object.keys(STAT_IDS).sort());
    });
    it('coerces non-finite readings to 0', () => {
        expect(readStats(() => NaN).health).toBe(0);
    });
    it('writes everything on the first publish and only changes afterwards, booleans for flags', () => {
        const first = statWrites(null, ZERO_STATS);
        expect(first).toHaveLength(Object.keys(STAT_IDS).length);
        expect(first).toContainEqual(['output.inLevel', false]);
        expect(first).toContainEqual(['output.health', 0]);
        const next = { ...ZERO_STATS, inLevel: 1, health: 87, dead: 0 };
        expect(statWrites(ZERO_STATS, next)).toEqual([['output.inLevel', true], ['output.health', 87]]);
        expect(statWrites(next, next)).toEqual([]);
    });
});

describe('save games', () => {
    it('names slot files the way Chocolate Doom does', () => {
        expect(saveSlotPath(0)).toBe('/saves/doomsav0.dsg');
        expect(saveSlotPath(5)).toBe('/saves/doomsav5.dsg');
    });
    it('accepts only the six vanilla slots', () => {
        expect(isValidSlot(0)).toBe(true);
        expect(isValidSlot(5)).toBe(true);
        expect(isValidSlot(6)).toBe(false);
        expect(isValidSlot(-1)).toBe(false);
        expect(isValidSlot('1')).toBe(false);
    });
    it('reads the 24-byte NUL-padded description from a save header', () => {
        const header = new Uint8Array(40);
        const text = 'E1M1 before the bridge';
        for (let i = 0; i < text.length; i++) header[i] = text.charCodeAt(i);
        expect(saveDescription(header)).toBe(text);
        const long = new Uint8Array(40).fill(65);
        expect(saveDescription(long)).toHaveLength(24);
    });
    it('round-trips bytes through base64', () => {
        const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
        expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });
});

describe('multiplayer', () => {
    it('derives the relay URL from the page origin and sanitises the arena', () => {
        expect(relayUrl({ relayUrl: '', arena: 'line 3' }, { protocol: 'http:', host: 'gw:9188' })).toBe('ws://gw:9188/system/doom-relay/line_3');
        expect(relayUrl({ relayUrl: '', arena: '' }, { protocol: 'https:', host: 'gw' })).toBe('wss://gw/system/doom-relay/default');
        expect(relayUrl({ relayUrl: 'wss://relay.example/x/', arena: 'a' }, { protocol: 'http:', host: 'gw' })).toBe('wss://relay.example/x/a');
        expect(relayUrl({ relayUrl: '', arena: 'a' }, { protocol: 'http:', host: 'gw' }, 'T/k=')).toBe('ws://gw/system/doom-relay/a?ticket=T%2Fk%3D');
        expect(arenaKey('../etc')).toBe('default');
    });
    it('adds host arguments: -wss, -server, -nodes and the rules', () => {
        const args = buildArgs({ ...baseConfig, multiplayer: 'host', players: 3, deathmatch: 'altdeath' }, undefined, 'ws://gw/system/doom-relay/a');
        expect(args).toEqual(expect.arrayContaining(['-wss', 'ws://gw/system/doom-relay/a', '-server', '-nodes', '3', '-altdeath']));
        expect(args).not.toContain('-connect');
    });
    it('adds join arguments: -wss and -connect 1, never rules', () => {
        const args = buildArgs({ ...baseConfig, multiplayer: 'join' }, undefined, 'ws://gw/system/doom-relay/a');
        expect(args.slice(args.indexOf('-connect'), args.indexOf('-connect') + 2)).toEqual(['-connect', '1']);
        expect(args).not.toContain('-server');
        expect(args).not.toContain('-deathmatch');
    });
    it('stays single player without a relay URL', () => {
        expect(buildArgs({ ...baseConfig, multiplayer: 'host' })).not.toContain('-wss');
    });
});
