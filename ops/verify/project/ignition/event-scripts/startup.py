# Gateway startup script of the verify project: creates the Doom telemetry
# tags (historized by the "Doom Historian" TimescaleDB profile that
# ops/fresh.sh seeds) and a fake production-line tag with an alarm, so the
# view can show "line stops, Doom pauses". Idempotent: collision policy "m"
# merges into existing tags.

HISTORIAN = "Doom Historian"


def historized(name, data_type, deadband_style="Discrete"):
    return {
        "name": name,
        "tagType": "AtomicTag",
        "valueSource": "memory",
        "dataType": data_type,
        "value": 0,
        "historyEnabled": True,
        "historyProvider": HISTORIAN,
        "historicalDeadbandStyle": deadband_style,
        "sampleMode": "OnChange",
        "historyMaxAgeUnits": "SEC",
        "historyMaxAge": 60,
    }


tags = [
    {
        "name": "Doom",
        "tagType": "Folder",
        "tags": [
            historized("Health", "Int4"),
            historized("Armor", "Int4"),
            historized("Ammo", "Int4"),
            historized("Kills", "Int4"),
            historized("Map", "Int4"),
            historized("Dead", "Boolean"),
            historized("InLevel", "Boolean"),
            {
                "name": "Line",
                "tagType": "Folder",
                "tags": [
                    {
                        "name": "Running",
                        "tagType": "AtomicTag",
                        "valueSource": "memory",
                        "dataType": "Boolean",
                        "value": True,
                        "documentation": "Pretend production line. False raises the 'Line stopped' alarm; the Doom view pauses the game while it is active.",
                        "alarms": [
                            {
                                "name": "Line stopped",
                                "mode": "Equality",
                                "setpointA": 0,
                                "priority": "High",
                                "label": "Line stopped - the marine can wait",
                            }
                        ],
                    }
                ],
            },
        ],
    }
]

results = system.tag.configure("[default]", tags, "m")
system.util.getLogger("MustryDoom.verify").info("Doom tags configured: %s" % ",".join(str(r) for r in results))
