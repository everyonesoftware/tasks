import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const read = name => {
  const path = resolve(root, 'apps/windows', name);
  assert.ok(existsSync(path), `Native Windows source must exist: ${name}`);
  return readFileSync(path, 'utf8');
};

test('Familiar native shell starts without task data while restoring authentication', () => {
  const xaml = read('Tasks.App/Shell.xaml');
  for (const name of ['SignInPanel', 'ServerUrl', 'Username', 'Password', 'Workspace', 'CurrentTitle', 'QueueList', 'DailyProgress', 'ConnectionPanel']) {
    assert.ok(xaml.includes(`x:Name="${name}"`), `Missing native control ${name}`);
  }
  assert.match(xaml, /x:Name="Workspace"[^>]*Visibility="Collapsed"/);
  assert.match(xaml, /#202B30/i);
  assert.match(xaml, /#BEDFC7/i);
  assert.doesNotMatch(xaml, /Read for 20 minutes|Water the plants|Desktop design study|data-variant|WebView/);
});

test('Familiar preserves Current task, an options flyout, bottom-right completion and daily progress', () => {
  const xaml = read('Tasks.App/Shell.xaml');
  assert.match(xaml, /Text="Current task"/);
  assert.match(xaml, /MenuFlyoutItem[^>]*Text="Not now"/);
  assert.match(xaml, /x:Name="MarkDone"[^>]*HorizontalAlignment="Right"/);
  assert.match(xaml, /Text="Waiting for you"/);
  assert.match(xaml, /<ProgressBar[^>]*x:Name="DailyProgress"/);
});

test('runtime XAML has unique names and does not require generated code', () => {
  const xaml = read('Tasks.App/Shell.xaml');
  const names = [...xaml.matchAll(/x:Name="([^"]+)"/g)].map(m => m[1]);
  assert.equal(names.length, new Set(names).size, 'XAML control names must be unique');
  assert.doesNotMatch(xaml, /x:Class|x:Bind|\sClick="|SelectionChanged="/);
});

test('all root namescope lookups resolve to the declared native control types', () => {
  const xaml = read('Tasks.App/Shell.xaml');
  const code = read('Tasks.App/MainWindow.cs');
  for (const [, type, name] of code.matchAll(/Find<([^>]+)>\("([^"]+)"\)/g)) {
    assert.match(xaml, new RegExp(`<${type}\\b[^>]*x:Name="${name}"`), `Invalid typed lookup ${type} ${name}`);
  }
  assert.doesNotMatch(code, /Find<MenuFlyoutItem>/);
});

test('native project preserves real Windows resources and self-contained release defaults', () => {
  const project = read('Tasks.App/Tasks.App.csproj');
  assert.match(project, /<UseWinUI>true/);
  assert.match(project, /<WindowsAppSDKSelfContained>true/);
  assert.match(project, /<AppxGeneratePriEnabled Condition="'\$\(OS\)' == 'Windows_NT'">true/);
  assert.match(project, /EmbeddedResource Include="Shell.xaml"/);
  assert.doesNotMatch(project, /OutputType>Library/);
});

test('Windows session adapter encrypts a single envelope without persisting task data', () => {
  const adapter = read('Tasks.App/WindowsSessionVault.cs');
  assert.match(adapter, /DataProtectionProvider\("LOCAL=user"\)/);
  assert.match(adapter, /ProtectAsync/);
  assert.match(adapter, /UnprotectAsync/);
  assert.match(adapter, /SessionProfile/);
  assert.doesNotMatch(adapter, /TaskItem|DayState|Occurrence|WriteAllText|PasswordVault|Console\./);
});

test('native actions use the authenticated client and clear password inputs', () => {
  const code = read('Tasks.App/MainWindow.cs');
  for (const method of ['SignInAsync', 'RestoreAsync', 'RefreshAsync', 'CompleteAsync', 'UndoAsync', 'SignOutAsync', 'NotNow']) {
    assert.ok(code.includes(`client.${method}(`), `Missing wired client action ${method}`);
  }
  assert.match(code, /workspace.SaveAsync\(client, payload, date/);
  assert.match(read('Tasks.Core/TaskWorkspace.cs'), /client.AddTaskAsync\(payload, invocationDate/);
  assert.match(code, /Password = string.Empty/);
  assert.match(code, /if \(busy \|\| closed\) return/);
  assert.match(code, /client\.State/);
  assert.doesNotMatch(code, /WebView|Console\.|exception\.ToString\(|ex\.Message/);
});

test('idle editor is separate from network operations and both monitor triggers may refresh it', () => {
  const code = read('Tasks.App/MainWindow.cs');
  assert.doesNotMatch(code, /private Task AddAsync\(\) => RunAsync/,
    'An idle workspace draft must not hold the network operation gate');
  const timer = code.slice(code.indexOf('refreshTimer.Tick'), code.indexOf('root.Loaded'));
  const activation = code.slice(code.indexOf('Activated +='), code.indexOf('Closed +='));
  for (const monitor of [timer, activation]) assert.match(monitor, /allowDuringEditor: true/);
  assert.match(code, /operations\.SetConnected\(connected\)/);
  assert.match(code, /editorSubmission: true/);
  assert.match(code, /if \(!saved\)\s*\{[\s\S]*?return;/);
  assert.match(code, /taskEditor\?\.UpdateSubmission\(operations\)/);
  assert.match(code, /control is not ScrollViewer/);
  const editor = read('Tasks.App/TaskEditor.cs');
  assert.match(editor, /submit\.IsEnabled = !saving && operations\.CanSubmit/);
  assert.match(editor, /if \(saving \|\| !operations\.CanSubmit\) return/);
});

test('failed credential deletion exposes a sign-out retry instead of an unusable sign-in form', () => {
  const code = read('Tasks.App/MainWindow.cs');
  assert.match(code, /client\.NeedsSignOutRetry/);
  assert.match(code, /SignInPanel"\)\.Visibility = Visible\(!startup.IsRestoring && !startup.NeedsRetry && client\.Session is null && !client\.NeedsSignOutRetry\)/);
  assert.match(code, /ConnectionPanel"\)\.Visibility = Visible\(!startup.IsRestoring && \(startup.NeedsRetry \|\| client\.NeedsSignOutRetry \|\|/);
  assert.match(code, /Find<Button>\("RetryConnection"\)\.Visibility = Visible\(!client\.NeedsSignOutRetry\)/);
});

test('sign-out clears native task views before waiting for remote revocation', () => {
  const code = read('Tasks.App/MainWindow.cs');
  const logout = code.slice(code.indexOf('private Task SignOutAsync'), code.indexOf('private Task AddAsync'));
  assert.ok(logout.includes('operations.BeginSignOut();'), 'Task access must be suspended immediately');
  assert.ok(logout.indexOf('Render();') < logout.indexOf('await client.SignOutAsync'), 'Clear rendered task views before remote logout');
  assert.ok(code.includes('client.IsConnected && client.State is not null && !operations.IsSigningOut'), 'Render must not resurrect task views during sign-out');
  assert.ok(logout.includes('operations.EndSignOut();'), 'Release sign-out state after all outcomes');
});

test('native build script fails closed off Windows and checks the actual publish inventory', () => {
  const code = read('build.ps1');
  assert.match(code, /if \(-not \$IsWindows\)/);
  assert.match(code, /dotnet publish/);
  for (const required of ['Tasks.exe', 'resources.pri', 'Microsoft.UI.Xaml.dll', 'Microsoft.WindowsAppRuntime.dll', 'coreclr.dll']) {
    assert.ok(code.includes(required), `Missing required publish file ${required}`);
  }
  assert.doesNotMatch(code, /OutputType=Library|PrepareForRunDependsOn|WindowsAppSDKSelfContained=false/);
});
