// Reads the Perspective PropertyTree into the typed props the component uses.
import { DoomConfig, DoomControls, HOLD_CONTROLS, normGame, normMultiplayer, normNetRules } from './doomLogic';

/** The PropertyTree readers we use — kept structural so the mapper is node-testable. */
export interface PropReader {
    readString(path: string, defaultValue?: string): string;
    readBoolean(path: string, defaultValue?: boolean): boolean;
    readNumber<T>(path: string, defaultValue: T): T;
    readArray(path: string, defaultValue?: never[]): unknown[];
}

export interface DoomProps {
    config: DoomConfig;
    controls: DoomControls;
    paused: boolean;
    running: boolean;
}

export function mapDoomProps(tree: PropReader): DoomProps {
    const controls = {} as DoomControls;
    for (const c of HOLD_CONTROLS) {
        controls[c] = tree.readBoolean(`data.controls.${c}`, false);
    }
    controls.weapon = tree.readNumber('data.controls.weapon', 0);
    return {
        config: {
            game: normGame(tree.readString('config.game', 'doom')),
            autoStart: tree.readBoolean('config.autoStart', false),
            statsIntervalMs: tree.readNumber('config.statsIntervalMs', 250),
            persistSaves: tree.readBoolean('config.persistSaves', true),
            player: tree.readString('config.player', ''),
            publishTelemetry: tree.readBoolean('config.publishTelemetry', true),
            multiplayer: normMultiplayer(tree.readString('config.multiplayer', 'off')),
            arena: tree.readString('config.arena', 'default'),
            players: tree.readNumber('config.players', 2),
            deathmatch: normNetRules(tree.readString('config.deathmatch', 'deathmatch')),
            relayUrl: tree.readString('config.relayUrl', ''),
            sound: tree.readBoolean('config.sound', true),
            music: tree.readBoolean('config.music', false),
            iwad: tree.readString('config.iwad', ''),
            pwads: (tree.readArray('config.pwads', []) || []).filter((p): p is string => typeof p === 'string'),
            playerClass: tree.readString('config.playerClass', 'fighter'),
            skill: tree.readNumber('config.skill', 3),
            warp: tree.readBoolean('config.warp', true),
            episode: tree.readNumber('config.episode', 1),
            map: tree.readNumber('config.map', 1),
            keyboard: tree.readBoolean('config.keyboard', true),
            mouse: tree.readBoolean('config.mouse', false),
            pixelated: tree.readBoolean('config.pixelated', true),
            showHud: tree.readBoolean('config.showHud', true),
            playLabel: tree.readString('config.playLabel', ''),
            extraArgs: tree.readString('config.extraArgs', '')
        },
        controls,
        paused: tree.readBoolean('state.paused', false),
        running: tree.readBoolean('state.running', false)
    };
}
