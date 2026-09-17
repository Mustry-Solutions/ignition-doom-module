package com.mustrysolutions.doom.common;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.util.List;
import java.util.Set;

import javax.swing.ImageIcon;

import com.inductiveautomation.ignition.common.jsonschema.JsonSchema;
import com.inductiveautomation.perspective.common.api.BrowserResource;
import com.inductiveautomation.perspective.common.api.ComponentDescriptor;
import com.inductiveautomation.perspective.common.api.ComponentDescriptorImpl;
import com.inductiveautomation.perspective.common.api.ComponentEventDescriptor;

/**
 * Module-wide constants shared across the gateway, designer and common scopes.
 */
public final class MustryDoomModule {

    private MustryDoomModule() {
    }

    /** Module id — must match {@code id} in the root build.gradle.kts. */
    public static final String MODULE_ID = "com.mustrysolutions.doom";

    /** Mount alias: the module's web resources are served at {@code /res/<URL_ALIAS>/}. */
    public static final String URL_ALIAS = "mustry-doom";

    /**
     * Where the engine lives under the mount: the Emscripten build of Chocolate
     * Doom (websockets-doom.js + .wasm), the shareware IWAD and the default
     * config. Served from gateway/src/main/resources/mounted/doom/.
     */
    public static final String ENGINE_PATH = "/res/" + URL_ALIAS + "/doom/";

    /** Palette category the component appears under in the Designer. */
    public static final String COMPONENT_CATEGORY = "Mustry Solutions";

    /** The JS/CSS bundle Perspective loads for this module's component. */
    public static final Set<BrowserResource> BROWSER_RESOURCES = Set.of(
        new BrowserResource(
            "mustry-doom-js",
            String.format("/res/%s/MustryDoom.js", URL_ALIAS),
            BrowserResource.ResourceType.JS
        ),
        new BrowserResource(
            "mustry-doom-css",
            String.format("/res/%s/MustryDoom.css", URL_ALIAS),
            BrowserResource.ResourceType.CSS
        )
    );

    public static JsonSchema schema(String resourcePath) {
        return JsonSchema.parse(MustryDoomModule.class.getResourceAsStream(resourcePath));
    }

    public static ComponentEventDescriptor event(String name, String description, String schemaResource) {
        return new ComponentEventDescriptor(name, description, schema(schemaResource));
    }

    public static ComponentDescriptor descriptor(String id, String name, String metaName,
            String paletteDescription, String schemaResource, List<ComponentEventDescriptor> events) {
        BufferedImage icon = paletteIcon();
        ComponentDescriptorImpl.ComponentBuilder builder = ComponentDescriptorImpl.ComponentBuilder.newBuilder()
            .setPaletteCategory(COMPONENT_CATEGORY)
            .setId(id)
            .setModuleId(MODULE_ID)
            .setSchema(schema(schemaResource))
            .setName(name)
            .setIcon(new ImageIcon(icon))
            .addPaletteEntry("", name, paletteDescription, icon, null)
            .setDefaultMetaName(metaName)
            .setResources(BROWSER_RESOURCES);
        if (events != null && !events.isEmpty()) {
            builder.setEvents(events);
        }
        return builder.build();
    }

    /**
     * A 16x16 palette icon drawn with Java2D (headless-safe, no binary assets):
     * a pentagram inside a circle. Subtle.
     */
    public static BufferedImage paletteIcon() {
        int s = 16;
        BufferedImage img = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(new Color(0xB0, 0x1E, 0x1E));
        g.setStroke(new BasicStroke(1.2f));
        g.drawOval(1, 1, 13, 13);
        double cx = 8, cy = 8, r = 6;
        int[] xs = new int[5];
        int[] ys = new int[5];
        for (int i = 0; i < 5; i++) {
            double a = -Math.PI / 2 + i * 2 * Math.PI / 5;
            xs[i] = (int) Math.round(cx + r * Math.cos(a));
            ys[i] = (int) Math.round(cy + r * Math.sin(a));
        }
        // Star: connect every second vertex.
        for (int i = 0; i < 5; i++) {
            int j = (i + 2) % 5;
            g.drawLine(xs[i], ys[i], xs[j], ys[j]);
        }
        g.dispose();
        return img;
    }
}
