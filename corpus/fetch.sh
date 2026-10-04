#!/bin/sh
# Clones the official ESX resources into corpus/cache/ (ignored by git), to
# measure fxaudit on real code. Everything runs in Docker.
#   sh corpus/fetch.sh
#   docker compose run --rm node node src/cli.ts ../corpus/cache
set -eu
cd "$(dirname "$0")"
mkdir -p cache
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/cache":/c -w /c --entrypoint sh alpine/git -c '
  for r in esx-framework/esx_core esx-framework/esx-legacy-addons; do
    name=$(basename "$r")
    if [ -d "$name" ]; then git -C "$name" pull -q --ff-only; else git clone -q --depth 1 "https://github.com/$r.git" "$name"; fi
    echo "$name $(git -C "$name" rev-parse --short HEAD)"
  done'
