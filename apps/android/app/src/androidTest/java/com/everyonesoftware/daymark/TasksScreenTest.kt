package com.everyonesoftware.daymark

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate

class TasksScreenTest {
 @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()
 private val date=LocalDate.now().toString()
 private fun task(id: String="a",title: String="Read")=Task(id,title,"Hidden legacy notes","Private category","monthly",3,"2026-01-31",2,"2026-01-01T10:00:00Z")
 private fun occurrence(task: Task=task(),done: Boolean=false,due: String=date)=Occurrence("${task.id}@$due",task.id,task.title,task.notes,task.category,task.repeat,task.interval,task.priority,due,done,due<date,if(done) "${date}T12:00:00Z" else null)
 private fun fixture(tasks: List<Task> = emptyList(),today: List<Occurrence> = emptyList(),upcoming: List<Occurrence> = emptyList())=DayState(date,tasks,today,upcoming,today.count {it.completed},today.size)
 private fun ui(data: DayState)=UiState(Snapshot(data,true),session=Session("https://example.test","one","fixture"))
 private fun openEdit() {compose.onNodeWithContentDescription("Edit task").performClick()}
 private fun back() {compose.runOnIdle {compose.activity.onBackPressedDispatcher.onBackPressed()}}
 private fun noLegacyFields() {
  listOf("Category","Priority","Description","Notes","Hidden legacy notes","Private category","Next due date").forEach {compose.onNodeWithText(it,substring=true).assertDoesNotExist()}
 }
 @Test fun emptyStateAndNavigation() {
  compose.setContent {TasksTheme {TasksScreen(ui(fixture()),Actions())}}
  compose.onNodeWithText("Nothing due today").assertExists()
  compose.onNodeWithText("Upcoming").performClick()
  compose.onNodeWithText("No upcoming tasks").assertExists()
  compose.onNodeWithText("Routines").performClick()
  compose.onNodeWithText("No tasks yet").assertExists()
 }
 @Test fun singleCurrentTitleOpensDedicatedDetailsWithoutChangingFocus() {
  val task=task();var picked=false;var completed=false
  compose.setContent {TasksTheme {TasksScreen(ui(fixture(listOf(task),listOf(occurrence(task)))),Actions(onPick={picked=true},onComplete={completed=true}))}}
  noLegacyFields()
  compose.onNodeWithText(task.title).performScrollTo().performClick()
  compose.onNodeWithText("Task details").assertIsDisplayed()
  compose.onNodeWithText("One thing at a time.").assertDoesNotExist()
  compose.onNodeWithText("Starts 2026-01-31").assertExists()
  compose.onNodeWithText("Every 3 months").assertExists()
  noLegacyFields()
  compose.runOnIdle {assertFalse(picked);assertFalse(completed)}
  back()
  compose.onNodeWithText("One thing at a time.").assertExists()
 }
 @Test fun queueDetailsRequireExplicitFocusAndCompletion() {
  val a=task();val b=task("b","Walk");val item=occurrence(b)
  var picked: Occurrence?=null;var completed: Occurrence?=null
  compose.setContent {TasksTheme {TasksScreen(ui(fixture(listOf(a,b),listOf(occurrence(a),item))),Actions(onPick={picked=it},onComplete={completed=it}))}}
  compose.onNodeWithText("Walk").performScrollTo().performClick()
  compose.onNodeWithText("Task details").assertExists()
  compose.runOnIdle {assertNull(picked);assertNull(completed)}
  compose.onNodeWithText("Make current").performScrollTo().performClick()
  compose.runOnIdle {assertEquals(item,picked)}
  compose.onNodeWithText("Mark done").performScrollTo().performClick()
  compose.runOnIdle {assertEquals(item,completed)}
 }
 @Test fun editCancelReturnsUnchangedDetailsThenOriginWithHardwareBack() {
  val task=task();var saves=0
  compose.setContent {TasksTheme {TasksScreen(ui(fixture(listOf(task),listOf(occurrence(task)))),Actions(onSave={_,_,_ -> saves++}))}}
  compose.onNodeWithText("Routines").performClick()
  compose.onNodeWithText(task.title).performScrollTo().performClick()
  openEdit()
  noLegacyFields()
  compose.onNodeWithText("Task name").performTextReplacement("Discard me")
  compose.onNodeWithText("Cancel").performScrollTo().performClick()
  compose.onNodeWithText("Task details").assertExists()
  compose.onNodeWithText(task.title).assertExists()
  openEdit()
  compose.onNodeWithText("Task name").assertTextContains(task.title)
  compose.onNodeWithText("Task name").performTextReplacement("Discard again")
  back()
  compose.onNodeWithText("Task details").assertExists()
  back()
  compose.onNodeWithText("Your routines.").assertExists()
  compose.runOnIdle {assertEquals(0,saves)}
 }
 @Test fun confirmedSaveReturnsToRefreshedDetailsPreservingHiddenFieldsAndAnchor() {
  val task=task();val state=mutableStateOf(ui(fixture(listOf(task),listOf(occurrence(task)))))
  var saved: TaskDraft?=null
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onSave={original,draft,done ->
   assertEquals(task,original);saved=draft
   val updated=task.copy(title=draft.title)
   state.value=ui(fixture(listOf(updated),listOf(occurrence(updated))))
   done()
  }))}}
  compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  compose.onNodeWithText("Task name").performTextReplacement("Read more")
  compose.onNodeWithText("Save changes").performScrollTo().performClick()
  compose.onNodeWithText("Task details").assertExists()
  compose.onNodeWithText("Read more").assertExists()
  compose.onNodeWithText("Task name").assertDoesNotExist()
  compose.runOnIdle {assertEquals(task.notes,saved?.notes);assertEquals(task.category,saved?.category);assertEquals(2,saved?.priority);assertEquals("2026-01-31",saved?.startDate);assertEquals("3",saved?.interval)}
 }
 @Test fun scheduleSaveReresolvesTodayOccurrenceAndKeepsActions() {
  val task=task();val old=occurrence(task,due=LocalDate.now().minusDays(2).toString())
  val state=mutableStateOf(ui(fixture(listOf(task),listOf(old))));var completed: Occurrence?=null
  val changed=task.copy(startDate=date);val replacement=occurrence(changed)
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onComplete={completed=it},onSave={_,_,done ->
   state.value=ui(fixture(listOf(changed),listOf(replacement)));done()
  }))}}
  compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  compose.onNodeWithText("Start date (YYYY-MM-DD)").performTextReplacement(date)
  compose.onNodeWithText("Save changes").performScrollTo().performClick()
  compose.onNodeWithText("Task details").assertExists()
  compose.onNodeWithText("Due $date").assertExists()
  compose.onNodeWithText("Overdue ${old.dueDate}").assertDoesNotExist()
  compose.onNodeWithText("Mark done").performScrollTo().performClick()
  compose.runOnIdle {assertEquals(replacement,completed)}
 }
 @Test fun scheduleSaveFromUpcomingResolvesUpcomingRatherThanTodaysHistory() {
  val task=task();val old=occurrence(task,due=LocalDate.now().plusDays(1).toString())
  val state=mutableStateOf(ui(fixture(listOf(task),listOf(occurrence(task,true)),listOf(old))))
  val newDate=LocalDate.now().plusDays(3).toString();val changed=task.copy(startDate=newDate)
  val future=occurrence(changed,due=newDate)
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onSave={_,_,done ->
   state.value=ui(fixture(listOf(changed),listOf(occurrence(task,true)),listOf(future)));done()
  }))}}
  compose.onNodeWithText("Upcoming").performClick();compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  compose.onNodeWithText("Start date (YYYY-MM-DD)").performTextReplacement(future.dueDate)
  compose.onNodeWithText("Save changes").performScrollTo().performClick()
  compose.onNodeWithText("Due ${future.dueDate}").assertExists()
  compose.onNodeWithText("Undo completion").assertDoesNotExist()
  compose.onNodeWithText("Mark done").assertDoesNotExist()
  back();compose.onNodeWithText("Not for today.").assertExists()
 }
 @Test fun upcomingDetailsCannotCompleteEarlyAndReturnToUpcoming() {
  val task=task();val future=occurrence(task,due=LocalDate.now().plusDays(2).toString())
  compose.setContent {TasksTheme {TasksScreen(ui(fixture(listOf(task),listOf(occurrence(task)),listOf(future))),Actions())}}
  compose.onNodeWithText("Upcoming").performClick()
  compose.onNodeWithText(task.title).performScrollTo().performClick()
  compose.onNodeWithText("Due ${future.dueDate}").assertExists()
  compose.onNodeWithText("Make current").assertDoesNotExist()
  compose.onNodeWithText("Mark done").assertDoesNotExist()
  openEdit();compose.onNodeWithText("Cancel").performScrollTo().performClick()
  back()
  compose.onNodeWithText("Not for today.").assertExists()
 }
 @Test fun completedRowsOpenDetailsWithRealHistoryAndUndoOnly() {
  val task=task();val item=occurrence(task,true);var undone: Occurrence?=null
  compose.setContent {TasksTheme {TasksScreen(ui(fixture(listOf(task),listOf(item))),Actions(onUndo={undone=it}))}}
  compose.onNodeWithText(task.title).performScrollTo().performClick()
  compose.onNodeWithText("Task details").assertExists()
  compose.onNodeWithText("Completed ${date}T12:00:00Z").assertExists()
  compose.onNodeWithText("Make current").assertDoesNotExist()
  compose.onNodeWithText("Mark done").assertDoesNotExist()
  compose.onNodeWithText("Undo completion").performScrollTo().performClick()
  compose.runOnIdle {assertEquals(item,undone)}
 }
 @Test fun routinesResolveTodaysCompletedOccurrenceRatherThanFuture() {
  val task=task();val item=occurrence(task,true);var undone: Occurrence?=null
  compose.setContent {TasksTheme {TasksScreen(ui(fixture(listOf(task),listOf(item),listOf(occurrence(task,due=LocalDate.now().plusDays(1).toString())))),Actions(onUndo={undone=it}))}}
  compose.onNodeWithText("Routines").performClick();compose.onNodeWithText(task.title).performScrollTo().performClick()
  compose.onNodeWithText("Undo completion").performScrollTo().performClick()
  compose.runOnIdle {assertEquals(item,undone)}
 }
 @Test fun archiveRequiresHistoryRetentionConfirmationAndReturnsToOrigin() {
  val task=task();var archived: Task?=null
  compose.setContent {TasksTheme {TasksScreen(ui(fixture(listOf(task),listOf(occurrence(task)))),Actions(onArchive={value,done ->archived=value;done()}))}}
  compose.onNodeWithText(task.title).performScrollTo().performClick()
  compose.onNodeWithText("Archive task").performScrollTo().performClick()
  compose.onNodeWithText("Completion history is retained.",substring=true).assertExists()
  compose.runOnIdle {assertNull(archived)}
  compose.onNodeWithText("Cancel").performClick()
  compose.onNodeWithText("Task details").assertExists()
  compose.onNodeWithText("Archive task").performScrollTo().performClick()
  compose.onNodeWithText("Archive",useUnmergedTree=true).performClick()
  compose.runOnIdle {assertEquals(task,archived)}
  compose.onNodeWithText("One thing at a time.").assertExists()
 }
 @Test fun idleEditorSurvivesRefreshOfflineAndFailedSaveWithSubmissionLockout() {
  val task=task();val online=ui(fixture(listOf(task),listOf(occurrence(task))));val state=mutableStateOf(online);var saves=0
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onSave={_,_,_ ->saves++;state.value=state.value.copy(snapshot=Snapshot(error="Write not confirmed"))}))}}
  compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  compose.onNodeWithText("Task name").performTextReplacement("Unsaved draft")
  compose.runOnIdle {state.value=state.value.copy(busy=true)}
  compose.onNodeWithText("Save changes").performScrollTo().assertIsNotEnabled()
  compose.runOnIdle {state.value=online.copy(snapshot=Snapshot(error="Connection required"))}
  compose.onNodeWithText("Save changes").assertIsNotEnabled()
  compose.onNodeWithText("Task name").assertTextContains("Unsaved draft")
  compose.runOnIdle {state.value=online}
  compose.onNodeWithText("Save changes").performScrollTo().performClick()
  compose.onNodeWithText("Edit task").assertExists()
  compose.onNodeWithText("Save changes").assertIsNotEnabled()
  compose.onNodeWithText("Task name").assertTextContains("Unsaved draft")
  compose.runOnIdle {assertEquals(1,saves)}
 }
 @Test fun focusedEditorKeepsFocusAndDraftThroughIdleRefreshButCannotWrite() {
  val task=task();val online=ui(fixture(listOf(task),listOf(occurrence(task))));val state=mutableStateOf(online);var saves=0
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onSave={_,_,_ ->saves++}))}}
  compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  compose.onNodeWithText("Task name").performClick().performTextReplacement("Typing")
  compose.onNodeWithText("Task name").assertIsFocused()
  compose.runOnIdle {state.value=online.copy(busy=true,refreshing=true)}
  compose.onNodeWithText("Task name").assertIsEnabled().assertIsFocused().performTextInput(" during refresh")
  compose.onNodeWithText("Save changes").assertIsNotEnabled()
  compose.runOnIdle {state.value=online}
  compose.onNodeWithText("Task name").assertIsFocused().assertTextContains("Typing during refresh")
  compose.runOnIdle {assertEquals(0,saves);state.value=online.copy(busy=true)}
  compose.onNodeWithText("Task name").assertIsNotEnabled()
 }
 @Test fun accountTransitionClearsDraftAndDetailNavigation() {
  val task=task();val data=fixture(listOf(task),listOf(occurrence(task)));val state=mutableStateOf(ui(data))
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions())}}
  compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  compose.onNodeWithText("Task name").performTextReplacement("Other account secret")
  compose.runOnIdle {state.value=ui(data).copy(session=Session("https://example.test","two","other"))}
  compose.onNodeWithText("Task name").assertDoesNotExist()
  compose.onNodeWithText("One thing at a time.").assertExists()
  compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  compose.onNodeWithText("Task name").assertTextContains(task.title)
 }
 @Test fun signOutDestroysEditorAndReLoginDoesNotRestoreDraft() {
  val task=task();val signedIn=ui(fixture(listOf(task),listOf(occurrence(task))));val state=mutableStateOf(signedIn)
  compose.setContent {TasksTheme {TasksApp(state.value,Actions())}}
  compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  compose.onNodeWithText("Task name").performTextReplacement("Forget me")
  compose.runOnIdle {state.value=UiState()}
  compose.onNodeWithText("Connect your server.").assertExists()
  compose.runOnIdle {state.value=signedIn}
  compose.onNodeWithText("Task details").assertDoesNotExist()
 }
 @Test fun addUsesSimplifiedPageValidatesAndSavesToNewDetails() {
  val state=mutableStateOf(ui(fixture()));var saved: TaskDraft?=null
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onSave={original,draft,done ->
   assertNull(original);saved=draft
   val created=task("new",draft.title).copy(notes=draft.notes,category=draft.category,priority=draft.priority,repeat=draft.repeat,interval=draft.interval.toInt(),startDate=draft.startDate)
   state.value=ui(fixture(listOf(created),listOf(occurrence(created)))).copy(savedTaskId=created.id)
   done()
  }))}}
  compose.onNodeWithText("Add task").performClick()
  compose.onNodeWithText("New task").assertExists();noLegacyFields()
  compose.onNodeWithText("Add task").performScrollTo().performClick()
  compose.onNodeWithText("Enter a title of 1–200 characters.").assertExists()
  compose.onNodeWithText("Cancel").performScrollTo().performClick()
  compose.onNodeWithText("Nothing due today").assertExists()
  compose.onNodeWithText("Add task").performScrollTo().performClick()
  compose.onNodeWithText("Task name").performTextReplacement("A new task")
  compose.onNodeWithText("Add task").performScrollTo().performClick()
  compose.onNodeWithText("Task details").assertExists()
  compose.onNodeWithText("A new task").assertExists()
  compose.runOnIdle {assertEquals("",saved?.notes);assertEquals("Personal",saved?.category);assertEquals(0,saved?.priority)}
 }
 @Test fun oneTimeSelectionAfterInvalidRecurringIntervalSavesNormalizedPayloadAndReopens() {
  val task=task();val state=mutableStateOf(ui(fixture(listOf(task),listOf(occurrence(task)))))
  var payload: TaskDraft?=null
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onSave={_,draft,done ->
   payload=draft
   val updated=task.copy(repeat=draft.repeat,interval=draft.json().getInt("interval"))
   state.value=ui(fixture(listOf(updated),listOf(occurrence(updated))));done()
  }))}}
  compose.onNodeWithText(task.title).performScrollTo().performClick();openEdit()
  for(invalid in listOf("", "0")) {
   compose.onNodeWithText("Repeat interval (1–365)").performTextReplacement(invalid)
   compose.onNodeWithText("Every month").performClick();compose.onNodeWithText("One time").performClick()
   compose.onNodeWithText("Repeat interval (1–365)").assertDoesNotExist()
   compose.onNodeWithText("Save changes").performScrollTo().performClick()
   compose.onNodeWithText("Task details").assertExists()
   compose.runOnIdle {assertEquals("1",payload?.interval);assertEquals(1,payload?.json()?.getInt("interval"))}
   openEdit();compose.onNodeWithText("One time").performClick();compose.onNodeWithText("Every month").performClick()
  }
 }
 @Test fun acknowledgedCreateFailureLocksDraftAndReconnectOpensOnlyExactIdentity() {
  val initial=ui(fixture());val state=mutableStateOf(initial);var saves=0
  val other=task("other","Unrelated");val exact=task("exact","Acknowledged")
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onSave={_,_,_ ->
   saves++;state.value=initial.copy(snapshot=Snapshot(error="Readback failed"),savedTaskId=exact.id)
  }))}}
  compose.onNodeWithText("Add task").performClick()
  compose.onNodeWithText("Task name").performTextReplacement(exact.title)
  compose.onNodeWithText("Add task").performScrollTo().performClick()
  compose.onNodeWithText("Add task").assertIsNotEnabled()
  compose.runOnIdle {state.value=ui(fixture(listOf(other),listOf(occurrence(other)))).copy(savedTaskId=exact.id)}
  compose.onNodeWithText("Created task is not available. Retry refresh or return to the list.").assertExists()
  compose.onNodeWithText("Add task").assertIsNotEnabled()
  compose.onNodeWithText("Task details").assertDoesNotExist()
  compose.runOnIdle {state.value=ui(fixture(listOf(other,exact),listOf(occurrence(other),occurrence(exact)))).copy(savedTaskId=exact.id)}
  compose.onNodeWithText("Task details").assertExists()
  compose.onNodeWithText(exact.title).assertExists()
  compose.onNodeWithText(other.title).assertDoesNotExist()
  compose.runOnIdle {assertEquals(1,saves)}
 }
 @Test fun pendingCreateCanReturnToListAndStartIndependentDraft() {
  val initial=ui(fixture());val state=mutableStateOf(initial);var saves=0
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onFinishCreateEditor={state.value=state.value.copy(savedTaskId=null)},onSave={_,_,_ ->
   saves++;state.value=initial.copy(savedTaskId="missing")
  }))}}
  compose.onNodeWithText("Add task").performClick();compose.onNodeWithText("Task name").performTextReplacement("First")
  compose.onNodeWithText("Add task").performScrollTo().performClick()
  compose.onNodeWithText("Cancel").performScrollTo().performClick()
  compose.onNodeWithText("Add task").performClick();compose.onNodeWithText("Task name").performTextReplacement("Second")
  compose.onNodeWithText("Add task").performScrollTo().assertIsEnabled().performClick()
  compose.runOnIdle {assertEquals(2,saves)}
 }
 @Test fun accountSwitchCannotReconcilePreviousAccountsPendingCreate() {
  val initial=ui(fixture());val state=mutableStateOf(initial)
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions(onSave={_,_,_ ->state.value=initial.copy(snapshot=Snapshot(error="Readback failed"),savedTaskId="same-id")}))}}
  compose.onNodeWithText("Add task").performClick();compose.onNodeWithText("Task name").performTextReplacement("First account draft")
  compose.onNodeWithText("Add task").performScrollTo().performClick()
  val other=task("same-id","Other account task")
  compose.runOnIdle {state.value=ui(fixture(listOf(other),listOf(occurrence(other)))).copy(session=Session("https://example.test","two","other"),savedTaskId="same-id")}
  compose.onNodeWithText("Task details").assertDoesNotExist()
  compose.onNodeWithText("Task name").assertDoesNotExist()
  compose.onNodeWithText("One thing at a time.").assertExists()
  compose.onNodeWithText("Add task").performScrollTo().performClick()
  compose.onNodeWithText("First account draft").assertDoesNotExist()
  compose.onNodeWithText("Add task").assertIsEnabled()
 }
 @Test fun completedDisclosureSurvivesRefreshDetailsAndSettingsAndResetsDate() {
  val task=task();val data=fixture(listOf(task),listOf(occurrence(task,true)));val state=mutableStateOf(ui(data))
  compose.setContent {TasksTheme {TasksApp(state.value,Actions())}}
  compose.onNodeWithText("Completed today (1)").performScrollTo().performClick()
  compose.runOnIdle {state.value=state.value.copy(busy=true)}
  compose.runOnIdle {state.value=state.value.copy(busy=false,settings=true)}
  compose.runOnIdle {state.value=state.value.copy(settings=false)}
  compose.onNodeWithText("Completed today (1)").performScrollTo()
  compose.onNodeWithText(task.title).assertDoesNotExist()
  compose.onNodeWithText("Routines").performClick();compose.onNodeWithText(task.title).performScrollTo().performClick();back()
  compose.onNodeWithText("Today").performClick()
  compose.onNodeWithText("Completed today (1)").performScrollTo()
  compose.onNodeWithText(task.title).assertDoesNotExist()
  compose.runOnIdle {state.value=state.value.copy(snapshot=Snapshot(data.copy(date=LocalDate.now().plusDays(1).toString()),true))}
  compose.onNodeWithText(task.title).performScrollTo().assertExists()
 }
 @Test fun notNowRemainsInCurrentMenuAndDoesNotComplete() {
  val a=task();val b=task("b","Walk");var skipped=false;var completed=false
  compose.setContent {TasksTheme {TasksScreen(ui(fixture(listOf(a,b),listOf(occurrence(a),occurrence(b)))),Actions(onNotNow={skipped=true},onComplete={completed=true}))}}
  compose.onNodeWithContentDescription("Current task options").performScrollTo().performClick()
  compose.onNodeWithText("Not now").performClick()
  compose.runOnIdle {assertTrue(skipped);assertFalse(completed)}
 }
 @Test fun staleSnapshotAndOfflineListsCannotSubmitMutations() {
  val task=task();val data=fixture(listOf(task),listOf(occurrence(task))).copy(date=LocalDate.now().minusDays(1).toString())
  val state=mutableStateOf(ui(data))
  compose.setContent {TasksTheme {TasksScreen(state.value,Actions())}}
  compose.onNodeWithText("Add task").assertIsNotEnabled()
  compose.onNodeWithText(task.title).performScrollTo().performClick()
  compose.onNodeWithContentDescription("Edit task").assertIsNotEnabled()
  compose.onNodeWithText("Archive task").performScrollTo().assertIsNotEnabled()
  compose.runOnIdle {state.value=state.value.copy(snapshot=Snapshot(error="Connection failed"))}
  compose.onNodeWithText(task.title).assertDoesNotExist()
  back()
  compose.onNodeWithText("Add task").assertIsNotEnabled()
 }
}
