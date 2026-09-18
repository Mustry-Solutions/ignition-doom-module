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
        assertNotNull(DoomRelayTickets.redeem(t));
        assertNotNull(DoomRelayTickets.redeem(t), "the engine reopens its socket mid-game");
        assertEquals("line3", DoomRelayTickets.redeem(t).arena, "the relay routes by the ticket's arena");
        assertEquals("Player1", DoomRelayTickets.redeem(t).player);
        DoomRelayTickets.revoke("session-A");
        assertNull(DoomRelayTickets.redeem(t));
    }

    @Test
    void wadTicketsAndArenaTicketsNeverCross() {
        String wad = DoomRelayTickets.issueWad("session-W");
        String arena = DoomRelayTickets.issue("line3", "session-W", "Player1");
        assertEquals(true, DoomRelayTickets.redeemWad(wad));
        assertEquals(false, DoomRelayTickets.redeemWad(arena), "an arena ticket downloads nothing");
        assertEquals(DoomRelayTickets.WAD_SCOPE, DoomRelayTickets.redeem(wad).arena, "the relay sees the pseudo-arena and refuses it");
        DoomRelayTickets.revoke("session-W");
        assertEquals(false, DoomRelayTickets.redeemWad(wad), "dies with the delegate like any other ticket");
    }

    @Test
    void unknownOrEmptyTicketsAreRefused() {
        assertNull(DoomRelayTickets.redeem(null));
        assertNull(DoomRelayTickets.redeem(""));
        assertNull(DoomRelayTickets.redeem("not-a-ticket"));
    }

    @Test
    void anOlderComponentInTheSameSessionDyingKeepsTheNewerOnesTicket() {
        // Same Perspective session, two component instances over time (view refresh).
        String old = DoomRelayTickets.issue("a", "session-1@root/doom#1", "p");
        String fresh = DoomRelayTickets.issue("a", "session-1@root/doom#2", "p");
        DoomRelayTickets.revoke("session-1@root/doom#1");
        assertNull(DoomRelayTickets.redeem(old));
        assertNotNull(DoomRelayTickets.redeem(fresh));
        DoomRelayTickets.revoke("session-1@root/doom#2");
    }

    @Test
    void ticketsAreUnpredictableAndPerSession() {
        String a = DoomRelayTickets.issue("a", "s1", "p1");
        String b = DoomRelayTickets.issue("a", "s2", "p2");
        assertNotEquals(a, b);
        DoomRelayTickets.revoke("s1");
        assertNull(DoomRelayTickets.redeem(a));
        assertNotNull(DoomRelayTickets.redeem(b), "revoking one session leaves the other's ticket");
        DoomRelayTickets.revoke("s2");
    }
}
