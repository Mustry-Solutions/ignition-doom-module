package com.mustrysolutions.doom.gateway;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.inductiveautomation.ignition.common.util.LoggerEx;

import org.eclipse.jetty.ee10.websocket.server.JettyWebSocketServlet;
import org.eclipse.jetty.ee10.websocket.server.JettyWebSocketServletFactory;
import org.eclipse.jetty.websocket.api.Callback;
import org.eclipse.jetty.websocket.api.Session;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketClose;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketMessage;
import org.eclipse.jetty.websocket.api.annotations.OnWebSocketOpen;
import org.eclipse.jetty.websocket.api.annotations.WebSocket;

/**
 * Deathmatch relay: the gateway becomes the Doom "network". Chocolate Doom's
 * WebSockets transport (doom-wasm, net_websockets.c) SENDS every packet as
 * {@code [to:u32 LE][from:u32 LE][doom packet]} and expects to RECEIVE
 * {@code [from:u32 LE][doom packet]}: the relay strips the destination and
 * delivers the rest. The engine that runs with {@code -server} calls itself
 * id 1 and announces by sending an 8-byte frame with {@code to = 0}; clients
 * pick a random id and address the server as 1. Each arena (the URL's last
 * path segment) is an independent hub: frames go to the socket that owns
 * {@code to}, and a frame addressed to 0 or 1 goes to the arena's server.
 * Nothing is interpreted beyond the header, so any Doom net protocol the
 * engine speaks passes through.
 *
 * <p>Admission: the handshake must carry {@code ?ticket=<token>} issued by
 * the session's {@link DoomModelDelegate} for this arena (see
 * {@link DoomRelayTickets}); anything else is refused with 403. The engine
 * reconnects during a netgame, so a ticket stays valid for the session. The relay is
 * reachable at {@code /system/doom-relay/<arena>} on the gateway.
 */
public class DoomRelayServlet extends JettyWebSocketServlet {

    private static final LoggerEx log = LoggerEx.newBuilder().build("MustrySolutions.Doom.Relay");
    private static final long serialVersionUID = 1L;

    static final int SERVER_ID = 1;
    static final int HEADER = 8;
    static final int MAX_FRAME = 64 * 1024;

    /** arena name -> hub */
    private static final Map<String, Arena> ARENAS = new ConcurrentHashMap<>();

    static final class Arena {
        final String name;
        final Map<Integer, Session> peers = new ConcurrentHashMap<>();
        volatile Session server;

        Arena(String name) {
            this.name = name;
        }

        /** Deliver {@code [from][payload]} (the frame minus its 4-byte destination). */
        void route(int to, ByteBuffer frame, Session origin) {
            Session target = (to == 0 || to == SERVER_ID) ? server : peers.get(to);
            if (target == null || target == origin || !target.isOpen()) {
                return;
            }
            ByteBuffer out = frame.duplicate();
            out.position(out.position() + 4);
            target.sendBinary(out.slice(), Callback.NOOP);
        }

        void leave(Session session) {
            peers.values().removeIf(s -> s == session);
            if (server == session) {
                server = null;
                // Tell everyone the game is over the way the engine understands: close.
                peers.values().forEach(s -> s.close(1000, "server left", Callback.NOOP));
                peers.clear();
            }
        }

        int size() {
            return peers.size();
        }
    }

    @Override
    protected void configure(JettyWebSocketServletFactory factory) {
        factory.setIdleTimeout(Duration.ofMinutes(10));
        factory.setMaxBinaryMessageSize(MAX_FRAME);
        factory.setCreator((req, resp) -> {
            String path = req.getRequestPath();
            String arena = path.substring(path.lastIndexOf('/') + 1);
            if (arena.isBlank()) {
                arena = "default";
            }
            String token = req.getHttpServletRequest().getParameter("ticket");
            DoomRelayTickets.Ticket ticket = DoomRelayTickets.redeem(token, arena);
            if (ticket == null) {
                log.warnf("arena %s: refused a connection without a valid ticket from %s", arena,
                    req.getHttpServletRequest().getRemoteAddr());
                try {
                    resp.sendForbidden("a Doom relay ticket for this arena is required");
                } catch (java.io.IOException e) {
                    log.debug("could not send 403", e);
                }
                return null;
            }
            return new Peer(ARENAS.computeIfAbsent(arena, Arena::new), ticket.player);
        });
    }

    /** One WebSocket connection: an engine instance in one arena. */
    @WebSocket
    public static class Peer {
        private final Arena arena;
        private final String player;
        private Session session;
        private int id = -1;

        Peer(Arena arena, String player) {
            this.arena = arena;
            this.player = player;
        }

        @OnWebSocketOpen
        public void onOpen(Session session) {
            this.session = session;
            log.debugf("arena %s: %s connected from %s", arena.name, player, session.getRemoteSocketAddress());
        }

        @OnWebSocketMessage
        public void onBinary(ByteBuffer payload, Callback callback) {
            try {
                if (payload.remaining() < HEADER) {
                    return;
                }
                ByteBuffer frame = payload.duplicate().order(ByteOrder.LITTLE_ENDIAN);
                int to = frame.getInt(frame.position());
                int from = frame.getInt(frame.position() + 4);
                if (id != from) {
                    register(from);
                }
                arena.route(to, payload, session);
            } finally {
                callback.succeed();
            }
        }

        private void register(int from) {
            id = from;
            if (from == SERVER_ID) {
                Session previous = arena.server;
                arena.server = session;
                if (previous != null && previous != session && previous.isOpen()) {
                    previous.close(1000, "replaced by a new server", Callback.NOOP);
                }
                log.infof("arena %s: server announced by %s (%d peers waiting)", arena.name, player, arena.size());
            } else {
                arena.peers.put(from, session);
                log.infof("arena %s: %s joined as peer %d (%d peers)", arena.name, player, from, arena.size());
            }
        }

        @OnWebSocketClose
        public void onClose(int status, String reason) {
            arena.leave(session);
            log.infof("arena %s: %s left (%d peers left)", arena.name, id == SERVER_ID ? "server" : "peer " + id, arena.size());
            if (arena.server == null && arena.size() == 0) {
                ARENAS.remove(arena.name, arena);
            }
        }
    }
}
