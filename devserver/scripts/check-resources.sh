#!/bin/sh
# Checks two mistakes that each cost a whole in-game test session:
#  1. a resource of the dev server that docker compose does not mount
#     (server.cfg ensures it, FiveM answers "Couldn't find resource");
#  2. a resource that restarts (or stops) another one and also depends on it:
#     that stops the dependent resource first, in the middle of its own
#     script, and the server hangs.
# Usage: check-resources.sh [devserver dir], run from the repository or in CI.
set -u
cd "${1:-devserver}"
status=0

check_mounts() { # resources dir, compose file
  for dir in "$1"/*/; do
    [ -f "${dir}fxmanifest.lua" ] || continue
    name=$(basename "$dir")
    if ! grep -q "$1/$name:" "$2"; then
      echo "$1/$name is not mounted in $2: add it to the fxserver volumes." >&2
      status=1
    fi
  done
}

check_mounts ./resources docker-compose.yml
[ -d private ] && check_mounts ./private docker-compose.private.yml

for manifest in resources/*/fxmanifest.lua private/*/fxmanifest.lua; do
  [ -f "$manifest" ] || continue
  dir=$(dirname "$manifest")
  code=$(find "$dir" -name '*.lua' ! -name fxmanifest.lua)
  [ -n "$code" ] && grep -qsE "(restart|stop|start|ensure) " $code || continue
  deps=$(grep -E "^[[:space:]]*dependenc" "$manifest" | grep -oE "'[a-zA-Z0-9_-]+'" | tr -d "'")
  for dep in $deps; do
    if grep -qsE "['\"]$dep['\"]" $code; then
      echo "$dir restarts $dep and depends on it: remove $dep from its dependencies." >&2
      status=1
    fi
  done
done

[ "$status" -eq 0 ] && echo "Dev server resources: all mounted, no restart of a dependency."
exit $status
