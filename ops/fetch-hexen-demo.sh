#!/usr/bin/env bash
# Fetch the Hexen 4-level demo (idgames archive, 1995) for the DEV GATEWAY ONLY.
# The demo's archive carries no redistribution grant, so hexen.wad is never
# committed or shipped: it lands in engine/build/ (gitignored) and
# seed_verify_wads (ops/lib.sh) copies it into the gateway's wads folder, which
# is how Hexen is played in this module anyway (bring your own WAD, #2).
#
# Usage: ops/fetch-hexen-demo.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${HERE}/../engine/build/hexen-demo"
URL="https://youfailit.net/pub/idgames/idstuff/hexen/hexndemo.zip"
SHA1="fa89a2475855e43c7f7e3198d6e4c4bee23bfab9"   # HEXEN.WAD inside the archive
mkdir -p "${OUT}"
if [[ -f "${OUT}/hexen.wad" ]] && shasum "${OUT}/hexen.wad" | grep -q "${SHA1}"; then
  echo "hexen.wad already present in ${OUT}"
  exit 0
fi
curl -fsSL -o "${OUT}/hexndemo.zip" "${URL}"
unzip -o -q -j "${OUT}/hexndemo.zip" HEXEN.WAD -d "${OUT}"
mv "${OUT}/HEXEN.WAD" "${OUT}/hexen.wad"
shasum "${OUT}/hexen.wad" | grep -q "${SHA1}" || { echo "hexen.wad checksum mismatch" >&2; exit 1; }
echo "hexen.wad (4-level demo) -> ${OUT}/hexen.wad"
