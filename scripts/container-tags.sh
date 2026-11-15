#!/usr/bin/env bash
# Old run replays keep their numbered tag, never roll back latest.
set -euo pipefail
version=${1:?Commit-count version required}
sha=${2:?Build SHA required}
[[ "$version" =~ ^[1-9][0-9]*$ ]]
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
remote=$(git ls-remote --exit-code origin refs/heads/main)
read -r main_sha _ <<< "$remote"
[[ "$main_sha" =~ ^[0-9a-f]{40}$ ]]
printf 'ghcr.io/everyonesoftware/tasks:%s\n' "$version"
if [[ "$sha" == "$main_sha" ]]; then
  printf 'ghcr.io/everyonesoftware/tasks:latest\n'
fi
