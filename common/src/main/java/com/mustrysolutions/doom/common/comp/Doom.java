package com.mustrysolutions.doom.common.comp;

import static com.mustrysolutions.doom.common.MustryDoomModule.descriptor;
import static com.mustrysolutions.doom.common.MustryDoomModule.event;

import java.util.List;

import com.inductiveautomation.perspective.common.api.ComponentDescriptor;

/**
 * Describes the Doom component: Chocolate Doom compiled to WebAssembly, the
 * shareware episode, rendered on a canvas inside a Perspective view. Controls
 * can be driven from tags (data.controls) so a PLC input can fire the shotgun.
 *
 * <p>The {@link #COMPONENT_ID} here MUST exactly match the {@code COMPONENT_TYPE}
 * declared in the matching TypeScript component (web/typescript/components/doom).
 */
public final class Doom {

    private Doom() {
    }

    public static final String COMPONENT_ID = "mustrysolutions.perspective.fun.doom";

    public static final ComponentDescriptor DESCRIPTOR = descriptor(
        COMPONENT_ID, "Doom", "doom",
        "Can it run Doom? Yes. Shareware Doom (1993) in a Perspective view, with tag-bindable controls. Of no industrial value whatsoever.",
        "/doom.props.json",
        List.of(
            event("onGameEvent",
                "Fires on engine lifecycle messages. Payload: { code, message }. Codes follow the doom-wasm stdout protocol (10 = game started, 9 = disconnected, ...) plus 0 for free-text lines and -1 for a fatal engine error.",
                "/doom.ongameevent.event.json")));
}
