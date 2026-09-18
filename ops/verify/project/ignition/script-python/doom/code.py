# Creates the tag model behind the Doom demo. Idempotent (collision policy
# "m" merges). Called from the DoomDemo view root's onStartup as doom.setupTags(). Historized by the "Doom Historian" TimescaleDB profile seeded by
# ops/fresh.sh; without that module the tags still work, history just fails.
#
# Model (multiplayer-ready: one folder per player, created on demand):
#   [Doom]Players/<player>/*             module-owned provider, written by the component's
#                                        telemetry channel (Health, Armor, ..., Online, LastSeen)
#   [default]Doom/Players/<player>/*     plant-side mirror: expression tags onto [Doom] with
#                                        history to the TimescaleDB profile + the "Marine down" alarm,
#                                        built by setupPlayer(name) from the view's player param
#   [default]Doom/Line/Running           pretend production line + alarm
#
# Not a UDT: parameter substitution ({Player}, even {InstanceName}) never
# resolved in types created through system.tag.configure on 8.3.6, so the
# per-player folder is generated with literal paths instead.

# Preferred history provider; on a gateway without it (an imported demo
# project), fall back to whatever historian exists, else no history at all.
PREFERRED_HISTORIAN = "Doom Historian"

# Module ids the full demo wants, as module.xml declares them.
DOOM_MODULE = "com.mustrysolutions.doom"
EMBR_CHARTS_MODULE = "com.mussonindustrial.embr.charts"


def historian():
    """The tag history provider to use, or None when the gateway has none.

    8.3 has no script call that lists historians by name; browsing the
    historical tag tree from its root returns one node per provider, as
    "histprov:<name>". (system.tag.getHistorianProviders does not exist.)"""
    names = []
    try:
        for node in system.tag.browseHistoricalTags("").getResults():
            path = str(node.getPath())
            if path.startswith("histprov:"):
                names.append(path[len("histprov:"):].split(":")[0])
    except Exception as e:
        system.util.getLogger("MustryDoom.verify").warn("Could not list historian providers: %s" % e)
    if PREFERRED_HISTORIAN in names:
        return PREFERRED_HISTORIAN
    return names[0] if names else None


def running_modules():
    """Ids of the modules this gateway is running (system.util.getModules reports State "ACTIVE")."""
    ids = set()
    try:
        for row in system.dataset.toPyDataSet(system.util.getModules()):
            if str(row["State"]).lower() in ("active", "running"):
                ids.add(str(row["Id"]))
    except Exception as e:
        system.util.getLogger("MustryDoom.verify").warn("Could not list modules: %s" % e)
    return ids


def requirements():
    """What the full demo needs versus what this gateway has. Drives the
    header pills and the chart placeholder in the DoomDemo view:
    {"doom": bool, "embr": bool, "history": bool, "historian": name or None}."""
    running = running_modules()
    provider = historian()
    return {
        "doom": DOOM_MODULE in running,
        "embr": EMBR_CHARTS_MODULE in running,
        "history": provider is not None,
        "historian": provider,
    }


def member(player, name, data_type, doc, alarms=None):
    # Mirrors the module's own [Doom] provider, which the component feeds
    # directly (no bindings). Event-driven expression rather than reference
    # tag: a reference onto the managed provider stayed at
    # Uncertain_InitialValue on 8.3.6. This layer adds history, alarms and
    # documentation, i.e. what a plant wants on top of raw telemetry.
    t = {
        "name": name,
        "tagType": "AtomicTag",
        "valueSource": "expr",
        "expression": "{[Doom]Players/" + player + "/" + name + "}",
        "executionMode": "EventDriven",
        "dataType": data_type,
        "documentation": doc,
    }
    provider = historian()
    if provider:
        t.update({
            "historyEnabled": True,
            "historyProvider": provider,
            "historicalDeadbandStyle": "Discrete",
            "sampleMode": "OnChange",
            "historyMaxAgeUnits": "SEC",
            "historyMaxAge": 60,
        })
    if alarms:
        t["alarms"] = alarms
    return t


def marine_folder(player):
    """The [default]Doom/Players/<player> folder: one expression tag per telemetry member."""
    return {
        "name": player,
        "tagType": "Folder",
        "tags": [
            member(player, "Health", "Int4", "Marine health, 0-200 (output.health)."),
            member(player, "Armor", "Int4", "Armor points, 0-200 (output.armor)."),
            member(player, "Ammo", "Int4", "Ammo for the ready weapon, -1 = melee (output.ammo)."),
            member(player, "Weapon", "Int4", "Ready weapon slot 0-7 (output.weapon)."),
            member(player, "Kills", "Int4", "Monsters killed on this map (output.kills)."),
            member(player, "TotalKills", "Int4", "Monsters on this map (output.totalKills)."),
            member(player, "Items", "Int4", "Items picked up (output.items)."),
            member(player, "Secrets", "Int4", "Secrets found (output.secrets)."),
            member(player, "Episode", "Int4", "Episode (output.episode)."),
            member(player, "Map", "Int4", "Map (output.map)."),
            member(player, "LevelSeconds", "Int4", "Seconds on this map (output.levelSeconds)."),
            member(player, "InLevel", "Boolean", "True while a map is being played (output.inLevel)."),
            member(
                player, "Dead", "Boolean", "True while the marine is dead (output.dead).",
                alarms=[{
                    "name": "Marine down",
                    "mode": "Equality",
                    "setpointA": 1,
                    "priority": "Critical",
                    "label": "Marine %s is down" % player,
                    "notes": "The player died. Acknowledge to confirm you laughed.",
                }],
            ),
            member(player, "Online", "Boolean", "A session is driving this marine (from [Doom])."),
        ],
    }


line = {
    "name": "Line",
    "tagType": "Folder",
    "tags": [{
        "name": "Running",
        "tagType": "AtomicTag",
        "valueSource": "memory",
        "dataType": "Boolean",
        "value": True,
        "documentation": "Pretend production line. False raises the 'Line stopped' alarm; the demo view pauses Doom while that alarm is active and unacknowledged.",
        "alarms": [{
            "name": "Line stopped",
            "mode": "Equality",
            "setpointA": 0,
            "priority": "High",
            "label": "Line 3 filler stopped",
            "notes": "Acknowledge to let the marine carry on.",
        }],
    }],
}


def setupTags():
    """Create/merge the plant-side model: the line tag and the Players folder. Idempotent."""
    log = system.util.getLogger("MustryDoom.verify")
    # Leftovers from earlier model versions (a Marine UDT, probe tags) would
    # block the per-player folders below; removing missing paths is harmless.
    system.tag.deleteTags(["[default]_types_/Doom", "[default]Doom/Probe"])
    r = system.tag.configure("[default]", [{"name": "Doom", "tagType": "Folder", "tags": [line, {"name": "Players", "tagType": "Folder", "tags": []}]}], "m")
    log.info("Doom tag model configured: %s" % ",".join(str(x) for x in r))


def setupPlayer(player):
    """Create/refresh [default]Doom/Players/<player>: expression tags mirroring [Doom]Players/<player>."""
    player = (player or "").strip()
    if not player:
        return
    log = system.util.getLogger("MustryDoom.verify")
    # Recreated, not merged: the folder holds no operator data, a changed
    # member definition must win, and an old UDT instance of the same name
    # cannot be overwritten in place ("Cannot move/rename inherited tag").
    system.tag.deleteTags(["[default]Doom/Players/" + player])
    r = system.tag.configure("[default]Doom/Players", [marine_folder(player)], "o")
    log.info("Doom player folder configured for %s (historian: %s): %s" % (player, historian() or "none", ",".join(str(x) for x in r)))
