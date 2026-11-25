#!/bin/sh
# Runs the Stately native model checker over the maintained verification models.
# The checker ships with the Stately skill and is not a runtime dependency.
set -u

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SKILL=${STATELY_SKILL_DIR:-"$HOME/.agents/skills/stately"}
CHECK="$SKILL/scripts/stately-check"
OUT_ROOT=${STATELY_OUT:-"$ROOT/.artifacts/stately-runs"}

if [ ! -f "$CHECK" ]; then
  echo "Stately checker not found at $CHECK" >&2
  echo "Install the skill: npx skills add statelyai/skills --skill stately -g" >&2
  exit 2
fi

mkdir -p "$OUT_ROOT"
index=0
for model in "$ROOT"/verification/stately/models/*/concurrent/Flow.json \
             "$ROOT"/verification/stately/models/*/Flow.json; do
  [ -f "$model" ] || continue
  dir=$(dirname "$model")
  name=$(basename "$dir")
  parent=$(basename "$(dirname "$dir")")
  if [ "$name" = "concurrent" ]; then
    name="${parent}-concurrent"
  fi
  index=$((index + 1))
  out="$OUT_ROOT/$name-$index"
  rm -rf "$out"
  echo
  echo "== $name =="
  sh "$CHECK" check "$model" --rules "$dir/Flow.rules.json" --out "$out" --json >/dev/null
  if [ -f "$out/compact-report.md" ]; then
    sed -n '1,80p' "$out/compact-report.md"
  else
    echo "No report written to $out" >&2
    exit 1
  fi
done
