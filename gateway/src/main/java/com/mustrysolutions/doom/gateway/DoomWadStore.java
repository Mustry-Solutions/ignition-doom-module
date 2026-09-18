package com.mustrysolutions.doom.gateway;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.mustrysolutions.doom.common.MustryDoomModule;

/**
 * Operator-supplied WADs: {@code data/modules/com.mustrysolutions.doom/wads/}.
 * The module ships the shareware IWAD only; anything else (registered IWADs,
 * PWADs) is a file the gateway operator drops into this folder, and the page
 * fetches it through the hook's {@code /data/mustry-doom/wads/<name>} route.
 * Names are matched case-insensitively with or without {@code .wad}, so
 * {@code config.iwad = "doom2"} finds {@code DOOM2.WAD}. Nothing outside the
 * folder is ever resolved.
 */
public final class DoomWadStore {

    /** A name as the page may ask for it: one path segment, no dots at the start. */
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}");
    private static final String EXT = ".wad";

    private final Path root;

    public DoomWadStore(Path dataDir) {
        this.root = dataDir.resolve("modules").resolve(MustryDoomModule.MODULE_ID).resolve("wads");
    }

    public Path root() {
        return root;
    }

    /** Create the folder so the operator can see where files go. */
    public void ensure() throws IOException {
        Files.createDirectories(root);
    }

    /** The lookup key for a requested name: lower case, without {@code .wad}; null when not a valid name. */
    public static String key(String requested) {
        if (requested == null) {
            return null;
        }
        String s = requested.trim();
        if (!NAME.matcher(s).matches()) {
            return null;
        }
        String lower = s.toLowerCase(Locale.ROOT);
        if (lower.endsWith(EXT)) {
            lower = lower.substring(0, lower.length() - EXT.length());
        }
        return lower.isEmpty() ? null : lower;
    }

    /** The keys of every {@code *.wad} in the folder, sorted. */
    public List<String> list() throws IOException {
        List<String> out = new ArrayList<>();
        if (!Files.isDirectory(root)) {
            return out;
        }
        try (Stream<Path> files = Files.list(root)) {
            files.filter(Files::isRegularFile)
                .map(p -> p.getFileName().toString())
                .filter(n -> n.toLowerCase(Locale.ROOT).endsWith(EXT))
                .map(DoomWadStore::key)
                .filter(k -> k != null)
                .sorted()
                .forEach(out::add);
        }
        return out;
    }

    /** The file for a requested name, or null when the name is invalid or no such WAD exists. */
    public Path resolve(String requested) throws IOException {
        String key = key(requested);
        if (key == null || !Files.isDirectory(root)) {
            return null;
        }
        try (Stream<Path> files = Files.list(root)) {
            return files.filter(Files::isRegularFile)
                .filter(p -> key.equals(key(p.getFileName().toString()))
                    && p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(EXT))
                .filter(p -> p.toAbsolutePath().normalize().startsWith(root.toAbsolutePath().normalize()))
                .findFirst()
                .orElse(null);
        }
    }
}
