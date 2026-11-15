#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
export DOTNET_ROOT=${DOTNET_ROOT:-/opt/data/tools/dotnet}
export PATH="$DOTNET_ROOT:$PATH"
export LD_LIBRARY_PATH="/opt/data/tools/icu/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export VSTEST_ARTIFACTS_DIRECTORY="${TMPDIR:-/opt/data/cache/scratch}/tasks-windows-test-results"
mkdir -p "$VSTEST_ARTIFACTS_DIRECTORY"
dotnet test "$root/apps/windows/Tasks.Core.Tests/Tasks.Core.Tests.csproj" -c Release --nologo --logger 'trx;LogFileName=core-release.trx' --results-directory "$VSTEST_ARTIFACTS_DIRECTORY"
