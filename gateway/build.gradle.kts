plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion.set(org.gradle.jvm.toolchain.JavaLanguageVersion.of(17))
    }
}

dependencies {
    compileOnly("com.inductiveautomation.ignitionsdk:ignition-common:${rootProject.extra["sdk_version"]}")
    compileOnly("com.inductiveautomation.ignitionsdk:gateway-api:${rootProject.extra["sdk_version"]}")
    compileOnly("com.inductiveautomation.ignitionsdk:perspective-common:${rootProject.extra["sdk_version"]}")
    compileOnly("com.inductiveautomation.ignitionsdk:perspective-gateway:${rootProject.extra["sdk_version"]}")
    compileOnly(project(":common"))
    // The deathmatch relay is a Jetty WebSocket servlet. The gateway ships
    // Jetty 12.0.27 (EE10); the SDK only exposes the websocket API + servlet
    // API transitively, so the EE10 server-side servlet package is declared
    // compile-only at the gateway's exact version. Never bundled.
    compileOnly("org.eclipse.jetty.ee10.websocket:jetty-ee10-websocket-jetty-server:12.0.27")
    // The webpack bundle (web/) is served from the gateway scope alongside the
    // engine assets in gateway/src/main/resources/mounted/doom/.
    modlImplementation(project(":web"))

    testImplementation("com.inductiveautomation.ignitionsdk:ignition-common:${rootProject.extra["sdk_version"]}")
    testImplementation("com.inductiveautomation.ignitionsdk:gateway-api:${rootProject.extra["sdk_version"]}")
    testImplementation("org.eclipse.jetty.ee10.websocket:jetty-ee10-websocket-jetty-server:12.0.27")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
    useJUnitPlatform()
}
