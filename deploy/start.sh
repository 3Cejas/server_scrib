#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEEP_AWAKE_LIB="${SUTURA_KEEP_AWAKE_LIB:-$ROOT_DIR/deploy/keep-awake.sh}"

if [[ ! -r "$KEEP_AWAKE_LIB" ]]; then
  echo "No se encuentra el helper de mantenimiento: $KEEP_AWAKE_LIB" >&2
  exit 127
fi
# shellcheck disable=SC1090
source "$KEEP_AWAKE_LIB"

cleanup() {
  local exit_code="$?"
  trap - EXIT HUP INT TERM
  sutura_maintenance_lease_release
  exit "$exit_code"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
sutura_maintenance_lease_acquire "scrib-repo-start" "actualización e inicio del servidor SCRIB"

cd "$ROOT_DIR"

git pull

npm install

sutura_maintenance_lease_release
trap - EXIT HUP INT TERM

export NODE_ENV=production

exec node server.js
