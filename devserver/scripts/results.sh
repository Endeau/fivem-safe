#!/bin/sh
# Prints what /se_all produced: every line a resource tags with [name], and
# Lua errors. Usage: results.sh <devserver dir>
cd "$1" && docker compose logs --no-color fxserver 2>&1 \
  | sed -E 's/\x1b\[[0-9;]*m//g; s/\^[0-9]//g' \
  | grep -E '\] \[[a-z_]+\] |SCRIPT ERROR|Attempted To'
