#!/usr/bin/env bash
# Recreate the dev gateway from a fresh volume, fully unattended: headless
# commissioning, module certificate + licence pre-accepted, module running.
# Also the fix for an expired 2h Perspective trial.
#
# Usage: ops/fresh.sh [--no-build]   (--no-build reuses the staged .modl)

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_docker

if [[ "${1:-}" != "--no-build" ]]; then
  build_and_stage_module
fi

info "Recreating the gateway from a fresh volume (unattended)..."
"${COMPOSE[@]}" down -v
"${COMPOSE[@]}" up -d
wait_for_gateway 60
wait_for_modules_registry 60
accept_staged_module
wait_for_commissioned 60

echo
ok "Gateway is up at ${GATEWAY_URL} (admin / password)."
echo "   Doom: ${GATEWAY_URL}/data/perspective/client/verify"
