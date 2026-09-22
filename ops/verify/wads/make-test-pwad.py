#!/usr/bin/env python3
"""Write the tiny PWAD the e2e suite loads with -file.

Ours, not id's: a PWAD header and one marker lump, ~100 bytes. Loading it
proves the whole operator-PWAD path (gateway folder -> ticketed download ->
engine filesystem -> -file on the command line -> W_AddFile), which needs a
registered IWAD, so the suite pairs it with Freedoom (ops/fetch-freedoom.sh).

    python3 ops/verify/wads/make-test-pwad.py
"""
import struct
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "mustry-test.wad"
LUMPS = [(b"MUSTRY01", b"Mustry Doom e2e PWAD marker\n")]


def build() -> bytes:
    header_size = 12
    body = b"".join(data for _, data in LUMPS)
    directory = b""
    offset = header_size
    for name, data in LUMPS:
        directory += struct.pack("<ii", offset, len(data)) + name.ljust(8, b"\0")
        offset += len(data)
    return b"PWAD" + struct.pack("<ii", len(LUMPS), header_size + len(body)) + body + directory


if __name__ == "__main__":
    wad = build()
    OUT.write_bytes(wad)
    print(f"{OUT} ({len(wad)} bytes)", file=sys.stderr)
