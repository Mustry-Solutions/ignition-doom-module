package com.mustrysolutions.doom.common.comp;

import java.util.List;

import com.inductiveautomation.perspective.common.api.ComponentDescriptor;

/**
 * The single source of truth for the component set: BOTH hooks (gateway and
 * designer) iterate this list to register and remove components.
 */
public final class Components {

    private Components() {
    }

    public static final List<ComponentDescriptor> ALL = List.of(Doom.DESCRIPTOR);
}
