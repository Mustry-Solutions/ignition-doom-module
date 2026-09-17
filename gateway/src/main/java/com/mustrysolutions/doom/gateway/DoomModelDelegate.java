package com.mustrysolutions.doom.gateway;

import java.util.Base64;

import com.inductiveautomation.ignition.common.auth.web.WebAuthUser;
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

    private final DoomSaveStore store;

    public DoomModelDelegate(Component component) {
        super(component);
        this.store = new DoomSaveStore(
            component.getSession().getGatewayContext().getSystemManager().getDataDir().toPath());
    }

    @Override
    protected void onStartup() {
        // nothing to do: the store is stateless between events
    }

    @Override
    protected void onShutdown() {
        // nothing to release
    }

    private String owner() {
        return component.getSession().getWebAuthStatus().getUser()
            .map(WebAuthUser::getUserName)
            .map(DoomSaveStore::ownerKey)
            .orElse(DoomSaveStore.ANONYMOUS);
    }

    @Override
    public void handleEvent(EventFiredMsg message) {
        String name = message.getEventName();
        try {
            if (EVT_LIST.equals(name)) {
                sendSlots();
            } else if (EVT_PUT.equals(name)) {
                JsonObject payload = message.getEvent();
                if (payload == null || !payload.has("slot") || !payload.has("data")) {
                    error("save payload needs slot and data");
                    return;
                }
                int slot = payload.get("slot").getAsInt();
                String description = payload.has("description") ? payload.get("description").getAsString() : "";
                byte[] bytes = Base64.getDecoder().decode(payload.get("data").getAsString());
                store.put(owner(), slot, description, bytes);
                log.debugf("Stored Doom save slot %d for %s (%d bytes)", slot, owner(), bytes.length);
                sendSlots();
            }
        } catch (IllegalArgumentException e) {
            error(e.getMessage());
        } catch (Exception e) {
            log.warn("Doom save-game operation failed", e);
            error("gateway could not store the save: " + e.getMessage());
        }
    }

    private void sendSlots() throws Exception {
        String owner = owner();
        JsonObject out = new JsonObject();
        out.addProperty("owner", owner);
        out.add("slots", store.list(owner));
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
