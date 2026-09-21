#!/usr/bin/env bash
# Rebuild the Doom engine (Chocolate Doom → WebAssembly) from source.
#
# The results (websockets-{doom,heretic,hexen}.{js,wasm}) are
# COMMITTED under gateway/src/main/resources/mounted/<game>/ so the normal
# Gradle build never needs Emscripten. Run this only when bumping the upstream
# commit or a patch.
#
# Upstream: https://github.com/cloudflare/doom-wasm (GPL-2.0), pinned below.
# doom-wasm dropped Chocolate Doom's other games, so src/heretic/ and src/hexen/ are taken from
# the Chocolate Doom commit doom-wasm forked from (CHOCOLATE_BASE, June 2022:
# every shared file doom-wasm left untouched matches that tree byte for byte).
# Patches in engine/patches/: 0001 adapts to a current Emscripten (renamed
# flags, C23 bool), builds a MODULARIZE'd factory named createDoomModule
# instead of a global Module, drops the debug source map, skips the textscreen
# examples and adds the Doom telemetry/save hooks; 0002 wires Heretic into the
# build and ports the same three game-side changes to it; 0003 does the same for Hexen.
#
# Usage:
#   engine/build.sh            # Docker (emscripten/emsdk image), no local toolchain needed
#   engine/build.sh --local    # use emcc/emmake/emconfigure + automake/autoconf/pkg-config on PATH
set -euo pipefail

UPSTREAM_REPO="https://github.com/cloudflare/doom-wasm.git"
UPSTREAM_COMMIT="65e0d3ae2ffa604155eebd96ed40da6567bd08f4"
CHOCOLATE_REPO="https://github.com/chocolate-doom/chocolate-doom.git"
CHOCOLATE_BASE="749f49424daf9ff8d6af8f9698f0b81e68955f4f"
EMSDK_IMAGE="emscripten/emsdk:6.0.9"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
MOUNTED="${ROOT}/gateway/src/main/resources/mounted"
WORK="${HERE}/build/doom-wasm"

mkdir -p "${HERE}/build"
if [[ ! -d "${WORK}/.git" ]]; then
  git clone "${UPSTREAM_REPO}" "${WORK}"
fi
git -C "${WORK}" fetch --quiet origin
git -C "${WORK}" checkout --quiet --force "${UPSTREAM_COMMIT}"
git -C "${WORK}" clean -fdxq
# Heretic's game directory from the Chocolate Doom tree doom-wasm was cut from.
if ! git -C "${WORK}" remote get-url chocolate >/dev/null 2>&1; then
  git -C "${WORK}" remote add chocolate "${CHOCOLATE_REPO}"
fi
git -C "${WORK}" fetch --quiet chocolate "${CHOCOLATE_BASE}"
git -C "${WORK}" checkout --quiet "${CHOCOLATE_BASE}" -- src/heretic src/hexen
git -C "${WORK}" reset --quiet
for p in "${HERE}"/patches/*.patch; do
  echo "applying $(basename "$p")"
  git -C "${WORK}" apply "$p"
done

if [[ "${1:-}" == "--local" ]]; then
  ( cd "${WORK}" && ./scripts/build.sh )
else
  docker run --rm -v "${WORK}:/src" -w /src "${EMSDK_IMAGE}" bash -c \
    'apt-get update -qq >/dev/null && apt-get install -y -qq automake autoconf pkg-config >/dev/null && ./scripts/build.sh'
fi

for game in doom heretic hexen; do
  cp "${WORK}/src/websockets-${game}.js" "${WORK}/src/websockets-${game}.wasm" "${MOUNTED}/${game}/"
  ls -la "${MOUNTED}/${game}/"
done
echo "Engines rebuilt from doom-wasm ${UPSTREAM_COMMIT} + chocolate-doom ${CHOCOLATE_BASE} (heretic, hexen)."
