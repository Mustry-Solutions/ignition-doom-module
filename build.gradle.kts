/*
 * Mustry Doom — a deliberately useless Ignition 8.3 module that runs Doom in a
 * Perspective component. Structure mirrors mustry-perspective-component-module
 * (Gradle + the Ignition modl plugin, a webpack web subproject bundled into the
 * gateway scope). Licensed GPL-2.0 because the bundled engine (Chocolate Doom,
 * via Cloudflare's doom-wasm port) is GPL-2.0.
 */

plugins {
    id("io.ia.sdk.modl") version("0.5.0")
}

val sdk_version by extra("8.3.6")

allprojects {
    version = (project.findProperty("releaseVersion") as String?)?.removePrefix("v") ?: "0.1.0-SNAPSHOT"
}

ignitionModule {
    name.set("Mustry Doom")
    fileName.set("Mustry-Doom")
    id.set("com.mustrysolutions.doom")

    // Ignition's module version parser accepts only numeric x.y.z(.b).
    moduleVersion.set(project.provider {
        val v = project.version.toString()
        val base = v.substringBefore("-")
        val preNumber = Regex("[0-9]+$").find(v.substringAfter("-", ""))?.value
        if (v.contains("-") && preNumber != null) "$base.$preNumber" else base
    })

    moduleDescription.set("Can it run Doom? Yes - and Heretic, Hexen and Strife. A Perspective component with tag-bindable controls, alarm-aware pause, its own tag provider, per-user save games and a deathmatch relay. Free, GPL-2.0, of no industrial value whatsoever. By Mustry Solutions (mustrysolutions.com).")

    requiredIgnitionVersion.set(sdk_version)

    projectScopes.putAll(mapOf(
        ":common" to "GD",
        ":designer" to "D",
        ":gateway" to "G"
    ))

    moduleDependencies.set(mapOf<String, String>())

    moduleDependencySpecs {
        register("com.inductiveautomation.perspective") {
            scope = "GD"
            required = true
        }
    }

    hooks.putAll(mapOf(
        "com.mustrysolutions.doom.gateway.DoomGatewayHook" to "G",
        "com.mustrysolutions.doom.designer.DoomDesignerHook" to "D"
    ))

    // Free: no trial, no activation. The shareware WAD licence forbids charging
    // for it, and the engine is GPL — this module can never be a paid product.
    freeModule.set(true)

    // Sign only when signing credentials are supplied via -Pignition.signing.*
    skipModlSigning.set(!project.hasProperty("ignition.signing.keystoreFile"))
}

// The EULA ships inside the .modl (license.html) and is shown at install time.
tasks.named("assembleModlStructure") {
    doLast {
        copy {
            from("license.html")
            into(layout.buildDirectory.dir("moduleContent"))
        }
    }
}

tasks.named("zipModule") {
    doFirst {
        val moduleXml = layout.buildDirectory.file("moduleContent/module.xml").get().asFile
        val content = moduleXml.readText()
        if (!content.contains("<license>")) {
            moduleXml.writeText(
                content.replace("</module>", "\t\t<license>license.html</license>\n\t</module>")
            )
        }
    }
}
