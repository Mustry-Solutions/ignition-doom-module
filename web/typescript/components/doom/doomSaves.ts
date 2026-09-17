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
    ERROR: 'doom-saves-error',
    /** page -> gateway: { player, running, stats: {...changed} } -> module tag provider */
    TELEMETRY: 'doom-telemetry',
    /** gateway -> page: { player } the resolved [Doom]Players/<player> name */
    PLAYER: 'doom-player',
    /** page -> gateway: { arena, player }: please admit me to the relay */
    TICKET: 'doom-relay-ticket',
    /** gateway -> page: { arena, ticket } single-use relay admission */
    TICKET_OK: 'doom-relay-ticket-ok'
} as const;

export interface DoomSavesState {
    /** Save-game owner; empty when the session is unauthenticated (saves stay in the tab). */
    owner: string;
    authenticated: boolean;
    /** The player folder the gateway writes telemetry to, once it told us. */
    player: string;
    /** Slots the gateway holds for this user, with data when they came from LIST. */
    slots: SavedSlot[];
    loaded: boolean;
    lastError: string;
}

export class DoomStoreDelegate extends ComponentStoreDelegate {
    private owner = '';
    private authenticated = false;
    private player = '';
    private ticketWaiters: Array<(ticket: string) => void> = [];
    private slots: SavedSlot[] = [];
    private loaded = false;
    private lastError = '';

    constructor(componentStore: AbstractUIElementStore) {
        super(componentStore);
    }

    mapStateToProps(): DoomSavesState {
        return {
            owner: this.owner, authenticated: this.authenticated, player: this.player,
            slots: this.slots, loaded: this.loaded, lastError: this.lastError
        };
    }

    requestSlots(): void {
        this.fireEvent(SAVE_EVENTS.LIST, {});
    }

    putSlot(slot: number, description: string, data: string): void {
        this.fireEvent(SAVE_EVENTS.PUT, { slot, description, data });
    }

    /** Ask the gateway for a relay admission ticket; resolves with the token. */
    requestTicket(arena: string, player: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.ticketWaiters = this.ticketWaiters.filter((w) => w !== done);
                reject(new Error('the gateway did not issue a relay ticket'));
            }, 10_000);
            const done = (ticket: string) => {
                window.clearTimeout(timer);
                resolve(ticket);
            };
            this.ticketWaiters.push(done);
            this.fireEvent(SAVE_EVENTS.TICKET, { arena, player });
        });
    }

    /** Push telemetry (only the changed stats) for the gateway's [Doom] provider. */
    publishTelemetry(player: string, running: boolean, stats: Record<string, number | boolean>): void {
        this.fireEvent(SAVE_EVENTS.TELEMETRY, { player, running, stats });
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
                this.authenticated = !!(eventObject && eventObject.authenticated);
                this.loaded = true;
                this.lastError = '';
                this.notify();
                break;
            }
            case SAVE_EVENTS.TICKET_OK: {
                const ticket = String((eventObject && eventObject.ticket) || '');
                const waiters = this.ticketWaiters;
                this.ticketWaiters = [];
                waiters.forEach((w) => w(ticket));
                break;
            }
            case SAVE_EVENTS.PLAYER:
                this.player = String((eventObject && eventObject.player) || '');
                this.notify();
                break;
            case SAVE_EVENTS.ERROR:
                this.lastError = String((eventObject && eventObject.error) || 'unknown error');
                this.notify();
                break;
            default:
                break;
        }
    }
}
