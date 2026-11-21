#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lock="$root/tools/lemmascript/skills.lock"
repo="$(sed -n 's/^repo=//p' "$lock")"
commit="$(sed -n 's/^commit=//p' "$lock")"
checkout="$(mktemp -d)"
trap 'rm -rf "$checkout"' EXIT

git clone --quiet "$repo" "$checkout"
git -C "$checkout" checkout --quiet "$commit"
for source in "$checkout"/lemmascript*/; do
  skill="$(basename "$source")"
  destination="$root/.agents/skills/$skill"
  rm -rf "$destination"
  cp -R "$source" "$destination"
done

echo "Synced lemmascript skills at $commit"
