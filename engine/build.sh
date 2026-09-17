#!/usr/bin/env bash
# Rebuild the Doom engine (Chocolate Doom → WebAssembly) from source.
#
# The result (websockets-doom.js + websockets-doom.wasm) is COMMITTED under
# gateway/src/main/resources/mounted/doom/ so the normal Gradle build never
# needs Emscripten. Run this only when bumping the upstream commit or a patch.
#
# Upstream: https://github.com/cloudflare/doom-wasm (GPL-2.0), pinned below.
# Patches in engine/patches/ adapt it to a current Emscripten (renamed flags,
# C23 bool), build a MODULARIZE'd factory named createDoomModule instead of a
# global Module, drop the debug source map, and skip the textscreen examples.
#
# Usage:
#   engine/build.sh            # Docker (emscripten/emsdk image), no local toolchain needed
#   engine/build.sh --local    # use emcc/emmake/emconfigure + automake/autoconf/pkg-config on PATH
set -euo pipefail

UPSTREAM_REPO="https://github.com/cloudflare/doom-wasm.git"
UPSTREAM_COMMIT="65e0d3ae2ffa604155eebd96ed40da6567bd08f4"
EMSDK_IMAGE="emscripten/emsdk:6.0.9"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
OUT="${ROOT}/gateway/src/main/resources/mounted/doom"
WORK="${HERE}/build/doom-wasm"

mkdir -p "${HERE}/build"
if [[ ! -d "${WORK}/.git" ]]; then
  git clone "${UPSTREAM_REPO}" "${WORK}"
fi
git -C "${WORK}" fetch --quiet origin
git -C "${WORK}" checkout --quiet --force "${UPSTREAM_COMMIT}"
git -C "${WORK}" clean -fdxq
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

cp "${WORK}/src/websockets-doom.js" "${WORK}/src/websockets-doom.wasm" "${OUT}/"
ls -la "${OUT}"
echo "Engine rebuilt from ${UPSTREAM_COMMIT}."
