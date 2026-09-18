package com.mustrysolutions.doom.gateway;

import java.util.Base64;

import com.inductiveautomation.ignition.common.auth.web.WebAuthUser;
import com.inductiveautomation.ignition.common.gson.JsonArray;
import com.inductiveautomation.ignition.common.gson.JsonObject;
import com.inductiveautomation.perspective.gateway.api.Component;
import com.inductiveautomation.perspective.gateway.api.ComponentModelDelegate;
import com.inductiveautomation.perspective.gateway.messages.EventFiredMsg;

/**
 * Gateway half of the save-game channel. The browser component (doomSaves.ts)
 * fires {@code doom-saves-list} and {@code doom-saves-put}; this delegate
 * answers with {@code doom-saves-slots} (the user's slots, data included) or
 * {@code doom-saves-error}. The owner is always derived from the session's
 * authenticated user, never from the payload.
 */
public class DoomModelDelegate extends ComponentModelDelegate {

    static final String EVT_LIST = "doom-saves-list";
    static final String EVT_PUT = "doom-saves-put";
    static final String EVT_SLOTS = "doom-saves-slots";
    static final String EVT_ERROR = "doom-saves-error";
    static final String EVT_TELEMETRY = "doom-telemetry";
    static final String EVT_PLAYER = "doom-player";
    /** page -> gateway: { arena, player } ; gateway -> page: { arena, ticket } */
    static final String EVT_TICKET = "doom-relay-ticket";
    static final String EVT_TICKET_OK = "doom-relay-ticket-ok";
    /** page -> gateway: {} please let me download operator-supplied WADs. */
    static final String EVT_WADS = "doom-wads";
    /** gateway -> page: { ticket, wads: [keys] } */
    static final String EVT_WADS_OK = "doom-wads-ok";

    private final DoomSaveStore store;
    private final DoomWadStore wads;
    private final DoomTagProvider tags;
    /** The [Doom]Players/<player> folder this session feeds, once telemetry named it. */
    private volatile String player;

    public DoomModelDelegate(Component component, DoomTagProvider tags) {
        super(component);
        this.tags = tags;
        java.nio.file.Path data = component.getSession().getGatewayContext().getSystemManager().getDataDir().toPath();
        this.store = new DoomSaveStore(data);
        this.wads = new DoomWadStore(data);
    }

    @Override
    protected void onStartup() {
        log.infof("delegate startup for %s", issuerId());
    }

    @Override
    protected void onShutdown() {
        if (tags != null && player != null) {
            tags.offline(player);
        }
        log.infof("delegate shutdown for %s (player %s): revoking its relay tickets", issuerId(), player);
        DoomRelayTickets.revoke(issuerId());
    }

    /** This delegate instance's identity for relay tickets: session + component. */
    private String issuerId() {
        return sessionId() + "@" + component.getComponentAddressPath();
    }

    private String sessionId() {
        return component.getSession().getSessionId().toString();
    }

    private boolean authenticated() {
        return component.getSession().getWebAuthStatus().getUser().isPresent();
    }

    /** config.player, else the authenticated user, else anonymous-<session>. */
    private String resolvePlayer(String requested) {
        String session = component.getSession().getSessionId().toString();
        String fallback = component.getSession().getWebAuthStatus().getUser()
            .map(WebAuthUser::getUserName)
            .map(u -> DoomTagProvider.playerKey(u, "anonymous-" + session.substring(0, 8)))
            .orElse("anonymous-" + session.substring(0, 8));
        return DoomTagProvider.playerKey(requested, fallback);
    }

    /**
     * The save-game owner: the authenticated user, or null when the session
     * has none. Anonymous sessions do not get a shared folder: every visitor
     * would see (and overwrite) everyone else's slots. Their saves stay in the
     * tab, and the page is told so.
     */
    private String owner() {
        return component.getSession().getWebAuthStatus().getUser()
            .map(WebAuthUser::getUserName)
            .map(DoomSaveStore::ownerKey)
            .orElse(null);
    }

    @Override
    public void handleEvent(EventFiredMsg message) {
        String name = message.getEventName();
        try {
            if (EVT_TELEMETRY.equals(name)) {
                if (tags == null) {
                    return;
                }
                JsonObject payload = message.getEvent();
                String requested = payload != null && payload.has("player") ? payload.get("player").getAsString() : "";
                String resolved = resolvePlayer(requested);
                if (!resolved.equals(player)) {
                    if (player != null) {
                        tags.offline(player);
                    }
                    player = resolved;
                    JsonObject out = new JsonObject();
                    out.addProperty("player", resolved);
                    fireEvent(EVT_PLAYER, out);
                }
                boolean running = payload != null && payload.has("running") && payload.get("running").getAsBoolean();
                JsonObject stats = payload != null && payload.has("stats") && payload.get("stats").isJsonObject()
                    ? payload.getAsJsonObject("stats") : null;
                String game = payload != null && payload.has("game") && payload.get("game").isJsonPrimitive()
                    ? payload.get("game").getAsString() : "";
                tags.update(resolved, component.getSession().getSessionId().toString(), running, game, stats);
            } else if (EVT_TICKET.equals(name)) {
                JsonObject payload = message.getEvent();
                String arena = DoomTagProvider.playerKey(
                    payload != null && payload.has("arena") ? payload.get("arena").getAsString() : "", "default");
                String requested = payload != null && payload.has("player") ? payload.get("player").getAsString() : "";
                String ticket = DoomRelayTickets.issue(arena, issuerId(), resolvePlayer(requested));
                log.infof("issued relay ticket %s... for arena %s (registry %s)", ticket.substring(0, 8), arena, DoomRelayTickets.where());
                JsonObject out = new JsonObject();
                out.addProperty("arena", arena);
                out.addProperty("ticket", ticket);
                fireEvent(EVT_TICKET_OK, out);
            } else if (EVT_WADS.equals(name)) {
                // Admission to the WAD download route, plus what is there, so the
                // page can fall back to shareware without a 404 round-trip.
                JsonObject out = new JsonObject();
                out.addProperty("ticket", DoomRelayTickets.issueWad(issuerId()));
                JsonArray list = new JsonArray();
                wads.list().forEach(list::add);
                out.add("wads", list);
                fireEvent(EVT_WADS_OK, out);
            } else if (EVT_LIST.equals(name)) {
                sendSlots(game(message.getEvent()));
            } else if (EVT_PUT.equals(name)) {
                JsonObject payload = message.getEvent();
                String game = game(payload);
                String owner = owner();
                if (owner == null) {
                    sendSlots(game); // reports owner "" so the page keeps the save in the tab
                    return;
                }
                if (payload == null || !payload.has("slot") || !payload.has("data")) {
                    error("save payload needs slot and data");
                    return;
                }
                int slot = payload.get("slot").getAsInt();
                String description = payload.has("description") ? payload.get("description").getAsString() : "";
                byte[] bytes = Base64.getDecoder().decode(payload.get("data").getAsString());
                store.put(owner, game, slot, description, bytes);
                log.debugf("Stored Doom save slot %d for %s/%s (%d bytes)", slot, owner, game.isEmpty() ? "doom1" : game, bytes.length);
                sendSlots(game);
            }
        } catch (IllegalArgumentException e) {
            error(e.getMessage());
        } catch (Exception e) {
            log.warn("Doom save-game operation failed", e);
            error("gateway could not store the save: " + e.getMessage());
        }
    }

    /** The IWAD a save request is for ("" = the bundled shareware one). */
    private static String game(JsonObject payload) {
        return payload != null && payload.has("iwad") && !payload.get("iwad").isJsonNull()
            ? payload.get("iwad").getAsString() : "";
    }

    private void sendSlots(String game) throws Exception {
        String owner = owner();
        JsonObject out = new JsonObject();
        out.addProperty("owner", owner == null ? "" : owner);
        out.addProperty("authenticated", authenticated());
        out.addProperty("iwad", game);
        out.add("slots", owner == null ? new JsonArray() : store.list(owner, game));
        fireEvent(EVT_SLOTS, out);
    }

    private void error(String text) {
        JsonObject out = new JsonObject();
        out.addProperty("error", text);
        fireEvent(EVT_ERROR, out);
    }

    @Override
    public void fireEvent(String eventName, JsonObject event) {
        this.component.fireEvent("model", eventName, event);
    }
}
