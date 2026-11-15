import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../../apps/windows/${name}`, import.meta.url), 'utf8');

test('global Ctrl+N stays available without a whole-window hover tooltip', () => {
  const code = read('Tasks.App/MainWindow.cs');
  assert.match(code, /root\.KeyboardAcceleratorPlacementMode = Microsoft\.UI\.Xaml\.Input\.KeyboardAcceleratorPlacementMode\.Hidden/);
  assert.match(code, /Key = VirtualKey.N, Modifiers = VirtualKeyModifiers.Control/);
  assert.match(code, /root.KeyboardAccelerators.Add\(addShortcut\)/);
  assert.match(code, /if \(client.IsConnected\) await AddAsync\(\)/);
});

test('Tasks embeds and deploys a multi-resolution icon and assigns it to the running window', () => {
  const project = read('Tasks.App/Tasks.App.csproj');
  assert.ok(project.includes('<ApplicationIcon>Assets/Tasks.ico</ApplicationIcon>'), 'Executable must embed Tasks branding');
  assert.ok(/Content Include="Assets[\\/]Tasks.ico"[^>]*CopyToOutputDirectory="PreserveNewest"[^>]*CopyToPublishDirectory="PreserveNewest"/.test(project), 'Publish the runtime icon');
  assert.ok(read('Tasks.App/MainWindow.cs').includes('AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Tasks.ico"))'), 'Set the taskbar/window icon');
  const icon = readFileSync(new URL('../../apps/windows/Tasks.App/Assets/Tasks.ico', import.meta.url));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  const sizes = Array.from({ length: icon.readUInt16LE(4) }, (_, i) => icon[6 + i * 16] || 256);
  for (const size of [16, 24, 32, 48, 256]) assert.ok(sizes.includes(size), `Missing ${size}px icon`);
});

test('window uses an app-colored draggable title area instead of the classic frame', () => {
  const code = read('Tasks.App/MainWindow.cs');
  const xaml = read('Tasks.App/Shell.xaml');
  assert.ok(code.includes('ExtendsContentIntoTitleBar = true;'), 'Extend the slate content into the title area');
  assert.ok(code.includes('SetTitleBar(Find<Border>("TitleBar"))'), 'Keep native dragging and system caption controls');
  assert.ok(code.includes('AppWindow.TitleBar.ButtonBackgroundColor = Colors.Transparent'), 'Caption buttons blend into the app');
  assert.ok(code.includes('AppWindow.TitleBar.ButtonForegroundColor = Color.FromArgb(255, 237, 242, 237)'), 'Caption controls remain readable');
  assert.ok(/<Border[^>]*x:Name="TitleBar"[^>]*Background="#202B30"[^>]*Height="32"/.test(xaml), 'Provide a dedicated drag area');
  for (const panel of ['SignInPanel', 'ConnectionPanel', 'Workspace']) {
    assert.ok(new RegExp(`x:Name="${panel}"[^>]*Grid.Row="1"`).test(xaml), `${panel} must not overlap the title bar`);
  }
  assert.ok(/<StackPanel Grid.Row="2" Background="#192328"/.test(xaml), 'Status footer stays below content');
});

test('all navigation destinations have native icons, visible labels and stable accessible names', () => {
  const xaml = read('Tasks.App/Shell.xaml');
  const code = read('Tasks.App/MainWindow.cs');
  for (const [label, glyph] of [['Today', 'E706'], ['Upcoming', 'E787'], ['Routines', 'E8EE'], ['Settings', 'E713']]) {
    const button = xaml.match(new RegExp(`<Button x:Name="${label}Nav"[^>]*>[\\s\\S]*?</Button>`))?.[0];
    assert.ok(button, `Missing ${label} navigation content`);
    assert.ok(button.includes(`Glyph="&#x${glyph};"`), `Missing ${label} icon`);
    assert.ok(button.includes('FontFamily="Segoe MDL2 Assets"'), 'Use the native symbol font');
    assert.ok(button.includes(`Text="${label}"`), `Keep ${label} visible`);
    assert.ok(button.includes(`AutomationProperties.Name="${label}"`), `Name ${label} accessibly`);
  }
  assert.ok(!code.includes('(string)nav.Content'), 'Composite icon content must not be cast to a string');
  assert.ok(code.includes('AutomationProperties.SetName(nav, label +'), 'Selection announcements use the destination label');
});
