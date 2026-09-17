import com.github.gradle.node.npm.task.NpmTask

plugins {
    java
    id("com.github.node-gradle.node") version "7.1.0"
}

// Where webpack writes the built bundle; this whole dir becomes module resources.
val projectOutput: Provider<Directory> = layout.buildDirectory.dir("generated-resources")

node {
    version.set("22.23.2")
    download.set(true)
    nodeProjectDir.set(file(project.projectDir))
}

val webDev = project.hasProperty("webDev")
val webpack by tasks.registering(NpmTask::class) {
    group = "Ignition Module"
    description = "Builds the web (React/TypeScript) bundle with webpack (-PwebDev for a development build)."
    args.set(listOf("run", if (webDev) "build:dev" else "build"))
    dependsOn(tasks.named("npmInstall"))
    inputs.property("webDev", webDev)
    inputs.dir("typescript")
    inputs.files("package.json", "package-lock.json", "webpack.config.js", "tsconfig.json")
    outputs.dir(projectOutput)
}

val jestTest by tasks.registering(NpmTask::class) {
    group = "verification"
    description = "Runs the web (React/TypeScript) unit tests with Jest."
    args.set(listOf("test"))
    dependsOn(tasks.named("npmInstall"))
    inputs.dir("typescript")
    inputs.files("package.json", "package-lock.json", "jest.config.js", "tsconfig.json", "tsconfig.test.json")
}

tasks.named("check") {
    dependsOn(jestTest)
}

tasks.named("processResources") {
    dependsOn(webpack)
}

sourceSets {
    main {
        output.dir(projectOutput, "builtBy" to webpack)
    }
}
