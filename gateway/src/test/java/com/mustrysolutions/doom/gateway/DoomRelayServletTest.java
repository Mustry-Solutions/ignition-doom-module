package com.mustrysolutions.doom.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.inductiveautomation.ignition.common.gson.JsonObject;

import org.junit.jupiter.api.Test;

class DoomRelayServletTest {

    @Test
    void statusOfAnIdleRelayIsEmptyAndNamesNoPlayers() {
        JsonObject status = DoomRelayServlet.status();
        assertEquals(0, status.get("count").getAsInt());
        assertEquals(0, status.getAsJsonArray("arenas").size());
        assertFalse(status.toString().contains("player"));
    }
}
