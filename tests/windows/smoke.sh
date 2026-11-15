#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
export DOTNET_ROOT=${DOTNET_ROOT:-/opt/data/tools/dotnet}
export PATH="$DOTNET_ROOT:$PATH"
export LD_LIBRARY_PATH="/opt/data/tools/icu/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
scratch=$(mktemp -d "${TMPDIR:-/opt/data/cache/scratch}/tasks-windows-smoke-XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
export TMPDIR="$scratch"
export TASKS_API_FIXTURE="$scratch/api-fixture"
go -C "$root/tests/windows/fixture" build -mod=readonly -o "$TASKS_API_FIXTURE" .
dotnet run --project "$root/tests/windows/Smoke/Smoke.csproj" -c Release --no-launch-profile
