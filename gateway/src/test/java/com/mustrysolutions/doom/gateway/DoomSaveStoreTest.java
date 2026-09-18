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
}
