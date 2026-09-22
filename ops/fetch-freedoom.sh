#!/usr/bin/env bash
# Fetch Freedoom (BSD-3-Clause) for the DEV GATEWAY ONLY.
#
# Freedoom is a free, complete IWAD pair that the engine recognises by name:
# freedoom1.wad (episodic, Doom-style) and freedoom2.wad (MAP01-style, which
# the engine treats as a registered game, so PWADs load). It is what the e2e
# suite uses to exercise the -file path, which no shareware IWAD can.
#
# ~24 MB, so it is not committed and not shipped: it lands in engine/build/
# (gitignored) and seed_verify_wads (ops/lib.sh) copies it into the gateway's
# wads folder, where the component fetches it like any operator WAD.
#
# Usage: ops/fetch-freedoom.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${HERE}/../engine/build/freedoom"
VERSION="0.13.0"
URL="https://github.com/freedoom/freedoom/releases/download/v${VERSION}/freedoom-${VERSION}.zip"
# From the release's signed freedoom-0.13.0-CHECKSUM.
ZIP_SHA256="3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59"

mkdir -p "${OUT}"
if [[ -f "${OUT}/freedoom2.wad" && -f "${OUT}/freedoom1.wad" ]]; then
  echo "Freedoom ${VERSION} already present in ${OUT}"
  exit 0
fi
zip="${OUT}/freedoom-${VERSION}.zip"
curl -fsSL -o "${zip}" "${URL}"
actual="$(shasum -a 256 "${zip}" | cut -d' ' -f1)"
if [[ "${actual}" != "${ZIP_SHA256}" ]]; then
  echo "freedoom-${VERSION}.zip checksum mismatch: ${actual}" >&2
  exit 1
fi
unzip -o -q -j "${zip}" "*/freedoom1.wad" "*/freedoom2.wad" -d "${OUT}"
rm -f "${zip}"
ls -la "${OUT}"
echo "Freedoom ${VERSION} -> ${OUT} (dev gateway only; never committed)"
