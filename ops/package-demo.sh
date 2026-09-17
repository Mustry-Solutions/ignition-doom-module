#!/usr/bin/env bash
# Package the demo Perspective project (ops/verify/project) as an Ignition
# project export: a zip of the project folder with its hierarchy intact, which
# the Designer imports via File -> Import. The project is renamed from the
# test-harness name "verify" to "DoomDemo" on the way out.
#
# Usage: ops/package-demo.sh [output.zip]   (default build/Mustry-Doom-Demo-Project.zip)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
OUT="${1:-${ROOT}/build/Mustry-Doom-Demo-Project.zip}"
SRC="${ROOT}/ops/verify/project"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
mkdir -p "${tmp}/DoomDemo"
# Copy resources, dropping Designer write-back noise.
( cd "${SRC}" && find . -type f ! -name 'thumbnail.png' ! -path './com.inductiveautomation.perspective/session-props/*' -print0 \
    | tar --null -cf - --files-from - ) | ( cd "${tmp}/DoomDemo" && tar -xf - )
python3 - "${tmp}/DoomDemo/project.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["title"] = "DoomDemo"
d["description"] = ("Mustry Doom demo: the control-room view (route /) and the deathmatch arena "
                    "(/arena/host/<player>, /arena/join/<player>). Requires the Mustry Doom module; "
                    "the trend also wants Embr Charts and a tag history provider. Tags are created on first open.")
json.dump(d, open(p, "w"), indent=2)
PY
mkdir -p "$(dirname "${OUT}")"
rm -f "${OUT}"
( cd "${tmp}/DoomDemo" && zip -qr "${OUT}" . -x '.DS_Store' )
echo "Packaged $(basename "${OUT}") ($(du -h "${OUT}" | cut -f1)) from ${SRC}"
unzip -Z1 "${OUT}" | sed "s/^/  /"
