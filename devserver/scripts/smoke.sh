#!/bin/sh
# Waits for the dev server to finish starting, then fails on any sign that
# safe_events or the demo did not load. Usage: smoke.sh <devserver dir>
set -u
cd "$1"

logs() { docker compose logs --no-color fxserver 2>&1; }

for _ in $(seq 1 60); do
  logs | grep -q 'Started resource safe_events_demo' && break
  logs | grep -qE 'Could not authenticate server license key|Couldn.t start resource' && break
  sleep 3
done

status=0
if ! logs | grep -q 'Started resource safe_events_demo'; then
  echo 'safe_events_demo did not start.' >&2
  status=1
fi
if logs | grep -E 'SCRIPT ERROR|Couldn.t start resource|Couldn.t find resource|Could not authenticate server license key|\[safe_events\].*error' >&2; then
  echo 'Errors found in the server logs (above).' >&2
  status=1
fi

echo '--- last lines of the server log ---'
logs | tail -n 40
exit $status
