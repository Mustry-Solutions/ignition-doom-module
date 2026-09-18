package com.mustrysolutions.doom.gateway;

import static com.mustrysolutions.doom.common.MustryDoomModule.URL_ALIAS;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import com.inductiveautomation.ignition.common.licensing.LicenseState;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.dataroutes.AccessControlStrategy;
import com.inductiveautomation.ignition.gateway.dataroutes.HttpMethod;
import com.inductiveautomation.ignition.gateway.dataroutes.RequestContext;
import com.inductiveautomation.ignition.gateway.dataroutes.RouteAccess;
import com.inductiveautomation.ignition.gateway.dataroutes.RouteGroup;
import com.inductiveautomation.ignition.gateway.model.AbstractGatewayModuleHook;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;
import com.inductiveautomation.ignition.gateway.web.WebResourceManager;
import com.inductiveautomation.perspective.common.api.ComponentRegistry;
import com.inductiveautomation.perspective.gateway.api.ComponentModelDelegateRegistry;
import com.inductiveautomation.perspective.gateway.api.PerspectiveContext;

import jakarta.servlet.http.HttpServletResponse;

import com.mustrysolutions.doom.common.comp.Components;
import com.mustrysolutions.doom.common.comp.Doom;

/**
 * Gateway-scope hook. Registers the Doom component with Perspective and serves
 * the front-end bundle plus the engine assets (wasm, IWAD, config) from the
 * module's "mounted" resource folder at /res/mustry-doom/. Operator-supplied
 * WADs ({@link DoomWadStore}) are served by a data route at
 * /data/mustry-doom/wads/<name>, to pages holding a download ticket.
 */
public class DoomGatewayHook extends AbstractGatewayModuleHook {

    private static final LoggerEx log = LoggerEx.newBuilder().build("MustrySolutions.Doom.GatewayHook");

    private GatewayContext gatewayContext;
    private ComponentRegistry componentRegistry;
    private ComponentModelDelegateRegistry delegateRegistry;
    private DoomTagProvider tagProvider;
    private DoomWadStore wadStore;

    /** The relay servlet's name; it answers at /system/<name>/<arena>. */
    static final String RELAY_SERVLET = "doom-relay";

    /** The request header that carries the download ticket (a header keeps the URL cacheable per browser). */
    static final String TICKET_HEADER = "X-Doom-Ticket";

    @Override
    public void setup(GatewayContext context) {
        this.gatewayContext = context;
        this.wadStore = new DoomWadStore(context.getSystemManager().getDataDir().toPath());
        try {
            this.wadStore.ensure();
            log.infof("Operator WADs are read from %s", this.wadStore.root());
        } catch (IOException e) {
            log.warn("Could not create the operator WAD folder " + this.wadStore.root(), e);
        }
    }

    /** The route's access control: a WAD download ticket, in the header or as {@code ?ticket=}. */
    static final AccessControlStrategy WAD_TICKET = (RequestContext req) -> {
        String ticket = req.getRequest().getHeader(TICKET_HEADER);
        if (ticket == null) {
            ticket = req.getParameter("ticket");
        }
        return DoomRelayTickets.redeemWad(ticket) ? RouteAccess.GRANTED : RouteAccess.FORBIDDEN;
    };

    /**
     * {@code GET /data/mustry-doom/wads/<name>}: one operator-supplied WAD,
     * for a page that holds a ticket from its delegate. 403 without one,
     * 404 for a name the folder does not have. Never lists the folder: the
     * delegate tells its own session what is there.
     */
    @Override
    public void mountRouteHandlers(RouteGroup routes) {
        routes.newRoute("/wads/:name")
            .method(HttpMethod.GET)
            .type(RouteGroup.TYPE_OCTET_STREAM)
            .accessControl(WAD_TICKET)
            .nocache()
            .handler((req, res) -> {
                Path file = this.wadStore == null ? null : this.wadStore.resolve(req.getParameter("name"));
                if (file == null) {
                    res.sendError(HttpServletResponse.SC_NOT_FOUND, "no such WAD on the gateway");
                    return null;
                }
                res.setStatus(HttpServletResponse.SC_OK);
                res.setContentType(RouteGroup.TYPE_OCTET_STREAM);
                res.setContentLengthLong(Files.size(file));
                // The ticket is per component instance; let the browser keep the
                // bytes for a while so a restart does not refetch 15 MB.
                res.setHeader("Cache-Control", "private, max-age=3600");
                try (OutputStream out = res.getOutputStream()) {
                    Files.copy(file, out);
                }
                return null;
            })
            .mount();
    }

    @Override
    public void startup(LicenseState activationState) {
        PerspectiveContext perspectiveContext = PerspectiveContext.get(this.gatewayContext);
        this.componentRegistry = perspectiveContext.getComponentRegistry();
        if (this.componentRegistry != null) {
            log.info("Registering the Doom component. Rip and tear.");
            Components.ALL.forEach(this.componentRegistry::registerComponent);
        } else {
            log.error("Perspective component registry not found; Doom not registered.");
        }
        // Deathmatch relay: a WebSocket hub at /system/doom-relay/<arena>.
        try {
            WebResourceManager web = this.gatewayContext.getWebResourceManager();
            web.addServlet(RELAY_SERVLET, DoomRelayServlet.class);
            log.info("Doom deathmatch relay mounted at /system/" + RELAY_SERVLET + "/<arena>");
        } catch (RuntimeException e) {
            log.error("Could not mount the Doom relay servlet; multiplayer disabled.", e);
        }
        // The module's own [Doom] tag provider, fed by the component's telemetry.
        try {
            this.tagProvider = new DoomTagProvider(this.gatewayContext);
        } catch (RuntimeException e) {
            log.error("Could not create the [Doom] tag provider; telemetry tags disabled.", e);
            this.tagProvider = null;
        }
        // Save games + telemetry: one gateway-side delegate per Doom component instance.
        this.delegateRegistry = perspectiveContext.getComponentModelDelegateRegistry();
        if (this.delegateRegistry != null) {
            final DoomTagProvider tags = this.tagProvider;
            this.delegateRegistry.register(Doom.COMPONENT_ID, c -> new DoomModelDelegate(c, tags));
        } else {
            log.warn("Component model delegate registry not found; save games and telemetry tags disabled.");
        }
    }

    @Override
    public void shutdown() {
        if (this.delegateRegistry != null) {
            this.delegateRegistry.remove(Doom.COMPONENT_ID);
        }
        if (this.componentRegistry != null) {
            Components.ALL.forEach(d -> this.componentRegistry.removeComponent(d.id()));
        }
        if (this.tagProvider != null) {
            this.tagProvider.shutdown();
            this.tagProvider = null;
        }
        try {
            this.gatewayContext.getWebResourceManager().removeServlet(RELAY_SERVLET);
        } catch (RuntimeException e) {
            log.warn("Could not unmount the Doom relay servlet", e);
        }
    }

    @Override
    public Optional<String> getMountedResourceFolder() {
        return Optional.of("mounted");
    }

    @Override
    public Optional<String> getMountPathAlias() {
        return Optional.of(URL_ALIAS);
    }

    @Override
    public boolean isFreeModule() {
        return true;
    }
}
