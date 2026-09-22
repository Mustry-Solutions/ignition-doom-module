#!/usr/bin/env bash
# Shared helpers for the ops/ scripts. Sourced by the other scripts; not run directly.

set -euo pipefail

# Resolve key paths relative to this file, so scripts work from any directory.
OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${OPS_DIR}/.." && pwd)"
MODULES_DIR="${OPS_DIR}/modules"

# Local self-signed signing material for development (gitignored). On a fresh
# gateway the certificate is accepted either once in the commissioning wizard
# (setup.sh) or unattended by seeding data/modules.json (accept_staged_module,
# used by fresh.sh / CI). These are throwaway dev creds.
SIGNING_DIR="${OPS_DIR}/signing"
KEYSTORE_FILE="${SIGNING_DIR}/dev-keystore.p12"
CERT_FILE="${SIGNING_DIR}/dev-cert.pem"
CERT_ALIAS="mdoom-dev"
SIGNING_PASS="devpassword"
SIGNING_DNAME="CN=Mustry Solutions (Dev), O=Mustry Solutions, C=BE"

# Must match MODULE_ID in common/.../MustryDoomModule.java.
MODULE_ID="com.mustrysolutions.doom"

# Use Java 17 for Gradle (matches the module's toolchain).
JAVA_17_HOME="/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home"
if [[ -d "${JAVA_17_HOME}" ]]; then
  export JAVA_HOME="${JAVA_17_HOME}"
fi

# Read host port overrides from .env (if present) so the printed URL matches
# compose. Variables already in the environment win over .env, as they do for
# compose itself, so a one-off override on the command line works.
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  while IFS='=' read -r k v; do
    [[ -z "${k}" || "${k}" == \#* ]] && continue
    if [[ -z "${!k:-}" ]]; then export "${k}=${v}"; fi
  done < "${PROJECT_ROOT}/.env"
fi
GATEWAY_HTTP_PORT="${GATEWAY_HTTP_PORT:-9188}"
# Container names are overridable (with the ports) so two checkouts, e.g. a
# worktree next to main, can each run their own gateway. Exported for compose.
export CONTAINER_NAME="${CONTAINER_NAME:-mdoom-ignition}"
export TIMESCALE_CONTAINER_NAME="${TIMESCALE_CONTAINER_NAME:-mdoom-timescaledb}"
GATEWAY_URL="http://localhost:${GATEWAY_HTTP_PORT}"
ADMIN_USER="admin"
ADMIN_PASS="password"

# docker compose invocation, always pointed at this project's compose file.
COMPOSE=(docker compose -f "${PROJECT_ROOT}/docker-compose.yml")

# --- pretty logging -------------------------------------------------------
if [[ -t 1 ]]; then
  C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
  C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi
info()  { echo "${C_BLUE}==>${C_RESET} $*"; }
ok()    { echo "${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}!${C_RESET} $*"; }
err()   { echo "${C_RED}✗${C_RESET} $*" >&2; }

# --- guards ---------------------------------------------------------------
require_docker() {
  if ! docker info >/dev/null 2>&1; then
    err "Docker does not appear to be running. Start Docker Desktop and try again."
    exit 1
  fi
}

# --- signing --------------------------------------------------------------
# Generate a local self-signed keystore + exported certificate the first time,
# so the module can be signed for the dev gateway. Throwaway dev credentials.
ensure_dev_keystore() {
  if [[ -f "${KEYSTORE_FILE}" && -f "${CERT_FILE}" ]]; then
    return 0
  fi
  local keytool="${JAVA_HOME:-}/bin/keytool"
  [[ -x "${keytool}" ]] || keytool="keytool"
  info "Generating a self-signed dev signing keystore (first time only)..."
  mkdir -p "${SIGNING_DIR}"
  "${keytool}" -genkeypair \
    -alias "${CERT_ALIAS}" \
    -keyalg RSA -keysize 2048 \
    -validity 3650 \
    -dname "${SIGNING_DNAME}" \
    -keystore "${KEYSTORE_FILE}" -storetype PKCS12 \
    -storepass "${SIGNING_PASS}"
  "${keytool}" -exportcert \
    -alias "${CERT_ALIAS}" \
    -keystore "${KEYSTORE_FILE}" -storetype PKCS12 \
    -storepass "${SIGNING_PASS}" \
    -rfc -file "${CERT_FILE}"
  ok "Created dev keystore at ops/signing/ (gitignored)."
}

# --- build & stage --------------------------------------------------------
# Build the module (signed with the local dev cert) and copy the freshly built
# .modl into ops/modules so the gateway can pick it up.
build_and_stage_module() {
  ensure_dev_keystore
  info "Building and signing the module with Gradle (first build downloads dependencies)..."
  # `clean` so the signed .modl is produced fresh and never confused with a stale
  # unsigned artifact. This module is small, so a clean build is quick.
  ( cd "${PROJECT_ROOT}" && ./gradlew clean build --console plain \
      -Dorg.gradle.java.installations.auto-download=false \
      -Pignition.signing.keystoreFile="${KEYSTORE_FILE}" \
      -Pignition.signing.keystorePassword="${SIGNING_PASS}" \
      -Pignition.signing.certFile="${CERT_FILE}" \
      -Pignition.signing.certAlias="${CERT_ALIAS}" \
      -Pignition.signing.certPassword="${SIGNING_PASS}" )

  # Select the SIGNED module, not the `.unsigned.modl` signing intermediate.
  local modl
  modl="$(find "${PROJECT_ROOT}/build" -maxdepth 1 -name '*.modl' ! -name '*.unsigned.modl' | head -1)"
  if [[ -z "${modl}" ]]; then
    err "No signed .modl found under build/ after the build. Aborting."
    exit 1
  fi

  mkdir -p "${MODULES_DIR}"
  # Replace only this module's previous build; other staged modules (the
  # TimescaleDB historian from ops/stage-historian.sh) stay.
  rm -f "${MODULES_DIR}"/Mustry-Doom*.modl 2>/dev/null || true
  cp "${modl}" "${MODULES_DIR}/"
  ok "Staged $(basename "${modl}") -> ops/modules/"
}

# --- wait for gateway -----------------------------------------------------
# Poll the gateway's StatusPing endpoint until it reports RUNNING (or time out).
wait_for_gateway() {
  local tries="${1:-60}"
  info "Waiting for the gateway to come up at ${GATEWAY_URL} ..."
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS "${GATEWAY_URL}/StatusPing" 2>/dev/null | grep -q '"state"'; then
      ok "Gateway is responding."
      return 0
    fi
    sleep 5
  done
  warn "Gateway did not report ready after $((tries * 5))s. Check 'ops/logs.sh'."
  return 1
}

# Stricter: wait until the gateway is RUNNING with no COMMISSIONING/FAULTED
# detail, i.e. fully commissioned and serving.
wait_for_commissioned() {
  local tries="${1:-60}"
  info "Waiting for the gateway to be commissioned and RUNNING ..."
  for ((i = 1; i <= tries; i++)); do
    if [[ "$(curl -fsS "${GATEWAY_URL}/StatusPing" 2>/dev/null)" == '{"state":"RUNNING"}' ]]; then
      ok "Gateway is commissioned and running."
      return 0
    fi
    sleep 5
  done
  err "Gateway did not reach a clean RUNNING state after $((tries * 5))s. Check 'ops/logs.sh'."
  return 1
}

# Wait until the gateway has written its module registry (data/modules.json
# with the built-ins' cert fingerprints). On a fresh volume this happens while
# the gateway parks in COMMISSIONING over the staged-but-unaccepted module —
# it's the point where accept_staged_module can safely merge.
wait_for_modules_registry() {
  local tries="${1:-60}"
  info "Waiting for the gateway to write its module registry ..."
  for ((i = 1; i <= tries; i++)); do
    if docker exec "${CONTAINER_NAME}" \
         grep -q certFingerprint /usr/local/bin/ignition/data/modules.json 2>/dev/null; then
      ok "Module registry present."
      return 0
    fi
    sleep 5
  done
  err "Gateway never wrote data/modules.json after $((tries * 5))s. Check 'ops/logs.sh'."
  return 1
}

# --- unattended module acceptance ------------------------------------------
# Pre-accept the staged module's signing certificate on an already-commissioned
# gateway, with no browser wizard. Ignition 8.3 records third-party acceptance
# in data/modules.json as {filename, onStartup, certFingerprint(sha1 of the
# signing cert)}; the gateway treats that file as authoritative, so we merge our
# entry into the gateway-written file (never replace it — it also carries every
# built-in module). Requires python3.
accept_staged_module() {
  local fingerprint tmp
  fingerprint="$(openssl x509 -in "${CERT_FILE}" -noout -fingerprint -sha1 \
                   | cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]')"
  [[ -n "${fingerprint}" ]] || { err "Could not fingerprint ${CERT_FILE}."; return 1; }
  ls "${MODULES_DIR}"/*.modl >/dev/null 2>&1 || { err "No staged .modl in ops/modules."; return 1; }

  info "Pre-accepting every staged module (cert fingerprint ${fingerprint})..."
  "${COMPOSE[@]}" stop gateway
  tmp="$(mktemp -d)"
  docker cp "${CONTAINER_NAME}:/usr/local/bin/ignition/data/modules.json" "${tmp}/modules.json"
  # Each staged .modl: module id from its module.xml, EULA acceptance as the
  # CRC32 of its license.html (matches ModuleUtil.calculateLicenseCrc), and the
  # certificate fingerprint of whoever signed it: our dev cert for the modules
  # we build, or the signer certificate shipped inside a third-party .modl
  # (certificates.p7b, e.g. Embr Charts).
  FINGERPRINT="${fingerprint}" MODULES_DIR="${MODULES_DIR}" \
  python3 - "${tmp}/modules.json" <<'PYEOF'
import glob, hashlib, json, os, re, subprocess, sys, zipfile, zlib
path = sys.argv[1]
with open(path) as f:
    modules = json.load(f)

def signer_fingerprint(z):
    """SHA-1 of the first certificate in the module's certificates.p7b (DER or PEM),
    lower-case hex; None when absent or unreadable (then the dev cert applies)."""
    if "certificates.p7b" not in z.namelist():
        return None
    import base64
    raw = z.read("certificates.p7b")
    for inform in ("DER", "PEM"):
        r = subprocess.run(["openssl", "pkcs7", "-inform", inform, "-print_certs"],
                           input=raw, capture_output=True)
        if r.returncode != 0:
            continue
        m = re.search(r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----", r.stdout.decode(), re.S)
        if m:
            return hashlib.sha1(base64.b64decode("".join(m.group(1).split()))).hexdigest()
    return None

for modl in sorted(glob.glob(os.path.join(os.environ["MODULES_DIR"], "*.modl"))):
    z = zipfile.ZipFile(modl)
    module_id = re.search(r"<id>([^<]+)</id>", z.read("module.xml").decode()).group(1).strip()
    fp = signer_fingerprint(z) or os.environ["FINGERPRINT"]
    entry = {
        "filename": f"/external-modules/{os.path.basename(modl)}",
        "onStartup": "enabled",
        "certFingerprint": fp,
    }
    if "license.html" in z.namelist():
        entry["licenseAgreementHash"] = zlib.crc32(z.read("license.html"))
    modules[module_id] = entry
    print(f"  accepted {module_id} <- {os.path.basename(modl)} (cert {fp[:12]}...)")
with open(path, "w") as f:
    json.dump(modules, f, indent=2)
PYEOF
  docker cp "${tmp}/modules.json" "${CONTAINER_NAME}:/usr/local/bin/ignition/data/modules.json"
  rm -rf "${tmp}"
  "${COMPOSE[@]}" run --rm -u root --entrypoint sh gateway \
      -c 'chown ignition:ignition /usr/local/bin/ignition/data/modules.json'
  "${COMPOSE[@]}" start gateway
  ok "Module acceptance seeded; gateway restarting."
}

# --- file-based gateway config ----------------------------------------------
# Ignition 8.3 keeps gateway config as files under data/config/resources/
# <collection>/<module>/<type>/<name>/. The "core" collection is owned by the
# gateway (files dropped there are swept away); "external" is the collection
# for externally managed config, which is what a committed dev profile is. Copy
# the resources from ops/gateway-config (the "Doom Historian" TimescaleDB
# profile) into external. Call it with the gateway RUNNING after its first
# clean start (pre-creating the tree FAULTS the gateway). Stops, seeds, restarts.
seed_gateway_config() {
  local src="${OPS_DIR}/gateway-config"
  local dst="/usr/local/bin/ignition/data/config/resources/external/com.inductiveautomation.historian"
  [[ -d "${src}/historian-provider" ]] || return 0
  if ! docker exec "${CONTAINER_NAME}" test -d /usr/local/bin/ignition/data/config/resources/core; then
    warn "Config tree not initialised (gateway not running or never started clean); skipping seeding."
    return 0
  fi
  info "Seeding gateway config (historian profile)..."
  "${COMPOSE[@]}" stop gateway
  # docker cp renames a directory when the destination is missing, so create
  # the exact target first and copy the folder's contents into it.
  "${COMPOSE[@]}" run --rm -u root --entrypoint sh gateway \
      -c "mkdir -p '${dst}/historian-provider' && chown -R ignition:ignition '${dst}'"
  docker cp "${src}/historian-provider/." "${CONTAINER_NAME}:${dst}/historian-provider/"
  "${COMPOSE[@]}" run --rm -u root --entrypoint sh gateway \
      -c "chown -R ignition:ignition '${dst}'"
  "${COMPOSE[@]}" start gateway
  ok "Gateway config seeded; gateway restarting."
}

# --- verify fixtures: operator WADs ---------------------------------------------
# The module reads operator-supplied IWADs/PWADs from
# data/modules/com.mustrysolutions.doom/wads/ (see docs/reference.md). The e2e
# suite needs one there without a registered IWAD in the repo: the shareware
# doom1.wad copied in under the name doom.wad (the engine identifies IWADs by
# file name, and doom.wad is a name it accepts; its contents still make it
# shareware). Needs the gateway container to exist; the data volume keeps it.
seed_verify_wads() {
  local src="${PROJECT_ROOT}/gateway/src/main/resources/mounted/doom/doom1.wad"
  local dst="/usr/local/bin/ignition/data/modules/com.mustrysolutions.doom/wads"
  [[ -f "${src}" ]] || { warn "No ${src}; skipping the verify WAD fixture."; return 0; }
  info "Seeding the verify WAD fixture (doom1.wad as ${dst}/doom.wad)..."
  "${COMPOSE[@]}" run --rm -u root --entrypoint sh gateway \
      -c "mkdir -p '${dst}' && chown -R ignition:ignition '${dst}'"
  docker cp "${src}" "${CONTAINER_NAME}:${dst}/doom.wad"
  # Hexen ships no IWAD (its demo carries no redistribution grant); the dev
  # gateway gets the 4-level demo when ops/fetch-hexen-demo.sh has run.
  local hexen="${PROJECT_ROOT}/engine/build/hexen-demo/hexen.wad"
  if [[ -f "${hexen}" ]]; then
    docker cp "${hexen}" "${CONTAINER_NAME}:${dst}/hexen.wad"
    ok "Hexen demo WAD seeded (dev gateway only)."
  else
    warn "No engine/build/hexen-demo/hexen.wad: run ops/fetch-hexen-demo.sh for the Hexen pages; the e2e Hexen test will skip."
  fi
  # Strife has no free data at all: the operator's own strife1.wad (and
  # voices.wad) in engine/build/strife/ (gitignored) get seeded when present.
  local strife
  for strife in strife1 voices; do
    if [[ -f "${PROJECT_ROOT}/engine/build/strife/${strife}.wad" ]]; then
      docker cp "${PROJECT_ROOT}/engine/build/strife/${strife}.wad" "${CONTAINER_NAME}:${dst}/${strife}.wad"
      ok "Strife ${strife}.wad seeded (dev gateway only)."
    fi
  done
  # Freedoom (BSD): a free registered-mode IWAD pair, so the suite can load a
  # PWAD with -file (no shareware IWAD can). ops/fetch-freedoom.sh gets it.
  local fd
  for fd in freedoom1 freedoom2; do
    if [[ -f "${PROJECT_ROOT}/engine/build/freedoom/${fd}.wad" ]]; then
      docker cp "${PROJECT_ROOT}/engine/build/freedoom/${fd}.wad" "${CONTAINER_NAME}:${dst}/${fd}.wad"
    fi
  done
  [[ -f "${PROJECT_ROOT}/engine/build/freedoom/freedoom2.wad" ]] \
    && ok "Freedoom seeded (dev gateway only)." \
    || warn "No engine/build/freedoom: run ops/fetch-freedoom.sh for the PWAD test; it will skip."
  # Our own tiny PWAD (committed): the -file payload the e2e suite checks for.
  docker cp "${OPS_DIR}/verify/wads/mustry-test.wad" "${CONTAINER_NAME}:${dst}/mustry-test.wad"
  "${COMPOSE[@]}" run --rm -u root --entrypoint sh gateway \
      -c "chown -R ignition:ignition '${dst}'"
  ok "Verify WAD fixture in place."
}
