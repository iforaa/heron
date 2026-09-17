#!/usr/bin/env sh
# Runs `heron check` over every example scene. Library modules live in
# examples/lib/ and are not scenes, so only the top level is checked.
set -e
status=0
for f in examples/*.ts; do
  if node src/cli.ts check "$f" --fps 30 --json > /dev/null; then
    echo "ok    $f"
  else
    echo "FAIL  $f"
    status=1
  fi
done
exit $status
