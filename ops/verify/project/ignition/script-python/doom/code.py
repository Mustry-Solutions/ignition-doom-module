# Creates the tag model behind the Doom demo. Idempotent (collision policy
# "m" merges). Called from the DoomDemo view root's onStartup as doom.setupTags(). Historized by the "Doom Historian" TimescaleDB profile seeded by
# ops/fresh.sh; without that module the tags still work, history just fails.
#
# Model (multiplayer-ready: one Marine UDT instance per player):
#   [default]_types_/Doom/Marine         UDT, parameter Player
#   [default]Doom/Players/<Player>       instances (Player1 today)
#   [default]Doom/Line/Running           pretend production line + alarm

HISTORIAN = "Doom Historian"


def member(name, data_type, doc, alarms=None):
    t = {
        "name": name,
        "tagType": "AtomicTag",
        "valueSource": "memory",
        "dataType": data_type,
        "value": 0 if data_type != "String" else "",
        "documentation": doc,
        "historyEnabled": True,
        "historyProvider": HISTORIAN,
        "historicalDeadbandStyle": "Discrete",
        "sampleMode": "OnChange",
        "historyMaxAgeUnits": "SEC",
        "historyMaxAge": 60,
    }
    if alarms:
        t["alarms"] = alarms
    return t


marine_udt = {
    "name": "Marine",
    "tagType": "UdtType",
    "parameters": {"Player": {"dataType": "String", "value": "Player1"}},
    "tags": [
        member("Health", "Int4", "Marine health, 0-200 (output.health)."),
        member("Armor", "Int4", "Armor points, 0-200 (output.armor)."),
        member("Ammo", "Int4", "Ammo for the ready weapon, -1 = melee (output.ammo)."),
        member("Weapon", "Int4", "Ready weapon slot 0-7 (output.weapon)."),
        member("Kills", "Int4", "Monsters killed on this map (output.kills)."),
        member("TotalKills", "Int4", "Monsters on this map (output.totalKills)."),
        member("Items", "Int4", "Items picked up (output.items)."),
        member("Secrets", "Int4", "Secrets found (output.secrets)."),
        member("Episode", "Int4", "Episode (output.episode)."),
        member("Map", "Int4", "Map (output.map)."),
        member("LevelSeconds", "Int4", "Seconds on this map (output.levelSeconds)."),
        member("InLevel", "Boolean", "True while a map is being played (output.inLevel)."),
        member(
            "Dead", "Boolean", "True while the marine is dead (output.dead).",
            alarms=[{
                "name": "Marine down",
                "mode": "Equality",
                "setpointA": 1,
                "priority": "Critical",
                "label": "Marine {Player} is down",
                "notes": "The player died. Acknowledge to confirm you laughed.",
            }],
        ),
        {
            "name": "Session",
            "tagType": "AtomicTag",
            "valueSource": "memory",
            "dataType": "String",
            "value": "",
            "documentation": "Perspective session id currently driving this marine (multiplayer bookkeeping).",
        },
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

players = {
    "name": "Players",
    "tagType": "Folder",
    "tags": [{
        "name": "Player1",
        "tagType": "UdtInstance",
        "typeId": "Doom/Marine",
        "parameters": {"Player": "Player1"},
    }],
}


def setupTags():
    """Create/merge the Doom tag model (UDT, Player1 instance, line tag). Idempotent."""
    log = system.util.getLogger("MustryDoom.verify")
    r1 = system.tag.configure("[default]_types_", [{"name": "Doom", "tagType": "Folder", "tags": [marine_udt]}], "m")
    r2 = system.tag.configure("[default]", [{"name": "Doom", "tagType": "Folder", "tags": [line, players]}], "m")
    log.info("Doom tag model configured: types=%s tags=%s" % (",".join(str(r) for r in r1), ",".join(str(r) for r in r2)))
