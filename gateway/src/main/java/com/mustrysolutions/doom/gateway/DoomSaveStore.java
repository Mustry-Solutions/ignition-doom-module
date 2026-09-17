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

    private Path ownerDir(String owner) {
        return root.resolve(owner);
    }

    private Path slotFile(String owner, int slot) {
        return ownerDir(owner).resolve("slot" + slot + ".dsg");
    }

    private Path indexFile(String owner) {
        return ownerDir(owner).resolve("index.json");
    }

    /** Every stored slot for the owner, with its bytes base64-encoded under "data". */
    public synchronized JsonArray list(String owner) throws IOException {
        JsonObject index = readIndex(owner);
        JsonArray out = new JsonArray();
        for (int slot = 0; slot < SLOTS; slot++) {
            Path f = slotFile(owner, slot);
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

    /** Store one slot atomically and record it in the index. */
    public synchronized void put(String owner, int slot, String description, byte[] bytes) throws IOException {
        if (!isValidSlot(slot)) {
            throw new IllegalArgumentException("slot out of range: " + slot);
        }
        if (bytes.length == 0 || bytes.length > MAX_SLOT_BYTES) {
            throw new IllegalArgumentException("slot size out of range: " + bytes.length + " bytes");
        }
        Files.createDirectories(ownerDir(owner));
        Path target = slotFile(owner, slot);
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.write(tmp, bytes);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);

        JsonObject index = readIndex(owner);
        JsonObject meta = new JsonObject();
        meta.addProperty("description", description == null ? "" : description);
        meta.addProperty("savedAt", Instant.now().toString());
        meta.addProperty("size", bytes.length);
        index.add(String.valueOf(slot), meta);
        Files.writeString(indexFile(owner), index.toString(), StandardCharsets.UTF_8);
    }

    private JsonObject readIndex(String owner) throws IOException {
        Path f = indexFile(owner);
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
