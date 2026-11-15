import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../../apps/windows/${name}`, import.meta.url), 'utf8');

test('Settings exposes real installed version and manual Windows release controls', () => {
  const xaml = read('Tasks.App/Shell.xaml');
  const code = read('Tasks.App/MainWindow.cs');
  for (const name of ['InstalledVersion', 'UpdateStatus', 'UpdateProgress', 'CheckUpdates', 'DownloadUpdate', 'ReleaseNotes', 'LastUpdateCheck']) {
    assert.ok(xaml.includes(`x:Name="${name}"`), `Missing update control ${name}`);
  }
  assert.match(code, /WindowsAppVersion.FromAssembly\(typeof\(MainWindow\).Assembly\)/);
  assert.match(code, /Find<Button>\("CheckUpdates"\)\.Click/);
  assert.match(code, /Find<Button>\("DownloadUpdate"\)\.Click/);
  assert.match(code, /Launcher.LaunchUriAsync/);
  assert.match(xaml, /browser/);
  assert.doesNotMatch(xaml, /Windows development build · No automatic updater/);
});

test('update checks are independent of task network operations and cannot duplicate', () => {
  const code = read('Tasks.App/MainWindow.cs');
  assert.match(code, /if \(checkingUpdates \|\| closed\) return/);
  assert.match(code, /updates.CheckAsync\(installedVersion.BuildNumber, lifetime.Token\)/);
  assert.match(code, /updateResult = null/);
  assert.match(code, /checkingUpdates = true/);
  assert.match(code, /checkingUpdates = false/);
  assert.match(code, /updates.Dispose\(\)/);
  const check = code.slice(code.indexOf('private async Task CheckUpdatesAsync'), code.indexOf('private async Task DownloadUpdateAsync'));
  assert.doesNotMatch(check, /RunAsync\(|client\./);
});
