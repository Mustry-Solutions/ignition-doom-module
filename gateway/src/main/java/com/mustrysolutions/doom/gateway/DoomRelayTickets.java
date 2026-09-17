package com.mustrysolutions.doom.gateway;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Admission control for the deathmatch relay. A Perspective session that runs
 * the Doom component asks its gateway delegate for a ticket (over the already
 * authenticated component channel); the relay accepts a WebSocket only when
 * the handshake carries a ticket issued for that arena. Sessions that never
 * went through the component, and anything outside Perspective, get 403.
 * A ticket is valid for its session's whole netgame (the engine reopens the
 * socket when the server side sends its first reply, so one handshake is not
 * enough); it expires after a while and dies with the session's delegate.
 */
public final class DoomRelayTickets {

    /** Long enough for a lobby wait plus a match; the delegate revokes it earlier when the session ends. */
    private static final long TTL_MS = 4 * 60 * 60 * 1000L;
    private static final SecureRandom RANDOM = new SecureRandom();

    static final class Ticket {
        final String arena;
        final String sessionId;
        final String player;
        final long expiresAt;

        Ticket(String arena, String sessionId, String player, long expiresAt) {
            this.arena = arena;
            this.sessionId = sessionId;
            this.player = player;
            this.expiresAt = expiresAt;
        }
    }

    private static final Map<String, Ticket> TICKETS = new ConcurrentHashMap<>();

    private DoomRelayTickets() {
    }

    /** Issue a fresh ticket for one arena on behalf of a session. */
    public static String issue(String arena, String sessionId, String player) {
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        TICKETS.put(token, new Ticket(arena, sessionId, player, System.currentTimeMillis() + TTL_MS));
        sweep();
        return token;
    }

    /** Check a ticket for an arena; null when unknown, expired, revoked or for another arena. */
    public static Ticket redeem(String token, String arena) {
        if (token == null || token.isBlank()) {
            return null;
        }
        Ticket t = TICKETS.get(token);
        if (t == null || !t.arena.equals(arena)) {
            return null;
        }
        if (t.expiresAt < System.currentTimeMillis()) {
            TICKETS.remove(token);
            return null;
        }
        return t;
    }

    /** Drop everything a session was issued (its delegate shut down). */
    public static void revokeSession(String sessionId) {
        TICKETS.values().removeIf(t -> t.sessionId.equals(sessionId));
    }

    private static void sweep() {
        long now = System.currentTimeMillis();
        TICKETS.values().removeIf(t -> t.expiresAt < now);
    }

    static int size() {
        return TICKETS.size();
    }
}
