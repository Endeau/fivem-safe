#!/bin/sh
# Reproduces the parser spike without installing anything on the host.
# 1. clones the corpus (once), 2. installs deps, 3. runs the comparison.
set -eu
cd "$(dirname "$0")"

if [ ! -d corpus/esx_core ]; then
  mkdir -p corpus
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/corpus":/c -w /c --entrypoint sh alpine/git -c '
    for r in esx-framework/esx_core esx-framework/esx-legacy-addons overextended/ox_lib overextended/ox_inventory Qbox-project/qbx_core; do
      git clone -q --depth 1 "https://github.com/$r.git" "$(basename "$r")"
    done'
fi

docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/w -w /w node:22-alpine sh -c '
  [ -d node_modules ] || npm install --no-audit --no-fund --ignore-scripts >/dev/null
  node spike.mjs' > results.json
echo "results.json written"
