package com.mustrysolutions.doom.gateway;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Admission tickets: for the deathmatch relay and for operator WAD downloads.
 *
 * <p>Relay: a Perspective session that runs
 * the Doom component asks its gateway delegate for a ticket (over the already
 * authenticated component channel); the relay accepts a WebSocket only when
 * the handshake carries a ticket issued for that arena. Sessions that never
 * went through the component, and anything outside Perspective, get 403.
 * A ticket is valid for its component's whole netgame (the engine reopens the
 * socket when the server side sends its first reply, so one handshake is not
 * enough); it expires after a while and dies with the session's delegate.
 *
 * <p>The same registry admits WAD downloads: operator-supplied WADs under
 * the hook's {@code /data/mustry-doom/wads/} route are served only to a page
 * holding a ticket issued for the {@link #WAD_SCOPE} pseudo-arena, so a
 * registered IWAD the operator dropped in is not a public download for
 * anyone who can reach the gateway's port. The two kinds never cross: a WAD
 * ticket is refused by the relay and vice versa.
 */
public final class DoomTickets {

    /** Pseudo-arena for WAD download tickets; unreachable as a real arena (arenaKey strips '#'). */
    static final String WAD_SCOPE = "#wads";

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

    private DoomTickets() {
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

    /** A ticket that admits its holder to the WAD download route. */
    public static String issueWad(String issuer) {
        return issue(WAD_SCOPE, issuer, "");
    }

    /** True when a valid ticket admits WAD downloads (never the relay). */
    public static boolean redeemWad(String token) {
        Ticket t = redeem(token);
        return t != null && WAD_SCOPE.equals(t.arena);
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
        ClassLoader cl = DoomTickets.class.getClassLoader();
        return (cl == null ? "bootstrap" : cl.getClass().getName() + "@" + Integer.toHexString(System.identityHashCode(cl)))
            + " tickets=" + TICKETS.size();
    }
}
