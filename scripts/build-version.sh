#!/usr/bin/env bash
# A release version is all commits reachable from HEAD, including merged branches.
set -euo pipefail
if [[ "$(git rev-parse --is-shallow-repository)" != false ]]; then
  echo "Cannot version a shallow checkout; fetch the complete history first." >&2
  exit 1
fi
version=$(git rev-list --count HEAD)
if [[ ! "$version" =~ ^[1-9][0-9]*$ ]] || (( version > 2100000000 )); then
  echo "Commit count is outside Android's supported versionCode range." >&2
  exit 1
fi
printf '%s\n' "$version"
