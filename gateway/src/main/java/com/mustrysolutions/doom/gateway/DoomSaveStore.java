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
 * Saves made with an operator-supplied IWAD live one level down, in
 * {@code <owner>/game-<iwad>/}: a Doom II save loaded into shareware Doom is
 * a crash, so the slots of different games never mix. The bundled shareware
 * IWAD keeps the owner's folder itself (the layout that existed before).
 */
public final class DoomSaveStore {

    public static final int SLOTS = 6;
    public static final int MAX_SLOT_BYTES = 512 * 1024;
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

    public synchronized JsonArray list(String owner) throws IOException {
        return list(owner, "");
    }

    /** Every stored slot for the owner and game, with its bytes base64-encoded under "data". */
    public synchronized JsonArray list(String owner, String game) throws IOException {
        JsonObject index = readIndex(owner, game);
        JsonArray out = new JsonArray();
        for (int slot = 0; slot < SLOTS; slot++) {
            Path f = slotFile(owner, game, slot);
            if (!Files.isRegularFile(f)) {
                continue;
            }
            byte[] bytes = Files.readAllBytes(f);
            JsonObject meta = index.has(String.valueOf(slot)) ? index.getAsJsonObject(String.valueOf(slot)) : new JsonObject();
            JsonObject entry = new JsonObject();
            entry.addProperty("slot", slot);
            entry.addProperty("description", meta.has("description") ? meta.get("description").getAsString() : "");
            entry.addProperty("savedAt", meta.has("savedAt") ? meta.get("savedAt").getAsString() : "");
            entry.addProperty("size", bytes.length);
            entry.addProperty("data", Base64.getEncoder().encodeToString(bytes));
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
        Path target = slotFile(owner, game, slot);
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.write(tmp, bytes);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);

        JsonObject index = readIndex(owner, game);
        JsonObject meta = new JsonObject();
        meta.addProperty("description", description == null ? "" : description);
        meta.addProperty("savedAt", Instant.now().toString());
        meta.addProperty("size", bytes.length);
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
