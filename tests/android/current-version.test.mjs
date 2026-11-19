import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const settings = readFileSync(new URL('../../apps/android/app/src/main/java/com/everyonesoftware/daymark/SettingsScreen.kt', import.meta.url), 'utf8');
const panel = settings.slice(settings.indexOf('    val u=state.update'), settings.indexOf(' if(review)'));
test('native Settings uses installed name at left and explicit check at right without changing connection or auto-check policy', () => {
 assert.ok(settings.includes('Text("Current Version: ${state.installedName}"'), 'actual installed name heading');
 assert.match(settings, /Row\(Modifier\.fillMaxWidth\(\).*verticalAlignment=Alignment\.CenterVertically/);
 assert.match(settings, /Text\("Current Version:.*Modifier\.weight\(1f\)/);
 assert.match(settings, /OutlinedButton\(onClick=actions\.onCheckUpdates/);
 assert.ok(settings.includes('else "Check now"'));
 for (const removed of ['"App updates"', '"Installed version"', '"Check at app launch"', '"Release source:', '"Downloads and installation always']) assert.ok(!panel.includes(removed), removed);
 assert.ok(!panel.includes('Switch('));
 const controller=readFileSync(new URL('../../apps/android/app/src/main/java/com/everyonesoftware/daymark/MainActivity.kt', import.meta.url), 'utf8');
 assert.ok(controller.includes('autoCheck=records.entries()["autoCheck"]!="false"'));
 assert.ok(controller.includes('if(mutable.value.autoCheck) checkUpdates()'));
});
test('current state is a compact slate matched card with exact Android copy, not a generic success or initial state', () => {
 assert.match(panel, /Surface\([\s\S]*testTag\("updates-status"\)/);
 assert.ok(panel.includes('color=Color(0xFF2B393F)'));
 assert.ok(panel.includes('BorderStroke(1.dp,Color(0xFF3B4B50))'));
 assert.ok(panel.includes('liveRegion = LiveRegionMode.Polite'));
 assert.ok(panel.includes('UpdateStatus.CURRENT -> "Up to date"'));
 assert.match(panel, /UpdateStatus\.CURRENT -> MaterialTheme\.colorScheme\.primary/, 'confirmed-current title uses the approved mint accent');
 assert.ok(panel.includes('UpdateStatus.CURRENT -> "No newer Android version is available."'));
 assert.ok(panel.includes('UpdateStatus.IDLE -> "Check for updates"'));
 assert.ok(panel.includes('UpdateStatus.CHECKING -> "Checking for updates"'));
 assert.ok(panel.includes('UpdateStatus.NO_RELEASES -> "No published releases yet."'));
 assert.ok(!panel.includes('Build '));
 assert.ok(panel.includes('Review update'));
});
test('shared failure state does not mislabel download verification or installation as a check failure', () => {
 assert.ok(panel.includes('UpdateStatus.FAILED -> "Update failed"'), 'shared FAILED status needs an operation-neutral heading');
 assert.ok(panel.includes('UpdateStatus.FAILED -> u.error ?:'));
 assert.ok(!panel.includes('Couldn’t check for updates'));
});
