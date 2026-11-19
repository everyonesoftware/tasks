import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const screen = readFileSync(new URL('../../apps/android/app/src/main/java/com/everyonesoftware/daymark/TasksScreen.kt', import.meta.url), 'utf8');
test('navigation and daily progress retain explicit original slate mint palette', () => {
 assert.ok(screen.includes('NavigationBarItemDefaults.colors(selectedIconColor=Mint,selectedTextColor=Mint,indicatorColor=Color(0xFF344B41),unselectedIconColor=Muted,unselectedTextColor=Muted)'), 'explicit navigation palette');
 assert.ok(/LinearProgressIndicator\(progress=.*color=Mint,trackColor=Color\(0xFF3B4B50\)/.test(screen), 'explicit daily progress palette');
});
test('new and edit submit labels match approved dedicated pages', () => {
 assert.ok(screen.includes('Text(if(task==null) "Add task" else "Save changes")'));
 assert.ok(!screen.includes('"Save task"'));
});
test('idle refresh keeps editor fields enabled without bypassing write gate', () => {
 const model=readFileSync(new URL('../../apps/android/app/src/main/java/com/everyonesoftware/daymark/MainActivity.kt', import.meta.url), 'utf8');
 assert.ok(model.includes('copy(busy=true,refreshing=true)'), 'refresh remains busy but is classified');
 assert.ok(model.includes('if(mutable.value.busy || !repo.snapshot.online) return'), 'write gate still includes refresh');
 assert.ok(screen.includes('state.editorBusy'), 'editor uses mutation busy for fields');
 assert.ok(screen.includes('state.snapshot.online && !state.busy'), 'save gate still includes refresh');
});
test('task activation opens a dedicated page, never a task dialog', () => {
 assert.ok(screen.includes('TaskDetailsPage('));
 assert.ok(screen.includes('TaskEditorPage('));
 assert.ok(!screen.includes('TaskDialog('));
 assert.ok(screen.includes('BackHandler('));
});
test('acknowledged create stays bound to editor until exact readback', () => {
 assert.match(screen, /createSubmitted/);
 assert.match(screen, /savedTaskId/);
 assert.match(screen, /data\?\.tasks\?\.find \{it\.id==state\.savedTaskId\}/);
 assert.match(screen, /Created task is not available/);
 assert.match(screen, /onFinishCreateEditor/);
});
