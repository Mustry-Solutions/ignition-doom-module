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
 * A ticket is valid for its component's whole netgame (the engine reopens the
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

    /**
     * Issue a fresh ticket for one arena. {@code issuer} identifies the
     * delegate instance that asked (one per component instance), so that a
     * delegate shutting down revokes only its own tickets: a Perspective
     * session can hold several component instances over its life (view
     * refreshes, page changes) and an older one dying must not kick a newer
     * one out of its arena.
     */
    public static String issue(String arena, String issuer, String player) {
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        TICKETS.put(token, new Ticket(arena, issuer, player, System.currentTimeMillis() + TTL_MS));
        sweep();
        return token;
    }

    /**
     * Check a ticket; null when unknown, expired or revoked. The ticket names
     * the arena it was issued for and the relay routes by THAT arena: the page
     * asks for the ticket and builds the URL from one config snapshot, but a
     * binding-driven arena can still shift under it, and a mismatch must never
     * strand a marine in a 403 loop.
     */
    public static Ticket redeem(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        Ticket t = TICKETS.get(token);
        if (t == null) {
            return null;
        }
        if (t.expiresAt < System.currentTimeMillis()) {
            TICKETS.remove(token);
            return null;
        }
        return t;
    }

    /** Drop everything an issuer was issued (its delegate shut down). */
    public static void revoke(String issuer) {
        TICKETS.values().removeIf(t -> t.sessionId.equals(issuer));
    }

    private static void sweep() {
        long now = System.currentTimeMillis();
        TICKETS.values().removeIf(t -> t.expiresAt < now);
    }

    static int size() {
        return TICKETS.size();
    }

    /** For diagnostics: which classloader owns this registry. */
    static String where() {
        ClassLoader cl = DoomRelayTickets.class.getClassLoader();
        return (cl == null ? "bootstrap" : cl.getClass().getName() + "@" + Integer.toHexString(System.identityHashCode(cl)))
            + " tickets=" + TICKETS.size();
    }
}
