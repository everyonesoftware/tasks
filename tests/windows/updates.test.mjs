import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = name => readFileSync(new URL(`../../apps/windows/${name}`, import.meta.url), 'utf8');

test('retired manual checker remains a bridge compatibility fixture, not shipped dead production code', () => {
  assert.equal(existsSync(new URL('../../apps/windows/Tasks.Core/WindowsUpdateClient.cs', import.meta.url)), false);
  assert.match(read('Tasks.Core.Tests/LegacyWindowsUpdateClient.cs'), /class WindowsUpdateClient/);
});

test('Settings uses integrated explicit Check -> Download -> Restart with real version', () => {
  const code = read('Tasks.App/MainWindow.cs');
  assert.match(code, /WindowsAppVersion.FromAssembly\(typeof\(MainWindow\).Assembly\)/);
  assert.match(code, /new WindowsUpdatesPanel\(root, DispatcherQueue, RestartUpdatesAsync\)/);
  assert.match(code, /new WindowsUpdateController\(new WindowsUpdateBackend\(\),/);
  assert.match(code, /client.PrepareForUpdateRestartAsync\(lifetime.Token\)/);
  assert.doesNotMatch(code, /WindowsUpdateClient|Launcher.LaunchUriAsync|updateResult/);
  const panel = read('Tasks.App/WindowsUpdatesPanel.cs');
  assert.match(panel, /controller.CheckAsync\(\)/);
  assert.match(panel, /controller.DownloadAsync\(\)/);
  assert.match(read('Tasks.App/Shell.xaml'), /x:Name="RestartUpdate"[^>]*Content="Restart and install"/);
  assert.match(panel, /state.Progress/);
  assert.match(panel, /dispatcher.TryEnqueue/);
  assert.match(panel, /controller.Status/);
});

test('update panel binds named controls without traversing unloaded native parents', () => {
  const panel = read('Tasks.App/WindowsUpdatesPanel.cs');
  assert.doesNotMatch(panel, /\.Parent\b|\.Children\.Add\(|\.OfType<TextBlock>\(\)\.Last/);
  assert.match(panel, /root.FindName\("RestartUpdate"\)/);
  const shell = read('Tasks.App/Shell.xaml');
  assert.match(shell, /x:Name="RestartUpdate"[^>]*Visibility="Collapsed"/);
  assert.doesNotMatch(shell, /Downloads open in your browser/);
});

test('restart holds task operation gate through protected session readback and apply', () => {
  const code = read('Tasks.App/MainWindow.cs');
  const restart = code.slice(code.indexOf('private async Task RestartUpdatesAsync'), code.indexOf('private async Task SignInAsync'));
  assert.match(restart, /operations.TryBeginRestart\(\)/);
  assert.match(restart, /await updates.RestartAsync\(\)/);
  assert.match(restart, /finally[\s\S]*operations.EndRestart\(\)/);
  assert.match(code, /updates.Dispose\(\)/);
  assert.match(code, /updatesPanel.Dispose\(\)/);
  const startup = code.slice(code.indexOf('root.Loaded +='), code.indexOf('Closed +='));
  assert.doesNotMatch(startup, /updates\.(Check|Download|Restart)/);
});

test('Velopack hook runs before WinUI, disables startup apply and pins actual Music version', () => {
  const program = read('Tasks.App/Program.cs');
  assert.match(program, /VelopackApp.Build\(\).SetAutoApplyOnStartup\(false\).Run\(\)/);
  assert.ok(program.indexOf('VelopackApp.Build') < program.indexOf('InitializeComWrappers'));
  assert.match(read('Tasks.App/Tasks.App.csproj'), /PackageReference Include="Velopack" Version="1.2.161"/);
  const backend = read('Tasks.App/WindowsUpdateBackend.cs');
  assert.match(backend, /AllowVersionDowngrade = false/);
  assert.match(backend, /MaximumDeltasBeforeFallback = -1/);
  assert.match(backend, /accessToken: null/);
});
