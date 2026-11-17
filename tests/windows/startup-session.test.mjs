import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../../apps/windows/Tasks.App/${name}`, import.meta.url), 'utf8');

test('first native frame shows session restoration, never the sign-in form', () => {
  const xaml = read('Shell.xaml');
  assert.match(xaml, /<Grid\b[^>]*x:Name="StartupPanel"[^>]*Grid.Row="1"/);
  assert.doesNotMatch(xaml.match(/<Grid\b[^>]*x:Name="StartupPanel"[^>]*>/)?.[0] ?? '', /Visibility="Collapsed"/);
  for (const name of ['SignInPanel', 'ConnectionPanel', 'Workspace']) {
    assert.match(xaml, new RegExp(`x:Name="${name}"[^>]*Visibility="Collapsed"`));
  }
  const code = read('MainWindow.cs');
  assert.match(code, /StartupPanel"\)\.Visibility = Visible\(startup.IsRestoring\)/);
  assert.match(code, /SignInPanel"\)\.Visibility = Visible\(!startup.IsRestoring && !startup.NeedsRetry/);
  assert.match(code, /Workspace"\)\.Visibility = Visible\(!startup.IsRestoring && connected\)/);
});
