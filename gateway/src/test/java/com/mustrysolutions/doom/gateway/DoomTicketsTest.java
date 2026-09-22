package com.mustrysolutions.doom.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class DoomTicketsTest {

    @Test
    void aTicketAdmitsItsArenaOnlyAndStaysValidForReconnects() {
        String t = DoomTickets.issue("line3", "session-A", "Player1");
        assertNotNull(DoomTickets.redeem(t));
        assertNotNull(DoomTickets.redeem(t), "the engine reopens its socket mid-game");
        assertEquals("line3", DoomTickets.redeem(t).arena, "the relay routes by the ticket's arena");
        assertEquals("Player1", DoomTickets.redeem(t).player);
        DoomTickets.revoke("session-A");
        assertNull(DoomTickets.redeem(t));
    }

    @Test
    void wadTicketsAndArenaTicketsNeverCross() {
        String wad = DoomTickets.issueWad("session-W");
        String arena = DoomTickets.issue("line3", "session-W", "Player1");
        assertEquals(true, DoomTickets.redeemWad(wad));
        assertEquals(false, DoomTickets.redeemWad(arena), "an arena ticket downloads nothing");
        assertEquals(DoomTickets.WAD_SCOPE, DoomTickets.redeem(wad).arena, "the relay sees the pseudo-arena and refuses it");
        DoomTickets.revoke("session-W");
        assertEquals(false, DoomTickets.redeemWad(wad), "dies with the delegate like any other ticket");
    }

    @Test
    void unknownOrEmptyTicketsAreRefused() {
        assertNull(DoomTickets.redeem(null));
        assertNull(DoomTickets.redeem(""));
        assertNull(DoomTickets.redeem("not-a-ticket"));
    }

    @Test
    void anOlderComponentInTheSameSessionDyingKeepsTheNewerOnesTicket() {
        // Same Perspective session, two component instances over time (view refresh).
        String old = DoomTickets.issue("a", "session-1@root/doom#1", "p");
        String fresh = DoomTickets.issue("a", "session-1@root/doom#2", "p");
        DoomTickets.revoke("session-1@root/doom#1");
        assertNull(DoomTickets.redeem(old));
        assertNotNull(DoomTickets.redeem(fresh));
        DoomTickets.revoke("session-1@root/doom#2");
    }

    @Test
    void ticketsAreUnpredictableAndPerSession() {
        String a = DoomTickets.issue("a", "s1", "p1");
        String b = DoomTickets.issue("a", "s2", "p2");
        assertNotEquals(a, b);
        DoomTickets.revoke("s1");
        assertNull(DoomTickets.redeem(a));
        assertNotNull(DoomTickets.redeem(b), "revoking one session leaves the other's ticket");
        DoomTickets.revoke("s2");
    }
}
