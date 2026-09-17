#!/usr/bin/env bash
# Stage Musson Industrial's Embr Charts module (MIT, free) next to the Doom
# module so the demo view can use its Chart.js component. Downloads the pinned
# release from GitHub; fresh.sh accepts it unattended by reading the signing
# certificate out of the .modl itself.
#
# Usage: ops/stage-embr.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

EMBR_CHARTS_URL="${EMBR_CHARTS_URL:-https://github.com/mussonindustrial/embr/releases/download/releases/8.3/2026.9.9/Embr-Charts-Ignition83-6.0.4.modl}"

mkdir -p "${MODULES_DIR}"
target="${MODULES_DIR}/$(basename "${EMBR_CHARTS_URL}")"
if [[ -f "${target}" ]]; then
  ok "Already staged: $(basename "${target}")"
  exit 0
fi
info "Downloading Embr Charts from ${EMBR_CHARTS_URL} ..."
rm -f "${MODULES_DIR}"/Embr-Charts-*.modl
curl -fsSL -o "${target}" "${EMBR_CHARTS_URL}"
unzip -p "${target}" module.xml | grep -o '<id>[^<]*</id>' >/dev/null || { err "Not a module file."; rm -f "${target}"; exit 1; }
ok "Staged $(basename "${target}") -> ops/modules/ (fresh.sh will accept it alongside Doom)."
