import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../../apps/windows/Tasks.App/MainWindow.cs', import.meta.url), 'utf8');
test('completed disclosure is counted, keyboard accessible, and refresh-safe without storing task data', () => {
  const xaml = readFileSync(new URL('../../apps/windows/Tasks.App/Shell.xaml', import.meta.url), 'utf8');
  assert.ok(xaml.includes('x:Name="CompletedToggle"'));
  assert.ok(code.includes('completedDisclosure.Update('));
  assert.ok(code.includes('completedDisclosure.Toggle(); Render();'));
  assert.ok(code.includes('Completed today ({completed.Length})'));
  assert.ok(code.includes('Visible(completedDisclosure.IsExpanded)'));
});
test('row activation opens an explicit action popup with live eligibility checked again on invocation', () => {
  assert.ok(code.includes('private Button OccurrenceRow('));
  for (const label of ['Make current', 'Mark done', 'Undo']) assert.ok(code.includes(`Text = "${label}"`));
  for (const policy of ['CanFocus', 'CanComplete', 'CanUndo']) assert.ok(code.includes(`TaskActions.${policy}(client.State, occurrence, Today)`));
  assert.ok(!code.includes('if (occurrence is null) row.Click'));
  assert.ok(code.includes('No occurrence due today'));
  assert.ok(code.includes('button.Flyout = menu;'));
  assert.ok(!code.includes('button.Click += (_, _) => { if (!busy'));
});
test('current title is a keyboard-accessible button sharing the explicit row popup without changing heading appearance', () => {
  const xaml = readFileSync(new URL('../../apps/windows/Tasks.App/Shell.xaml', import.meta.url), 'utf8');
  assert.match(xaml, /<Button x:Name="CurrentTitleActions"[^>]*Padding="0"[^>]*Background="Transparent"[^>]*BorderThickness="0"[^>]*IsTabStop="True"/);
  assert.match(xaml, /<TextBlock x:Name="CurrentTitle"[^>]*FontFamily="Georgia"[^>]*FontSize="32"/);
  assert.match(code, /AttachOccurrenceActions\(Find<Button>\("CurrentTitleActions"\), current\)/);
  assert.match(code, /AttachOccurrenceActions\(button, occurrence\)/);
  assert.match(code, /private void AttachOccurrenceActions\(Button button, Occurrence occurrence\)/);
  assert.match(code, /Find<Button>\("CurrentTitleActions"\)\.Flyout = null/);
});
test('main current completion checks live client eligibility and uses one invocation date', () => {
  const handler = code.slice(code.indexOf('Find<Button>("MarkDone").Click'), code.indexOf('// A flyout has its own namescope'));
  assert.match(handler, /var date = Today;/);
  assert.match(handler, /CanAct && occurrence is not null && TaskActions.CanComplete\(client.State, occurrence, date\)/);
  assert.match(handler, /client.CompleteAsync\(occurrence, date, ct\)/);
});
test('task options offer accessible Edit and confirmed Archive, reusing the guarded draft editor', () => {
  assert.match(code, /TaskOptions\(string taskId, string title\)/);
  assert.match(code, /"Task options: " \+ title/);
  assert.match(code, /Text = "Edit"/);
  assert.match(code, /Text = "Archive"/);
  assert.match(code, /PrimaryButtonText = "Archive"/);
  assert.match(code, /DefaultButton = ContentDialogButton.Close/);
  assert.match(code, /client\.EditTaskAsync\(/);
  assert.match(code, /client\.ArchiveTaskAsync\(/);
  assert.match(code, /TaskDraft\? initial = null/);
  assert.match(code, /title.Text = initial.Title/);
  assert.match(code, /initial.StartDate/);
  assert.match(code, /editorSubmission: true/);
});
