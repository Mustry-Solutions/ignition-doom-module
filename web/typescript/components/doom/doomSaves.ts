// Save-game persistence: the browser side of the component ⇄ gateway channel.
//
// Perspective components can have a gateway-side model delegate that talks to
// the client store delegate through named events. The gateway delegate
// (DoomModelDelegate.java) owns the files under the gateway's data directory,
// keyed by the session's user; this store delegate mirrors the slot listing
// into component state and forwards slot uploads.
import { AbstractUIElementStore, ComponentStoreDelegate, JsObject } from '@inductiveautomation/perspective-client';
import { isValidSlot, SavedSlot } from './doomLogic';

/** Event names shared with DoomModelDelegate.java. */
export const SAVE_EVENTS = {
    /** page -> gateway: send my slots (with data) */
    LIST: 'doom-saves-list',
    /** page -> gateway: persist one slot { slot, description, data(base64) } */
    PUT: 'doom-saves-put',
    /** gateway -> page: { owner, slots: [{ slot, description, savedAt, data? }] } */
    SLOTS: 'doom-saves-slots',
    /** gateway -> page: { error } */
    ERROR: 'doom-saves-error'
} as const;

export interface DoomSavesState {
    owner: string;
    /** Slots the gateway holds for this user, with data when they came from LIST. */
    slots: SavedSlot[];
    loaded: boolean;
    lastError: string;
}

export class DoomStoreDelegate extends ComponentStoreDelegate {
    private owner = '';
    private slots: SavedSlot[] = [];
    private loaded = false;
    private lastError = '';

    constructor(componentStore: AbstractUIElementStore) {
        super(componentStore);
    }

    mapStateToProps(): DoomSavesState {
        return { owner: this.owner, slots: this.slots, loaded: this.loaded, lastError: this.lastError };
    }

    requestSlots(): void {
        this.fireEvent(SAVE_EVENTS.LIST, {});
    }

    putSlot(slot: number, description: string, data: string): void {
        this.fireEvent(SAVE_EVENTS.PUT, { slot, description, data });
    }

    handleEvent(eventName: string, eventObject: JsObject): void {
        switch (eventName) {
            case SAVE_EVENTS.SLOTS: {
                const raw = Array.isArray(eventObject && eventObject.slots) ? eventObject.slots as JsObject[] : [];
                this.slots = raw
                    .filter((s) => isValidSlot(s.slot))
                    .map((s) => ({
                        slot: s.slot as number,
                        description: String(s.description || ''),
                        savedAt: String(s.savedAt || ''),
                        data: typeof s.data === 'string' ? s.data : undefined
                    }));
                this.owner = String((eventObject && eventObject.owner) || '');
                this.loaded = true;
                this.lastError = '';
                this.notify();
                break;
            }
            case SAVE_EVENTS.ERROR:
                this.lastError = String((eventObject && eventObject.error) || 'unknown error');
                this.notify();
                break;
            default:
                break;
        }
    }
}
