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
test('dedicated details retain explicit guarded actions rather than implicitly selecting rows', () => {
  assert.ok(code.includes('private Button OccurrenceRow('));
  for (const label of ['Make current', 'Mark done', 'Undo']) assert.ok(code.includes(`Content = "${label}"`));
  const actions = code.slice(code.indexOf('private void AddDetailActions'), code.indexOf('private Grid WithOptions'));
  assert.match(actions, /if \(TaskActions.CanFocus\(client.State, occurrence, Today\)\)/);
  assert.match(actions, /if \(!CanAct \|\| !TaskActions.CanFocus\(client.State, occurrence, Today\)\) return/);
  for (const policy of ['CanComplete', 'CanUndo']) assert.ok(actions.includes(`CanAct && TaskActions.${policy}(client.State, occurrence, date)`));
  assert.match(actions, /else if \(TaskActions.CanUndo/);
  assert.doesNotMatch(code, /button.Flyout = menu/);
});
test('single current title is a keyboard-accessible details button without changing heading appearance', () => {
  const xaml = readFileSync(new URL('../../apps/windows/Tasks.App/Shell.xaml', import.meta.url), 'utf8');
  assert.match(xaml, /<Button x:Name="CurrentTitleActions"[^>]*Padding="0"[^>]*Background="Transparent"[^>]*BorderThickness="0"[^>]*IsTabStop="True"/);
  assert.match(xaml, /<TextBlock x:Name="CurrentTitle"[^>]*FontFamily="Georgia"[^>]*FontSize="32"/);
  assert.match(code, /Find<Button>\("CurrentTitleActions"\)\.Click/);
  assert.match(code, /OpenDetails\(current.TaskId, current.OccurrenceId\)/);
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
  const workspace = readFileSync(new URL('../../apps/windows/Tasks.Core/TaskWorkspace.cs', import.meta.url), 'utf8');
  assert.match(code, /workspace.SaveAsync\(client, payload, date/);
  assert.match(workspace, /client\.EditWorkspaceTaskAsync\(/);
  assert.match(code, /client\.ArchiveTaskAsync\(/);
  assert.match(code, /workspace.BeginEdit\(client.State\)/);
  assert.match(workspace, /ConfirmSaved\(client.State, savedId\)/);
  assert.match(code, /editorSubmission: true/);
});
