import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../../apps/windows/' + file, import.meta.url), 'utf8');
const code = read('Tasks.App/MainWindow.cs');
const xaml = read('Tasks.App/Shell.xaml');
test('all primary activation surfaces open dedicated workspace details, never a focus mutation or action popup', () => {
  assert.match(xaml, /<StackPanel x:Name="TaskDetailsPanel"[^>]*Visibility="Collapsed"/);
  assert.match(code, /Find<Button>\("CurrentTitleActions"\)\.Click[\s\S]*?OpenDetails\(current.TaskId, current.OccurrenceId\)/);
  const row = code.slice(code.indexOf('private Button OccurrenceRow('), code.indexOf('private void OpenDetails('));
  assert.match(row, /button.Click.*OpenDetails\(occurrence.TaskId, occurrence.OccurrenceId\)/);
  assert.doesNotMatch(row, /Flyout|client.Select/);
  assert.match(code, /row.Click.*OpenDetails\(task.Id, occurrence\?\.OccurrenceId\)/);
  assert.match(code, /workspace.OpenTask\(taskId, page, occurrenceId\)/);
  assert.match(code, /page = workspace.Back\(\)/);
  assert.match(code, /workspace.ResolveTask\(client.State\)/);
  assert.match(code, /workspace.ResolveOccurrence\(client.State\)/);
  assert.match(code, /Task details/);
  assert.match(code, /Full completion history is not available/);
  assert.match(code, /task.CreatedAt/);
  assert.match(code, /occurrence.CompletedAt/);
  assert.match(code, /TaskDetailsPanel"\)\.Children.Clear\(\)/);
});
test('add and edit use the same in-workspace editor and only confirmed saves navigate to refreshed details', () => {
  assert.match(xaml, /<StackPanel x:Name="TaskEditorPanel"[^>]*Visibility="Collapsed"/);
  assert.doesNotMatch(code, /TaskEditor.ShowAsync|internal static class TaskEditor/);
  assert.match(code, /workspace.BeginAdd\(page, Today\)/);
  assert.match(code, /workspace.BeginEdit\(client.State\)/);
  assert.match(code, /workspace.CancelEdit\(\)/);
  assert.match(code, /workspace.SaveAsync\(client, payload, date, \(\) => Today, ct\)/);
  const workspace = read('Tasks.Core/TaskWorkspace.cs');
  assert.match(workspace, /ConfirmSaved\(client.State, savedId\)/);
  assert.match(code, /if \(!saved\)\s*\{/);
  assert.match(workspace, /ReferenceEquals\(Draft, draft\)/);
  assert.match(code, /TaskEditorPanel"\)\.Children.Clear\(\)/);
  assert.match(code, /allowDuringEditor: true\);/);
  const editor = read('Tasks.App/TaskEditor.cs');
  assert.doesNotMatch(editor, /ContentDialog|Header = "(?:Category|Priority|Notes|Description)|Next due/);
  for (const header of ['Task name', 'Repeat', 'First due date']) assert.ok(editor.includes(`Header = "${header}"`));
  assert.match(editor, /operations.CanSubmit/);
  assert.match(editor, /draft.ToPayload\(\)/);
  assert.match(editor, /draft.Title = title.Text/);
  assert.match(editor, /draft.Interval = interval.Value/);
  assert.match(editor, /draft.Repeat = repeats\[repeat.SelectedIndex\]/);
  assert.match(editor, /interval.Visibility = draft.Repeat == "once" \? Visibility.Collapsed : Visibility.Visible/);
});
test('affected native lists and pages expose only task names and schedules, not removed fields', () => {
  assert.doesNotMatch(code, /occurrence.Category|task.Category|current\?\.Notes|CurrentNotes/);
  assert.doesNotMatch(xaml, /CurrentNotes|Header="(?:Notes|Description|Category|Priority)/);
  assert.doesNotMatch(code, /Next due/);
  const editor = read('Tasks.App/TaskEditor.cs');
  assert.doesNotMatch(editor, /Category|Priority|Notes|Description/);
});
test('rollover and lost sessions clear rendered task content and reject stale editor submission before a write', () => {
  assert.match(code, /var connected = client.IsConnected && client.State is not null && !operations.IsSigningOut\s*&& client.State.Date == Today.ToString\("yyyy-MM-dd"\)/);
  assert.match(code, /private async Task SaveWorkspaceAsync\(TaskDraft payload\)\s*\{\s*Render\(\);/);
  assert.match(code, /if \(!connected \|\| workspace.Draft is null\)[\s\S]*?TaskEditorPanel"\)\.Children.Clear\(\);[\s\S]*?taskEditor = null/);
  assert.match(code, /dialog.Content = operations.IsConnected/);
  assert.match(code, /session == client.Session && date == Today/);
});
test('creation and edit primary actions are named for the operation being submitted', () => {
  const editor = read('Tasks.App/TaskEditor.cs');
  assert.ok(editor.includes('submit.Content = isNew ? "Add task" : "Save changes";'));
  assert.ok(code.includes('isNew: workspace.TaskId is null'));
});
test('refresh preserves logical details focus and reconnect restores the editor field using native focus APIs', () => {
  assert.match(code, /CaptureWorkspaceFocus\(\)/);
  assert.match(code, /FocusManager.GetFocusedElement\(root.XamlRoot\)/);
  for (const action of ['back', 'edit', 'archive', 'focus', 'complete', 'undo'])
    assert.ok(code.includes(`Tag = "details:${action}"`), action);
  assert.match(code, /FindButton\(Find<StackPanel>\("TaskDetailsPanel"\), detailFocusAction\)/);
  const editor = read('Tasks.App/TaskEditor.cs');
  assert.match(editor, /FocusedField/);
  assert.match(editor, /FocusField/);
  assert.match(code, /taskEditor\?\.FocusField\(editorFocusField\)/);
});
test('acknowledged creation offers verification rather than another add and freezes the acknowledged fields', () => {
  const editor = read('Tasks.App/TaskEditor.cs');
  assert.ok(editor.includes('draft.AcknowledgedCreationId is not null'));
  assert.ok(editor.includes('"Verify saved task"'));
  assert.match(editor, /control.IsEnabled = .*?!pending/);
  assert.ok(editor.includes('?? (title.IsEnabled ? title : submit)'));
  assert.ok(code.includes('The server accepted this task, but readback is not confirmed. Reconnect, then verify the saved task.'));
  assert.doesNotMatch(code, /oldIds|SingleOrDefault/);
});
