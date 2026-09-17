#!/usr/bin/env bash
# Run the Playwright smoke test against the dev gateway.
#
# Usage:
#   ops/e2e.sh              Rebuild + redeploy the module, then run the suite.
#   ops/e2e.sh --fresh      Recreate the gateway unattended (fresh 2h trial,
#                           module pre-accepted) and run the suite. What CI runs.
#   ops/e2e.sh --no-deploy  Skip build/deploy; test whatever the gateway serves.
#
# Extra arguments after the mode flag are passed to `playwright test`.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MODE="deploy"
case "${1:-}" in
  --fresh)     MODE="fresh";  shift ;;
  --no-deploy) MODE="none";   shift ;;
esac

require_docker

case "${MODE}" in
  fresh)
    "${OPS_DIR}/fresh.sh"
    # Sessions opened right after the acceptance restart can drop their
    # websocket once while background services settle.
    sleep 15
    ;;
  deploy)
    "${OPS_DIR}/deploy.sh"
    ;;
  none)
    wait_for_gateway 12
    ;;
esac

# The gateway must serve the bundle and the engine before we boot a browser.
bundle_ok=""
for _ in $(seq 1 12); do
  if curl -fsS -o /dev/null "${GATEWAY_URL}/res/mustry-doom/MustryDoom.js" 2>/dev/null \
     && curl -fsS -o /dev/null -I "${GATEWAY_URL}/res/mustry-doom/doom/websockets-doom.wasm" 2>/dev/null; then
    bundle_ok=1
    break
  fi
  sleep 5
done
if [[ -z "${bundle_ok}" ]]; then
  err "Gateway is up but not serving the module. Is it installed/accepted?"
  exit 1
fi

cd "${PROJECT_ROOT}/e2e"
if [[ ! -d node_modules ]]; then
  info "Installing e2e dependencies (first run)..."
  npm ci
  npx playwright install --with-deps chromium
fi

info "Running the Playwright suite against ${GATEWAY_URL} ..."
E2E_BASE_URL="${GATEWAY_URL}" npx playwright test "$@"
