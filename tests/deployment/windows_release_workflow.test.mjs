import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/publish.yml', import.meta.url), 'utf8');
function job(name) {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `${name} job exists`);
  return match[1];
}

test('main push and manual releases gate only changed platforms and require selected jobs to succeed', () => {
  assert.match(workflow, /push:\n    branches: \[main\]\n  workflow_dispatch:/);
  assert.match(job('validate'), /if: github.ref == 'refs\/heads\/main'/);
  assert.match(job('validate'), /node --test tests\/deployment\/windows_release_workflow.test.mjs/);
  assert.match(job('validate'), /node --test tests\/windows\/\*\.test\.mjs/);
  for (const platform of ['android', 'windows']) assert.match(job(platform), /needs: validate/);
  for (const platform of ['android', 'windows']) {
    assert.ok(job(platform).includes(`if: needs.validate.outputs.build_${platform} == 'true'`));
    assert.ok(job('validate').includes(`build_${platform}: \${{ steps.select.outputs.build_${platform} }}`));
  }
  assert.ok(job('validate').includes('node scripts/selective-builds.mjs'));
  const release = job('release');
  assert.match(release, /needs: \[validate, android, windows\]/);
  assert.match(release, /if:.*!cancelled\(\).*needs.validate.result == 'success'/);
  for (const platform of ['android', 'windows']) {
    assert.ok(release.includes(`needs.${platform}.result == 'success' || needs.${platform}.result == 'skipped'`));
  }
  assert.doesNotMatch(release, /continue-on-error:/);
  assert.equal((workflow.match(/contents: write/g) ?? []).length, 1);
  assert.match(release, /permissions:\n      contents: write/);
  assert.match(job('container'), /needs: validate/);
  assert.doesNotMatch(job('container'), /needs:.*(?:android|windows|release)/);
});

test('Windows uses pinned native toolchain and explicit shell contracts before installer lifecycle', () => {
  const windows = job('windows');
  for (const required of [
    'runs-on: windows-2025', 'fetch-depth: 0', 'persist-credentials: false',
    'DAYMARK_VERSION: ${{ needs.validate.outputs.version }}',
    'actions/setup-dotnet@26b0ec14cb23fa6904739307f278c14f94c95bf1',
    'global-json-file: apps/windows/global.json',
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', "node-version: '24'",
    "Get-ChildItem tests/windows -Filter '*.test.mjs'", 'node --test @windowsTests',
    'pwsh ./scripts/build-windows-installer.ps1 -BuildNumber $env:DAYMARK_VERSION -AllowUnsigned',
    'pwsh ./scripts/test-windows-installer.ps1 -InstallerPath "dist/windows/Tasks-Windows-$env:DAYMARK_VERSION-Setup.exe" -EvidenceDirectory "$env:RUNNER_TEMP/tasks-windows-evidence"',
  ]) assert.ok(windows.includes(required), `Windows missing ${required}`);
  assert.match(windows, /defaults:\n      run:\n        shell: pwsh/);
  assert.doesNotMatch(windows, /continue-on-error:|choco install|tests\/windows\/\*/);
  const lifecycle = windows.indexOf('- name: Test Windows installer lifecycle');
  const upload = windows.indexOf('- name: Upload Windows installer');
  assert.ok(lifecycle > windows.indexOf('pwsh ./scripts/build-windows-installer.ps1') && upload > lifecycle);
  assert.match(windows, /- name: Retain Windows lifecycle evidence\n        if: always\(\)/);
  const artifact = windows.slice(upload);
  assert.doesNotMatch(artifact, /if:|evidence|\.log|\.png/);
  assert.match(artifact, /name: Tasks-windows-\$\{\{ needs.validate.outputs.version \}\}/);
  assert.match(artifact, /path: \|\n            dist\/windows\/Tasks-Windows-\$\{\{ needs.validate.outputs.version \}\}-Setup.exe\n            dist\/windows\/Tasks-Windows-\$\{\{ needs.validate.outputs.version \}\}-Setup.exe.sha256/);
  for (const asset of ['TasksWindows-win-x64-Setup.exe', 'TasksWindows-win-x64-Setup.exe.sha256', 'TasksWindows-0.1.${{ needs.validate.outputs.version }}-win-x64-full.nupkg', 'releases.win-x64.json']) assert.ok(artifact.includes('dist/windows/' + asset), asset);
  assert.match(artifact, /if-no-files-found: error/);
});

test('native startup diagnostics run only after failed lifecycle and cannot replace acceptance', () => {
  const windows = job('windows');
  const diagnostic = windows.slice(windows.indexOf('- name: Diagnose native startup failure'), windows.indexOf('- name: Retain Windows lifecycle evidence'));
  assert.ok(diagnostic.startsWith('- name: Diagnose native startup failure'));
  assert.ok(diagnostic.includes("if: failure() && steps.lifecycle.outcome == 'failure'"));
  assert.ok(diagnostic.includes('timeout-minutes: 4'));
  assert.ok(diagnostic.includes('app-exit.json'));
  assert.ok(diagnostic.includes('67a8e1d39421a5ef5309c7017327c6a70ea6215a0e56e47ec22a7e9ec3b914e6'));
  assert.ok(diagnostic.includes('--debug-output --symbols'));
  assert.ok(diagnostic.includes('native-debugger.txt'));
  assert.ok(diagnostic.includes('WINAPP_CLI_TELEMETRY_OPTOUT'));
  assert.doesNotMatch(diagnostic, /continue-on-error:|exit 0/);
});

test('release downloads both platform inventories into separate paths', () => {
  const release = job('release');
  assert.equal((release.match(/actions\/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333/g) ?? []).length, 2);
  assert.equal((release.match(/digest-mismatch: error/g) ?? []).length, 2);
  for (const platform of ['android', 'windows']) {
    assert.match(release, new RegExp(`name: Tasks-${platform}-\\$\\{\\{ needs.validate.outputs.version \\}\\}\\n          path: dist/${platform}`));
    assert.ok(release.includes(`if: needs.validate.outputs.build_${platform} == 'true'`));
  }
  assert.match(release, /fetch-depth: 0/);
  assert.match(release, /DAYMARK_VERSION: \$\{\{ needs.validate.outputs.version \}\}/);
  assert.doesNotMatch(release, /upload-artifact|GH_TOKEN:.*KEYSTORE/);
});
