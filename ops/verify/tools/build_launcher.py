#!/usr/bin/env python3
"""Generate the verify project's overview views: the launcher at / and one hub
per shipping game (/doom, /heretic). The GAMES table below is the single
place to add a game or a section; run this script and commit the JSON.

    python3 ops/verify/tools/build_launcher.py

Perspective view JSON is authored by hand in this repo; these three views
share so much structure that a generator beats copy-paste.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWS = os.path.join(HERE, "..", "project", "com.inductiveautomation.perspective", "views")

FONT = "Inter, 'Segoe UI', system-ui, sans-serif"
MONO = "ui-monospace, Menlo, Consolas, monospace"
BG = "#0b0d10"
CARD = "#12161c"
CARD_EDGE = "#1c2230"
TEXT = "#e6e9ef"
MUTED = "#8b95a5"

GAMES = [
    {
        "id": "doom",
        "name": "DOOM",
        "color": "#e24b4a",
        "ships": True,
        "tagline": "The 1993 shareware episode: Knee-Deep in the Dead.",
        "engine": "Chocolate Doom → WebAssembly (doom-wasm)",
        "iwad": "doom1.wad · saves in saves/<user>/",
        "sections": [
            {"title": "Control room", "route": "/doom/control-room",
             "blurb": "The full SCADA joke: tags fire the shotgun, the line alarm pauses the marine, health lands in the historian."},
            {"title": "Deathmatch · host", "route": "/arena/host/Player1/default/doom",
             "blurb": "Open the arena as the server. The game launches when the second marine arrives."},
            {"title": "Deathmatch · join", "route": "/arena/join/Player2/default/doom",
             "blurb": "Join the same arena from another browser (or another Perspective session)."},
            {"title": "WAD lab", "route": "/wad/doom1",
             "blurb": "Bring your own IWAD or PWAD from the gateway's wads folder; see what the engine says."},
            {"title": "Just Doom", "route": "/game/doom",
             "blurb": "The component with default settings and a readout of its outputs. Nothing else."},
        ],
    },
    {
        "id": "heretic",
        "name": "HERETIC",
        "color": "#d9a441",
        "ships": True,
        "tagline": "Raven's 1994 shareware episode: City of the Damned.",
        "engine": "Chocolate Heretic → WebAssembly (same upstream)",
        "iwad": "heretic1.wad · saves in saves/<user>/game-heretic1/",
        "sections": [
            {"title": "Play", "route": "/game/heretic",
             "blurb": "Corvus, an elven wand and the same component. Outputs on the side."},
            {"title": "Deathmatch · host", "route": "/arena/host/Corvus1/htic/heretic",
             "blurb": "Heretic through the same gateway relay. Host first."},
            {"title": "Deathmatch · join", "route": "/arena/join/Corvus2/htic/heretic",
             "blurb": "Join from a second browser."},
            {"title": "WAD lab", "route": "/game/heretic",
             "blurb": "Drop heretic.wad in the gateway's wads folder and set config.iwad; Heretic takes PWADs on shareware data."},
        ],
    },
    {
        "id": "hexen",
        "name": "HEXEN",
        "color": "#7f9cff",
        "ships": False,
        "tagline": "Beyond Heretic. Three classes, hub maps, mana.",
        "issue": "https://github.com/Mustry-Solutions/ignition-doom-module/issues/6",
    },
    {
        "id": "strife",
        "name": "STRIFE",
        "color": "#8fbf6a",
        "ships": False,
        "tagline": "Quest for the Sigil. Rogue's 1996 talk-and-shoot.",
        "issue": "https://github.com/Mustry-Solutions/ignition-doom-module/issues/7",
    },
]


def label(name, text, style, extra=None, position=None):
    c = {
        "type": "ia.display.label",
        "version": 0,
        "props": {"text": text, "style": {"fontFamily": FONT, **style}},
        "meta": {"name": name},
        "position": position or {"basis": "auto", "grow": 0, "shrink": 0},
    }
    if extra:
        c.update(extra)
    return c


def nav(page=None, url=None):
    script = (f"\tsystem.perspective.navigate(page={page!r})" if page
              else f"\tsystem.perspective.navigate(url={url!r}, newTab=True)")
    return {"dom": {"onClick": {"type": "script", "scope": "G", "config": {"script": script}}}}


def flex(name, direction, children, style=None, position=None, wrap="nowrap", justify="flex-start", align="stretch", extra=None):
    c = {
        "type": "ia.container.flex",
        "version": 0,
        "props": {
            "direction": direction, "wrap": wrap, "justify": justify,
            "alignItems": align, "alignContent": "flex-start",
            "style": style or {},
        },
        "meta": {"name": name},
        "position": position or {"basis": "auto", "grow": 0, "shrink": 0},
        "custom": {},
        "children": children,
    }
    if extra:
        c.update(extra)
    return c


def pill(name, text, fg, bg):
    return label(name, text, {
        "fontSize": "10px", "fontWeight": "700", "letterSpacing": "0.1em", "textAlign": "center",
        "borderRadius": "12px", "color": fg, "backgroundColor": bg, "padding": "4px 10px",
    })


def button(name, text, page, color, url=None):
    return label(name, text, {
        "fontSize": "13px", "fontWeight": "600", "color": TEXT, "backgroundColor": "#1a2029",
        "borderRadius": "10px", "padding": "10px 14px", "cursor": "pointer",
        "borderLeft": f"3px solid {color}",
    }, extra={"events": nav(page=page, url=url)})


def header(title, title_color, subtitle, back=None):
    kids = []
    if back:
        kids.append(label("back", "← All games", {
            "fontSize": "12px", "color": MUTED, "cursor": "pointer", "marginBottom": "6px",
        }, extra={"events": nav(page="/")}))
    kids.append(label("title", title, {
        "fontSize": "40px", "fontWeight": "800", "letterSpacing": "0.12em", "color": title_color,
    }))
    kids.append(label("subtitle", subtitle, {"fontSize": "14px", "color": MUTED, "marginTop": "2px"}))
    return flex("header", "column", kids, style={"padding": "36px 40px 20px 40px"})


def footer():
    return label("footer", "Mustry Doom · a free Perspective module · GPL-2.0 · "
                 "DOOM is a trademark of id Software LLC; Heretic of Raven Software / id Software.",
                 {"fontSize": "11px", "color": "#5b6573", "padding": "24px 40px 32px 40px"})


def game_card(g):
    color = g["color"]
    kids = [
        flex(f"{g['id']}Head", "row", [
            label("name", g["name"], {"fontSize": "26px", "fontWeight": "800", "letterSpacing": "0.1em", "color": color},
                  position={"basis": "auto", "grow": 1, "shrink": 1}),
            pill("status", "SHIPS" if g["ships"] else "PLANNED",
                 "#04342c" if g["ships"] else "#2b2f3a", "#2ecc71" if g["ships"] else "#8b95a5"),
        ], align="center", justify="space-between"),
        label("tagline", g["tagline"], {"fontSize": "13px", "color": MUTED, "marginTop": "6px", "marginBottom": "14px",
                                         "whiteSpace": "pre-wrap"}),
    ]
    if g["ships"]:
        kids.append(flex("sections", "column", [
            button(f"s{i}", s["title"], s["route"], color) for i, s in enumerate(g["sections"])
        ], style={"gap": "8px"}))
        kids.append(label("more", "Overview →", {
            "fontSize": "12px", "fontWeight": "600", "color": color, "marginTop": "14px", "cursor": "pointer",
        }, extra={"events": nav(page=f"/{g['id']}")}))
        kids.append(label("engine", g["engine"], {"fontSize": "11px", "color": "#5b6573", "marginTop": "16px",
                                                    "fontFamily": MONO, "whiteSpace": "pre-wrap"}))
    else:
        kids.append(label("soon", "Not in the module yet. The engine comes from the same Chocolate Doom "
                                  "family; the open questions are the demo WAD's licence and per-slot save folders.",
                          {"fontSize": "12px", "color": MUTED, "whiteSpace": "pre-wrap", "lineHeight": "1.4"}))
        kids.append(button("issue", "Follow the issue on GitHub ↗", None, color, url=g["issue"]))
    card_style = {
        "backgroundColor": CARD, "borderRadius": "16px", "padding": "22px 22px 20px 22px",
        "border": f"1px solid {CARD_EDGE}", "borderTop": f"4px solid {color}",
        "opacity": 1 if g["ships"] else 0.72, "maxWidth": "420px",
    }
    return flex(f"{g['id']}Card", "column", kids, style=card_style,
                position={"basis": "300px", "grow": 1, "shrink": 1})


def launcher():
    root = flex("root", "column", [
        header("MUSTRY DOOM", "#e24b4a", "Can it run Doom? Your Ignition gateway can. Pick a game; every one of them is "
                                        "a Perspective component with tags, alarms, saves and a deathmatch relay behind it."),
        flex("games", "row", [game_card(g) for g in GAMES], wrap="wrap", align="stretch",
             style={"gap": "20px", "padding": "0 40px"}),
        footer(),
    ], style={"backgroundColor": BG, "minHeight": "100%"}, position={})
    root["position"] = {}
    return {
        "custom": {}, "params": {},
        "props": {"defaultSize": {"width": 1280, "height": 760}},
        "root": root,
    }


def section_card(g, s, i):
    color = g["color"]
    return flex(f"section{i}", "column", [
        label("title", s["title"], {"fontSize": "18px", "fontWeight": "700", "color": TEXT}),
        label("blurb", s["blurb"], {"fontSize": "13px", "color": MUTED, "marginTop": "6px", "whiteSpace": "pre-wrap",
                                    "lineHeight": "1.45"}, position={"basis": "auto", "grow": 1, "shrink": 1}),
        label("route", s["route"], {"fontSize": "11px", "color": color, "fontFamily": MONO, "marginTop": "14px"}),
    ], style={
        "backgroundColor": CARD, "borderRadius": "14px", "padding": "18px 20px",
        "border": f"1px solid {CARD_EDGE}", "cursor": "pointer", "maxWidth": "380px",
    }, position={"basis": "280px", "grow": 1, "shrink": 1},
        extra={"events": nav(page=s["route"])})


def hub(g):
    def fact(name, key, value):
        return flex(name, "row", [
            label("k", key, {"fontSize": "12px", "color": MUTED, "fontFamily": MONO},
                  position={"basis": "110px", "grow": 0, "shrink": 0}),
            label("v", value, {"fontSize": "12px", "color": TEXT, "fontFamily": MONO},
                  position={"basis": "auto", "grow": 1, "shrink": 1}),
        ], style={"marginTop": "4px"})

    facts = flex("facts", "column", [
        label("factsTitle", "UNDER THE HOOD", {"fontSize": "11px", "fontWeight": "700", "letterSpacing": "0.1em",
                                                 "color": MUTED, "marginBottom": "8px"}),
        fact("engine", "Engine", g["engine"]),
        fact("iwad", "IWAD", g["iwad"]),
        fact("tags", "Tags", f"[Doom]Players/<player>/*  ·  Game = {g['id']}"),
        fact("wads", "Your WADs", "data/modules/com.mustrysolutions.doom/wads/ on the gateway"),
    ], style={"backgroundColor": "#0f1318", "borderRadius": "14px", "padding": "18px 20px", "margin": "8px 40px 0 40px",
              "border": f"1px solid {CARD_EDGE}"})
    root = flex("root", "column", [
        header(g["name"], g["color"], g["tagline"], back=True),
        flex("sections", "row", [section_card(g, s, i) for i, s in enumerate(g["sections"])], wrap="wrap",
             style={"gap": "16px", "padding": "0 40px"}),
        facts,
        footer(),
    ], style={"backgroundColor": BG, "minHeight": "100%"})
    root["position"] = {}
    return {
        "custom": {}, "params": {},
        "props": {"defaultSize": {"width": 1280, "height": 720}},
        "root": root,
    }


def write(name, view):
    d = os.path.join(VIEWS, name)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "view.json"), "w") as f:
        json.dump(view, f, indent=2)
        f.write("\n")
    with open(os.path.join(d, "resource.json"), "w") as f:
        json.dump({"scope": "G", "version": 1, "restricted": False, "overridable": True,
                   "files": ["view.json"], "attributes": {}}, f, indent=2)
        f.write("\n")
    print("wrote", name)


if __name__ == "__main__":
    write("Launcher", launcher())
    for g in GAMES:
        if g["ships"]:
            write(f"{g['name'].title()}Hub", hub(g))
