#!/usr/bin/env bash
# Stage the Mustry TimescaleDB Historian module next to the Doom module so the
# dev gateway can historize the marine's health. Builds it from the sibling
# repo, signed with the same throwaway dev certificate the Doom module uses, so
# the unattended acceptance in fresh.sh covers both.
#
# Usage: ops/stage-historian.sh            (HISTORIAN_REPO overrides the path)
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

HISTORIAN_REPO="${HISTORIAN_REPO:-${PROJECT_ROOT}/../timescaledb-historian-module}"
if [[ ! -f "${HISTORIAN_REPO}/build.gradle.kts" ]]; then
  err "TimescaleDB historian repo not found at ${HISTORIAN_REPO} (set HISTORIAN_REPO)."
  exit 1
fi

ensure_dev_keystore
info "Building the TimescaleDB Historian module from ${HISTORIAN_REPO} (dev-signed)..."
( cd "${HISTORIAN_REPO}" && ./gradlew clean build -x test --console plain \
    -Dorg.gradle.java.installations.auto-download=false \
    -Pignition.signing.keystoreFile="${KEYSTORE_FILE}" \
    -Pignition.signing.keystorePassword="${SIGNING_PASS}" \
    -Pignition.signing.certFile="${CERT_FILE}" \
    -Pignition.signing.certAlias="${CERT_ALIAS}" \
    -Pignition.signing.certPassword="${SIGNING_PASS}" )
modl="$(find "${HISTORIAN_REPO}/build" -maxdepth 1 -name '*.modl' ! -name '*.unsigned.modl' | head -1)"
[[ -n "${modl}" ]] || { err "No signed historian .modl produced."; exit 1; }
mkdir -p "${MODULES_DIR}"
cp "${modl}" "${MODULES_DIR}/"
ok "Staged $(basename "${modl}") -> ops/modules/ (fresh.sh will accept it alongside Doom)."
