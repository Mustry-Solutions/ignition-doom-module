package com.mustrysolutions.doom.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class DoomRelayTicketsTest {

    @Test
    void aTicketAdmitsItsArenaOnlyAndStaysValidForReconnects() {
        String t = DoomRelayTickets.issue("line3", "session-A", "Player1");
        assertNotNull(DoomRelayTickets.redeem(t, "line3"));
        assertNotNull(DoomRelayTickets.redeem(t, "line3"), "the engine reopens its socket mid-game");
        assertNull(DoomRelayTickets.redeem(t, "other"));
        assertEquals("Player1", DoomRelayTickets.redeem(t, "line3").player);
        DoomRelayTickets.revokeSession("session-A");
        assertNull(DoomRelayTickets.redeem(t, "line3"));
    }

    @Test
    void unknownOrEmptyTicketsAreRefused() {
        assertNull(DoomRelayTickets.redeem(null, "a"));
        assertNull(DoomRelayTickets.redeem("", "a"));
        assertNull(DoomRelayTickets.redeem("not-a-ticket", "a"));
    }

    @Test
    void ticketsAreUnpredictableAndPerSession() {
        String a = DoomRelayTickets.issue("a", "s1", "p1");
        String b = DoomRelayTickets.issue("a", "s2", "p2");
        assertNotEquals(a, b);
        DoomRelayTickets.revokeSession("s1");
        assertNull(DoomRelayTickets.redeem(a, "a"));
        assertNotNull(DoomRelayTickets.redeem(b, "a"), "revoking one session leaves the other's ticket");
        DoomRelayTickets.revokeSession("s2");
    }
}
