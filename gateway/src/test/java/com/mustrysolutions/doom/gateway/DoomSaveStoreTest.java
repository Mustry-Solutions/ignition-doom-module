package com.mustrysolutions.doom.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

import com.inductiveautomation.ignition.common.gson.JsonArray;
import com.inductiveautomation.ignition.common.gson.JsonObject;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DoomSaveStoreTest {

    @TempDir
    Path dataDir;

    @Test
    void ownersAreSanitisedAndNeverEscapeTheirFolder() {
        assertEquals("sam.donche", DoomSaveStore.ownerKey("Sam.Donche"));
        assertEquals("a_b_c", DoomSaveStore.ownerKey("a b/c"));
        assertEquals(DoomSaveStore.ANONYMOUS, DoomSaveStore.ownerKey("../etc"));
        assertEquals(DoomSaveStore.ANONYMOUS, DoomSaveStore.ownerKey(""));
        assertEquals(DoomSaveStore.ANONYMOUS, DoomSaveStore.ownerKey(null));
    }

    @Test
    void putThenListRoundTripsPerOwner() throws Exception {
        DoomSaveStore store = new DoomSaveStore(dataDir);
        byte[] save = "E1M1 before the bridge\0\0rest-of-save".getBytes();
        store.put("alice", 0, "E1M1 before the bridge", save);
        store.put("bob", 3, "bob's", new byte[] {1, 2, 3});

        JsonArray alice = store.list("alice");
        assertEquals(1, alice.size());
        JsonObject slot = alice.get(0).getAsJsonObject();
        assertEquals(0, slot.get("slot").getAsInt());
        assertEquals("E1M1 before the bridge", slot.get("description").getAsString());
        assertEquals(save.length, slot.get("size").getAsInt());
        assertEquals(Base64.getEncoder().encodeToString(save), slot.get("data").getAsString());
        assertTrue(slot.get("savedAt").getAsString().endsWith("Z"));

        assertEquals(1, store.list("bob").size());
        assertEquals(3, store.list("bob").get(0).getAsJsonObject().get("slot").getAsInt());
        assertEquals(0, store.list("carol").size());
        assertTrue(Files.isRegularFile(dataDir.resolve("modules/com.mustrysolutions.doom/saves/alice/slot0.dsg")));
    }

    @Test
    void rejectsBadSlotsAndOversizedSaves() {
        DoomSaveStore store = new DoomSaveStore(dataDir);
        assertThrows(IllegalArgumentException.class, () -> store.put("x", 6, "", new byte[] {1}));
        assertThrows(IllegalArgumentException.class, () -> store.put("x", -1, "", new byte[] {1}));
        assertThrows(IllegalArgumentException.class, () -> store.put("x", 0, "", new byte[0]));
        assertThrows(IllegalArgumentException.class, () -> store.put("x", 0, "", new byte[DoomSaveStore.MAX_SLOT_BYTES + 1]));
    }

    @Test
    void overwritingASlotReplacesItAtomically() throws Exception {
        DoomSaveStore store = new DoomSaveStore(dataDir);
        store.put("alice", 1, "first", new byte[] {1});
        store.put("alice", 1, "second", new byte[] {2, 2});
        JsonArray slots = store.list("alice");
        assertEquals(1, slots.size());
        assertEquals("second", slots.get(0).getAsJsonObject().get("description").getAsString());
        assertEquals(2, slots.get(0).getAsJsonObject().get("size").getAsInt());
        assertTrue(Files.notExists(dataDir.resolve("modules/com.mustrysolutions.doom/saves/alice/slot1.dsg.tmp")));
    }

    @Test
    void savesOfDifferentGamesNeverMix() throws IOException {
        DoomSaveStore store = new DoomSaveStore(dataDir);
        store.put("alice", 0, "shareware", new byte[] {1});
        store.put("alice", "DOOM2.WAD", 0, "hell on earth", new byte[] {2});
        store.put("alice", "doom1", 1, "also shareware", new byte[] {3});
        assertEquals(2, store.list("alice").size(), "doom1 is the bundled game: same folder as no game");
        assertEquals(2, store.list("alice", "doom1.wad").size());
        assertEquals(1, store.list("alice", "doom2").size());
        assertEquals("hell on earth", store.list("alice", "doom2").get(0).getAsJsonObject().get("description").getAsString());
        assertEquals(0, store.list("alice", "tnt").size());
        assertEquals(dataDir.resolve("modules").resolve("com.mustrysolutions.doom").resolve("saves").resolve("alice").resolve("game-doom2"),
            DoomSaveStore.gameDir(dataDir.resolve("modules").resolve("com.mustrysolutions.doom").resolve("saves"), "alice", "Doom2"));
        assertEquals(store.list("alice").size(), store.list("alice", "../x").size(), "an invalid game key means the default game");
    }

    @Test
    void aMultiFileSlotRoundTripsAndReplacesASingleFileOne() throws IOException {
        DoomSaveStore store = new DoomSaveStore(dataDir);
        store.put("alice", "hexen", 2, "single", new byte[] {9});
        java.util.Map<String, byte[]> hub = new java.util.LinkedHashMap<>();
        hub.put("hex2.hxs", new byte[] {1, 2});
        hub.put("hex201.hxs", new byte[] {3});
        hub.put("HEX202.HXS", new byte[] {4, 4, 4});
        store.put("alice", "hexen", 2, "seven portals", hub);

        JsonArray slots = store.list("alice", "hexen");
        assertEquals(1, slots.size());
        JsonObject slot = slots.get(0).getAsJsonObject();
        assertEquals(2, slot.get("slot").getAsInt());
        assertEquals("seven portals", slot.get("description").getAsString());
        assertEquals(6, slot.get("size").getAsLong());
        assertTrue(!slot.has("data"), "a multi-file slot carries files, not data");
        JsonArray files = slot.getAsJsonArray("files");
        assertEquals(3, files.size());
        assertEquals("hex2.hxs", files.get(0).getAsJsonObject().get("name").getAsString());
        assertEquals("hex202.hxs", files.get(2).getAsJsonObject().get("name").getAsString(), "names are lower-cased");
        assertEquals("AQI=", files.get(0).getAsJsonObject().get("data").getAsString());

        // Back to a single file: the folder goes away.
        store.put("alice", "hexen", 2, "single again", new byte[] {7});
        JsonObject again = store.list("alice", "hexen").get(0).getAsJsonObject();
        assertTrue(again.has("data"));
        assertTrue(!again.has("files"));

        assertThrows(IllegalArgumentException.class, () -> store.put("alice", "hexen", 3, "", java.util.Map.of("../x.hxs", new byte[] {1})));
        assertThrows(IllegalArgumentException.class, () -> store.put("alice", "hexen", 3, "", java.util.Map.of("a/../b", new byte[] {1})));
        assertThrows(IllegalArgumentException.class, () -> store.put("alice", "hexen", 3, "", java.util.Map.of("a/b/c", new byte[] {1})));

        // Strife: a folder per slot with extension-less names.
        java.util.Map<String, byte[]> strife = new java.util.LinkedHashMap<>();
        strife.put("strfsav1.ssg/name", "ROOKIE".getBytes());
        strife.put("strfsav1.ssg/mis_obj", new byte[] {5});
        strife.put("strfsav1.ssg/02", new byte[] {6, 6});
        store.put("alice", "strife1", 1, "ROOKIE", strife);
        JsonArray sf = store.list("alice", "strife1").get(0).getAsJsonObject().getAsJsonArray("files");
        assertEquals(3, sf.size());
        assertEquals("strfsav1.ssg/02", sf.get(0).getAsJsonObject().get("name").getAsString());
        assertEquals("strfsav1.ssg/name", sf.get(2).getAsJsonObject().get("name").getAsString());
        assertThrows(IllegalArgumentException.class, () -> store.put("alice", "hexen", 3, "", java.util.Map.of()));
    }
}
