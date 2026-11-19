import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = name => readFileSync(new URL(`../../apps/windows/${name}`, import.meta.url), 'utf8');

test('Current Version heading uses installed assembly identity beside the explicit check action', () => {
  const shell = read('Tasks.App/Shell.xaml');
  assert.match(shell, /<Grid ColumnSpacing="20">\s*<Grid.ColumnDefinitions><ColumnDefinition Width="\*"\s*\/><ColumnDefinition Width="Auto"\s*\/><\/Grid.ColumnDefinitions>\s*<TextBlock x:Name="CurrentVersion"[^>]*Text="Current Version:"[^>]*TextWrapping="Wrap"\s*\/>\s*<Button Grid.Column="1" x:Name="CheckUpdates"[^>]*Content="Check for updates"/);
  assert.match(read('Tasks.App/MainWindow.cs'), /Find<TextBlock>\("CurrentVersion"\).Text = \$"Current Version: \{WindowsAppVersion.FromAssembly\(typeof\(MainWindow\).Assembly\).Display\}"/);
  assert.doesNotMatch(shell, /Version &amp; updates|x:Name="InstalledVersion"/);
});

test('matched slate card renders honest phase titles and only confirmed current is mint', () => {
  const shell = read('Tasks.App/Shell.xaml');
  assert.match(shell, /<Border x:Name="WindowsUpdateCard" Background="#2B393F"[^>]*Padding="24,22"[^>]*>\s*<StackPanel Spacing="8">\s*<TextBlock x:Name="UpdateTitle" Text="Not checked yet"[^>]*TextWrapping="Wrap"/);
  const panel = read('Tasks.App/WindowsUpdatesPanel.cs');
  assert.match(panel, /title = \(TextBlock\)root.FindName\("UpdateTitle"\)/);
  for (const [phase, title] of Object.entries({ Idle: 'Not checked yet', Checking: 'Checking for updates', Current: 'Up to date', Available: 'Update available', Downloading: 'Downloading update', Ready: 'Ready to install', Restarting: 'Restarting', Error: 'Update failed', NotInstalled: 'Updates unavailable' })) {
    assert.ok(panel.includes(`WindowsUpdatePhase.${phase} => "${title}"`), `${phase} must have an honest title`);
  }
  assert.match(panel, /title.Foreground = state.Phase == WindowsUpdatePhase.Current \? mint : ink/);
  assert.match(panel, /check.Content = state.Phase == WindowsUpdatePhase.Checking \? "Checking…" : "Check for updates"/);
  assert.match(panel, /actions.Visibility = state.Phase is WindowsUpdatePhase.Available or WindowsUpdatePhase.Ready \? Visibility.Visible : Visibility.Collapsed/);
  assert.match(shell, /x:Name="UpdateActions"[^>]*Visibility="Collapsed"/);
});

test('compact updater has no last-check footer, helper paragraphs or replacement disclosure', () => {
  const shell = read('Tasks.App/Shell.xaml');
  const card = shell.slice(shell.indexOf('<Border x:Name="WindowsUpdateCard"'), shell.indexOf('</Border>', shell.indexOf('<Border x:Name="WindowsUpdateCard"')));
  assert.doesNotMatch(shell, /LastUpdateCheck|Download updates here, then choose/);
  assert.doesNotMatch(read('Tasks.App/WindowsUpdatesPanel.cs'), /lastCheck|Last checked:/);
  assert.doesNotMatch(card, /<Expander|Release notes|FontSize="12"/);
  assert.equal([...card.matchAll(/<TextBlock\b/g)].length, 2, 'card contains only the state title and honest state message');
});

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
