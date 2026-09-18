package com.mustrysolutions.doom.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DoomWadStoreTest {

    @TempDir
    Path data;

    private DoomWadStore store() throws IOException {
        DoomWadStore s = new DoomWadStore(data);
        s.ensure();
        return s;
    }

    @Test
    void keysAreCaseInsensitiveAndExtensionOptional() {
        assertEquals("doom2", DoomWadStore.key("DOOM2.WAD"));
        assertEquals("doom2", DoomWadStore.key("doom2"));
        assertEquals("doom2", DoomWadStore.key(" Doom2.wad "));
        assertEquals("my.mod", DoomWadStore.key("my.mod.wad"));
        assertNull(DoomWadStore.key(null));
        assertNull(DoomWadStore.key(""));
        assertNull(DoomWadStore.key(".wad"), "nothing left once the extension is gone");
        assertNull(DoomWadStore.key("../doom2.wad"));
        assertNull(DoomWadStore.key("sub/doom2.wad"));
        assertNull(DoomWadStore.key("a".repeat(65)));
    }

    @Test
    void listsAndResolvesOnlyWadFilesInsideTheFolder() throws IOException {
        DoomWadStore s = store();
        Files.write(s.root().resolve("DOOM2.WAD"), new byte[] {'P'});
        Files.write(s.root().resolve("tnt.wad"), new byte[] {'P'});
        Files.write(s.root().resolve("README.txt"), new byte[] {'x'});
        Files.createDirectory(s.root().resolve("dir.wad"));
        Files.write(data.resolve("secret.wad"), new byte[] {'x'});

        assertEquals(List.of("doom2", "tnt"), s.list());
        assertNotNull(s.resolve("doom2"));
        assertNotNull(s.resolve("Doom2.WAD"));
        assertTrue(s.resolve("doom2").getFileName().toString().equals("DOOM2.WAD"), "the file's own spelling");
        assertNull(s.resolve("plutonia"));
        assertNull(s.resolve("README.txt"));
        assertNull(s.resolve("../secret.wad"), "never outside the folder");
        assertNull(s.resolve("dir"), "a directory is not a WAD");
    }

    @Test
    void aMissingFolderIsEmptyNotAnError() throws IOException {
        DoomWadStore s = new DoomWadStore(data);
        assertEquals(List.of(), s.list());
        assertNull(s.resolve("doom2"));
    }
}
