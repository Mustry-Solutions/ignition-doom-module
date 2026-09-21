package com.mustrysolutions.doom.gateway;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;

import com.inductiveautomation.ignition.common.gson.JsonArray;
import com.inductiveautomation.ignition.common.gson.JsonObject;
import com.inductiveautomation.ignition.common.gson.JsonParser;

import com.mustrysolutions.doom.common.MustryDoomModule;

/**
 * Per-user Doom save-game slots on the gateway's disk:
 * {@code data/modules/com.mustrysolutions.doom/saves/<owner>/slot<N>.dsg}
 * plus an {@code index.json} with the slot descriptions and timestamps.
 * Owners are sanitised usernames (or "anonymous"); a session can only reach
 * its own folder because the delegate derives the owner from the session.
 * A game whose slot is several files (Hexen: hex<N>.hxs plus one archive per
 * visited hub map) stores them under {@code slot<N>/<name>} instead of
 * {@code slot<N>.dsg}; the listing hands them back as {@code files}.
 * Saves made with an operator-supplied IWAD live one level down, in
 * {@code <owner>/game-<iwad>/}: a Doom II save loaded into shareware Doom is
 * a crash, so the slots of different games never mix. The bundled shareware
 * IWAD keeps the owner's folder itself (the layout that existed before).
 */
public final class DoomSaveStore {

    public static final int SLOTS = 6;
    /** Per file. A Hexen hub archive can be a few hundred KB; vanilla Doom saves are tens. */
    public static final int MAX_SLOT_BYTES = 2 * 1024 * 1024;
    public static final int MAX_SLOT_FILES = 64;
    private static final java.util.regex.Pattern FILE_NAME = java.util.regex.Pattern.compile("[a-z0-9_-]{1,24}\\.[a-z0-9]{1,8}");
    public static final String ANONYMOUS = "anonymous";

    private final Path root;

    public DoomSaveStore(Path dataDir) {
        this.root = dataDir.resolve("modules").resolve(MustryDoomModule.MODULE_ID).resolve("saves");
    }

    /** A filesystem-safe owner key: letters, digits, dot, dash, underscore; else "anonymous". */
    public static String ownerKey(String userName) {
        if (userName == null || userName.isBlank()) {
            return ANONYMOUS;
        }
        String key = userName.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9._-]", "_");
        if (key.isBlank() || key.startsWith(".")) {
            return ANONYMOUS;
        }
        return key.length() > 64 ? key.substring(0, 64) : key;
    }

    public static boolean isValidSlot(int slot) {
        return slot >= 0 && slot < SLOTS;
    }

    /** The bundled IWAD's key; its saves stay in the owner's own folder. */
    public static final String BUNDLED_IWAD = "doom1";

    /** The folder for an owner's saves of one game; {@code game} is a WAD key or empty for shareware. */
    static Path gameDir(Path root, String owner, String game) {
        Path dir = root.resolve(owner);
        String key = DoomWadStore.key(game);
        if (key == null || BUNDLED_IWAD.equals(key)) {
            return dir;
        }
        return dir.resolve("game-" + key);
    }

    private Path ownerDir(String owner, String game) {
        return gameDir(root, owner, game);
    }

    private Path slotFile(String owner, String game, int slot) {
        return ownerDir(owner, game).resolve("slot" + slot + ".dsg");
    }

    private Path indexFile(String owner, String game) {
        return ownerDir(owner, game).resolve("index.json");
    }

    private Path slotDir(String owner, String game, int slot) {
        return ownerDir(owner, game).resolve("slot" + slot);
    }

    /** A save file name as the engine wrote it into -savedir; rejects anything that is not one plain name. */
    static String fileKey(String name) {
        String n = name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
        if (!FILE_NAME.matcher(n).matches()) {
            throw new IllegalArgumentException("not a save file name: " + name);
        }
        return n;
    }

    public synchronized JsonArray list(String owner) throws IOException {
        return list(owner, "");
    }

    /** Every stored slot for the owner and game, with its bytes base64-encoded under "data". */
    public synchronized JsonArray list(String owner, String game) throws IOException {
        JsonObject index = readIndex(owner, game);
        JsonArray out = new JsonArray();
        for (int slot = 0; slot < SLOTS; slot++) {
            Path f = slotFile(owner, game, slot);
            Path dir = slotDir(owner, game, slot);
            boolean single = Files.isRegularFile(f);
            if (!single && !Files.isDirectory(dir)) {
                continue;
            }
            JsonObject meta = index.has(String.valueOf(slot)) ? index.getAsJsonObject(String.valueOf(slot)) : new JsonObject();
            JsonObject entry = new JsonObject();
            entry.addProperty("slot", slot);
            entry.addProperty("description", meta.has("description") ? meta.get("description").getAsString() : "");
            entry.addProperty("savedAt", meta.has("savedAt") ? meta.get("savedAt").getAsString() : "");
            if (single) {
                byte[] bytes = Files.readAllBytes(f);
                entry.addProperty("size", bytes.length);
                entry.addProperty("data", Base64.getEncoder().encodeToString(bytes));
            } else {
                JsonArray files = new JsonArray();
                long size = 0;
                List<Path> names = new ArrayList<>();
                try (java.util.stream.Stream<Path> st = Files.list(dir)) {
                    st.filter(Files::isRegularFile).sorted().forEach(names::add);
                }
                for (Path p : names) {
                    byte[] bytes = Files.readAllBytes(p);
                    JsonObject file = new JsonObject();
                    file.addProperty("name", p.getFileName().toString());
                    file.addProperty("data", Base64.getEncoder().encodeToString(bytes));
                    files.add(file);
                    size += bytes.length;
                }
                entry.addProperty("size", size);
                entry.add("files", files);
            }
            out.add(entry);
        }
        return out;
    }

    public synchronized void put(String owner, int slot, String description, byte[] bytes) throws IOException {
        put(owner, "", slot, description, bytes);
    }

    /** Store one slot atomically and record it in the index. */
    public synchronized void put(String owner, String game, int slot, String description, byte[] bytes) throws IOException {
        if (!isValidSlot(slot)) {
            throw new IllegalArgumentException("slot out of range: " + slot);
        }
        if (bytes.length == 0 || bytes.length > MAX_SLOT_BYTES) {
            throw new IllegalArgumentException("slot size out of range: " + bytes.length + " bytes");
        }
        Files.createDirectories(ownerDir(owner, game));
        deleteTree(slotDir(owner, game, slot)); // a slot is one file OR one folder, never both
        Path target = slotFile(owner, game, slot);
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.write(tmp, bytes);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);

        writeIndex(owner, game, slot, description, bytes.length);
    }

    /**
     * Store a multi-file slot: the engine's own file names under slot<N>/.
     * Written into a fresh folder and swapped in, so a listing never sees a
     * half-copied hub.
     */
    public synchronized void put(String owner, String game, int slot, String description, java.util.Map<String, byte[]> files)
            throws IOException {
        if (!isValidSlot(slot)) {
            throw new IllegalArgumentException("slot out of range: " + slot);
        }
        if (files.isEmpty() || files.size() > MAX_SLOT_FILES) {
            throw new IllegalArgumentException("slot file count out of range: " + files.size());
        }
        long total = 0;
        for (java.util.Map.Entry<String, byte[]> e : files.entrySet()) {
            fileKey(e.getKey());
            if (e.getValue().length == 0 || e.getValue().length > MAX_SLOT_BYTES) {
                throw new IllegalArgumentException("save file size out of range: " + e.getKey() + " " + e.getValue().length + " bytes");
            }
            total += e.getValue().length;
        }
        Files.createDirectories(ownerDir(owner, game));
        Path dir = slotDir(owner, game, slot);
        Path staging = dir.resolveSibling(dir.getFileName() + ".tmp");
        deleteTree(staging);
        Files.createDirectories(staging);
        for (java.util.Map.Entry<String, byte[]> e : files.entrySet()) {
            Files.write(staging.resolve(fileKey(e.getKey())), e.getValue());
        }
        deleteTree(dir);
        Files.deleteIfExists(slotFile(owner, game, slot));
        Files.move(staging, dir, StandardCopyOption.ATOMIC_MOVE);

        writeIndex(owner, game, slot, description, total);
    }

    private static void deleteTree(Path root) throws IOException {
        if (!Files.exists(root)) {
            return;
        }
        try (java.util.stream.Stream<Path> walk = Files.walk(root)) {
            for (Path p : walk.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(p);
            }
        }
    }

    private void writeIndex(String owner, String game, int slot, String description, long size) throws IOException {
        JsonObject index = readIndex(owner, game);
        JsonObject meta = new JsonObject();
        meta.addProperty("description", description == null ? "" : description);
        meta.addProperty("savedAt", Instant.now().toString());
        meta.addProperty("size", size);
        index.add(String.valueOf(slot), meta);
        Files.writeString(indexFile(owner, game), index.toString(), StandardCharsets.UTF_8);
    }

    private JsonObject readIndex(String owner, String game) throws IOException {
        Path f = indexFile(owner, game);
        if (!Files.isRegularFile(f)) {
            return new JsonObject();
        }
        try {
            return JsonParser.parseString(Files.readString(f, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (RuntimeException e) {
            return new JsonObject(); // a damaged index only loses names/timestamps, never the saves
        }
    }
}
