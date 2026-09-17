// Reads the Perspective PropertyTree into the typed props the component uses.
import { DoomConfig, DoomControls, HOLD_CONTROLS } from './doomLogic';

/** The PropertyTree readers we use — kept structural so the mapper is node-testable. */
export interface PropReader {
    readString(path: string, defaultValue?: string): string;
    readBoolean(path: string, defaultValue?: boolean): boolean;
    readNumber<T>(path: string, defaultValue: T): T;
}

export interface DoomProps {
    config: DoomConfig;
    controls: DoomControls;
    paused: boolean;
}

export function mapDoomProps(tree: PropReader): DoomProps {
    const controls = {} as DoomControls;
    for (const c of HOLD_CONTROLS) {
        controls[c] = tree.readBoolean(`data.controls.${c}`, false);
    }
    controls.weapon = tree.readNumber('data.controls.weapon', 0);
    return {
        config: {
            autoStart: tree.readBoolean('config.autoStart', false),
            sound: tree.readBoolean('config.sound', true),
            music: tree.readBoolean('config.music', false),
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
        paused: tree.readBoolean('state.paused', false)
    };
}
