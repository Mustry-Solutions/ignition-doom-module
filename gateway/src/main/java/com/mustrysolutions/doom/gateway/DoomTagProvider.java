package com.mustrysolutions.doom.gateway;

import java.util.Date;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.inductiveautomation.ignition.common.gson.JsonElement;
import com.inductiveautomation.ignition.common.gson.JsonObject;
import com.inductiveautomation.ignition.common.model.values.QualityCode;
import com.inductiveautomation.ignition.common.sqltags.model.types.DataType;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;
import com.inductiveautomation.ignition.gateway.tags.managed.ManagedTagProvider;
import com.inductiveautomation.ignition.gateway.tags.managed.ManagedTagProviderConfiguration;

/**
 * The module's own tag provider, {@code [Doom]}: one folder per player under
 * {@code Players/}, fed by the component's telemetry channel. Tags are created
 * on first sight and left customisable (history, alarms) in the Designer.
 * Nothing here needs a project, a binding or a script.
 */
public final class DoomTagProvider {

    public static final String PROVIDER_NAME = "Doom";

    private static final LoggerEx log = LoggerEx.newBuilder().build("MustrySolutions.Doom.TagProvider");

    /** Telemetry keys the component sends (output.* names) and their tag data types. */
    private static final Map<String, DataType> STAT_TYPES = Map.ofEntries(
        Map.entry("inLevel", DataType.Boolean), Map.entry("health", DataType.Int4), Map.entry("armor", DataType.Int4),
        Map.entry("ammo", DataType.Int4), Map.entry("weapon", DataType.Int4), Map.entry("kills", DataType.Int4),
        Map.entry("items", DataType.Int4), Map.entry("secrets", DataType.Int4), Map.entry("totalKills", DataType.Int4),
        Map.entry("totalItems", DataType.Int4), Map.entry("totalSecrets", DataType.Int4), Map.entry("episode", DataType.Int4),
        Map.entry("map", DataType.Int4), Map.entry("levelSeconds", DataType.Int4), Map.entry("dead", DataType.Boolean),
        Map.entry("netgame", DataType.Boolean), Map.entry("inLobby", DataType.Boolean), Map.entry("netPlayers", DataType.Int4),
        Map.entry("playerClass", DataType.Int4));

    private final ManagedTagProvider provider;
    private final Set<String> knownPlayers = ConcurrentHashMap.newKeySet();

    public DoomTagProvider(GatewayContext context) {
        ManagedTagProviderConfiguration config = ManagedTagProviderConfiguration.builder(PROVIDER_NAME)
            .persistTags(true)
            .allowTagCustomization(true)
            .allowTagDeletion(true)
            .build();
        this.provider = context.getTagManager().getOrCreateManagedProvider(config);
        log.infof("[%s] tag provider ready", PROVIDER_NAME);
    }

    /** A folder-safe player key: letters, digits, dot, dash, underscore (case kept). */
    public static String playerKey(String raw, String fallback) {
        String s = raw == null ? "" : raw.trim().replaceAll("[^A-Za-z0-9._-]", "_");
        if (s.isBlank() || s.startsWith(".")) {
            return fallback;
        }
        return s.length() > 64 ? s.substring(0, 64) : s;
    }

    private static String tagName(String stat) {
        return Character.toUpperCase(stat.charAt(0)) + stat.substring(1);
    }

    private String path(String player, String tag) {
        return "Players/" + player + "/" + tag;
    }

    /** Create the player's tags once per gateway lifetime (idempotent on the provider anyway). */
    private void ensure(String player) {
        if (!knownPlayers.add(player)) {
            return;
        }
        STAT_TYPES.forEach((stat, type) -> provider.configureTag(path(player, tagName(stat)), type));
        provider.configureTag(path(player, "Online"), DataType.Boolean);
        provider.configureTag(path(player, "Session"), DataType.String);
        provider.configureTag(path(player, "Game"), DataType.String);
        provider.configureTag(path(player, "LastSeen"), DataType.DateTime);
        log.infof("[%s] created Players/%s", PROVIDER_NAME, player);
    }

    /** Apply a telemetry message: only the keys present are written. {@code game} is "doom", "heretic", ... */
    public void update(String player, String sessionId, boolean running, String game, JsonObject stats) {
        ensure(player);
        Date now = new Date();
        if (stats != null) {
            for (Map.Entry<String, JsonElement> e : stats.entrySet()) {
                DataType type = STAT_TYPES.get(e.getKey());
                if (type == null || !e.getValue().isJsonPrimitive()) {
                    continue;
                }
                Object value = type == DataType.Boolean ? e.getValue().getAsBoolean() : (Object) e.getValue().getAsInt();
                provider.updateValue(path(player, tagName(e.getKey())), value, QualityCode.Good, now);
            }
        }
        provider.updateValue(path(player, "Online"), running, QualityCode.Good, now);
        provider.updateValue(path(player, "Session"), sessionId, QualityCode.Good, now);
        if (game != null && !game.isBlank()) {
            provider.updateValue(path(player, "Game"), game, QualityCode.Good, now);
        }
        provider.updateValue(path(player, "LastSeen"), now, QualityCode.Good, now);
    }

    /** The session driving this player went away. */
    public void offline(String player) {
        if (player == null || !knownPlayers.contains(player)) {
            return;
        }
        Date now = new Date();
        provider.updateValue(path(player, "Online"), false, QualityCode.Good, now);
        provider.updateValue(path(player, "InLevel"), false, QualityCode.Good, now);
    }

    public void shutdown() {
        // Keep the provider's tag configuration (persistTags): only stop serving it.
        provider.shutdown(false);
    }
}
