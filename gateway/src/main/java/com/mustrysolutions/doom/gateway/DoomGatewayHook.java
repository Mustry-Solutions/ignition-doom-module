package com.mustrysolutions.doom.gateway;

import static com.mustrysolutions.doom.common.MustryDoomModule.URL_ALIAS;

import java.util.Optional;

import com.inductiveautomation.ignition.common.licensing.LicenseState;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.model.AbstractGatewayModuleHook;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;
import com.inductiveautomation.perspective.common.api.ComponentRegistry;
import com.inductiveautomation.perspective.gateway.api.ComponentModelDelegateRegistry;
import com.inductiveautomation.perspective.gateway.api.PerspectiveContext;

import com.mustrysolutions.doom.common.comp.Components;
import com.mustrysolutions.doom.common.comp.Doom;

/**
 * Gateway-scope hook. Registers the Doom component with Perspective and serves
 * the front-end bundle plus the engine assets (wasm, IWAD, config) from the
 * module's "mounted" resource folder at /res/mustry-doom/.
 */
public class DoomGatewayHook extends AbstractGatewayModuleHook {

    private static final LoggerEx log = LoggerEx.newBuilder().build("MustrySolutions.Doom.GatewayHook");

    private GatewayContext gatewayContext;
    private ComponentRegistry componentRegistry;
    private ComponentModelDelegateRegistry delegateRegistry;
    private DoomTagProvider tagProvider;

    @Override
    public void setup(GatewayContext context) {
        this.gatewayContext = context;
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
