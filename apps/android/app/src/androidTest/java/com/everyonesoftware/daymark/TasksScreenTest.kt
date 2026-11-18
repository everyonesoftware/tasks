package com.everyonesoftware.daymark
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
class TasksScreenTest {
 @get:Rule val compose = createComposeRule()
 private val date = java.time.LocalDate.now().toString()
 private fun fixture() = DayState(date, emptyList(), emptyList(), emptyList(), 0, 0)
 @Test fun emptyStateAndNavigation() {
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture(), true)), Actions()) } }
  compose.onNodeWithText("Nothing due today").assertIsDisplayed()
  compose.onNodeWithText("Upcoming").performClick()
  compose.onNodeWithText("No upcoming tasks").assertIsDisplayed()
  compose.onNodeWithText("Routines").performClick()
  compose.onNodeWithText("No tasks yet").assertIsDisplayed()
 }
 @Test fun currentTaskMenuDoesNotComplete() {
  var skipped = false; var completed = false
  val a = Occurrence("a@$date", "a", "Read a book", "", "Personal", "daily", 1, 0, date, false, false)
  val b = a.copy(occurrenceId="b@$date", taskId="b", title="Walk")
  val state = fixture().copy(today=listOf(a,b), total=2)
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(state, true)), Actions(onNotNow={ skipped=true }, onComplete={ completed=true })) } }
  compose.onNodeWithContentDescription("Current task options").performClick()
  compose.onNodeWithText("Not now").assertIsDisplayed().performClick()
  compose.runOnIdle { assertTrue(skipped); assertFalse(completed) }
 }
 @Test fun waitingRowOffersExplicitFocusAndCompletion() {
  val a = Occurrence("a@$date", "a", "Current", "", "Personal", "daily", 1, 0, date, false, false)
  val b = a.copy(occurrenceId="b@$date", taskId="b", title="Waiting")
  var picked: Occurrence? = null; var completed: Occurrence? = null
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture().copy(today=listOf(a,b), total=2), true)), Actions(onPick={picked=it}, onComplete={completed=it})) } }
  compose.onNodeWithText("Waiting").performScrollTo().performClick()
  compose.runOnIdle { assertNull(picked); assertNull(completed) }
  compose.onNodeWithText("Make current").assertIsDisplayed().performClick()
  compose.runOnIdle { assertEquals(b, picked) }
  compose.onNodeWithText("Waiting").performClick()
  compose.onNode(hasText("Mark done") and hasAnyAncestor(isPopup())).performClick()
  compose.runOnIdle { assertEquals(b, completed) }
 }
 @Test fun taskMenusReuseEditorAndRequireArchiveConfirmation() {
  val task = Task("a", "Read", "Keep notes", "Personal", "daily", 2, date, 1)
  val occurrence = Occurrence("a@$date", "a", task.title, task.notes, task.category, task.repeat, 2, 1, date, false, false)
  var archived: Task? = null; var saved: Task? = null; var draft: TaskDraft? = null
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture().copy(tasks=listOf(task), today=listOf(occurrence), total=1), true)), Actions(onArchive={t,done -> archived=t; done()}, onSave={t,d,done -> saved=t; draft=d; done()})) } }
  compose.onNodeWithContentDescription("Current task options").performClick()
  compose.onNodeWithText("Edit task").performClick()
  compose.onNodeWithText("Changes apply to the entire task schedule, not just this occurrence.").assertExists()
  compose.onNodeWithText("Task title").performTextReplacement("Read more")
  compose.onNodeWithText("Save task").performScrollTo().performClick()
  compose.runOnIdle { assertEquals(task, saved); assertEquals("Read more", draft?.title); assertEquals("Keep notes", draft?.notes) }
  compose.onNodeWithContentDescription("Current task options").performClick()
  compose.onNodeWithText("Archive task").performClick()
  compose.runOnIdle { assertNull(archived) }
  compose.onNodeWithText("Cancel").performClick()
  compose.runOnIdle { assertNull(archived) }
  compose.onNodeWithContentDescription("Current task options").performClick()
  compose.onNodeWithText("Archive task").performClick()
  compose.onNodeWithText("Archive", useUnmergedTree=true).performClick()
  compose.runOnIdle { assertEquals(task, archived) }
 }
 @Test fun completedDisclosureSurvivesRefreshAndResetsDateAndAccount() {
  val done = Occurrence("a@$date", "a", "Finished", "", "Personal", "daily", 1, 0, date, true, false)
  val state = androidx.compose.runtime.mutableStateOf(UiState(Snapshot(fixture().copy(today=listOf(done), completed=1, total=1), true), session=Session("https://example.test", "one", "fixture")))
  var undone: Occurrence? = null
  compose.setContent { TasksTheme { TasksScreen(state.value, Actions(onUndo={undone=it})) } }
  compose.onNodeWithText("Completed today (1)").performScrollTo().performClick()
  compose.onNodeWithText("Finished").assertDoesNotExist()
  compose.runOnIdle { state.value=state.value.copy(busy=true) }
  compose.runOnIdle { state.value=state.value.copy(busy=false) }
  compose.onNodeWithText("Completed today (1)").performScrollTo().performClick()
  compose.onNodeWithText("Finished").performScrollTo().performClick()
  compose.onNodeWithText("Make current").assertDoesNotExist()
  compose.onNode(hasText("Mark done") and hasAnyAncestor(isPopup())).assertDoesNotExist()
  compose.onNodeWithText("Undo completion").performClick()
  compose.runOnIdle { assertEquals(done, undone) }
  compose.onNodeWithText("Completed today (1)").performScrollTo().performClick()
  compose.runOnIdle { state.value=state.value.copy(session=Session("https://example.test", "two", "fixture2")) }
  compose.onNodeWithText("Finished").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Completed today (1)").performScrollTo().performClick()
  compose.runOnIdle { state.value=state.value.copy(snapshot=Snapshot(state.value.snapshot.data!!.copy(date=java.time.LocalDate.now().plusDays(1).toString()), true)) }
  compose.onNodeWithText("Finished").performScrollTo().assertIsDisplayed()
 }
 @Test fun everyListOffersTaskOptionsWithoutCompletingFutureOccurrences() {
  val task = Task("a", "Scheduled", "", "Personal", "daily", 1, date, 0)
  val today = Occurrence("a@$date", "a", task.title, "", "Personal", "daily", 1, 0, date, false, false)
  val other = today.copy(occurrenceId="b@$date", taskId="b", title="Current")
  val future = today.copy(occurrenceId="a@future", dueDate=java.time.LocalDate.now().plusDays(1).toString())
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture().copy(tasks=listOf(task), today=listOf(other,today), upcoming=listOf(future), total=2), true)), Actions()) } }
  compose.onNodeWithContentDescription("Options for Scheduled").performScrollTo().performClick()
  compose.onNodeWithText("Edit task").performClick()
  compose.onNodeWithText("Edit task").assertExists()
  compose.onNodeWithText("Cancel").performScrollTo().performClick()
  compose.onNodeWithText("Upcoming").performClick()
  compose.onNodeWithText("Scheduled").performScrollTo().performClick()
  compose.onNodeWithText("Make current").assertDoesNotExist()
  compose.onNode(hasText("Mark done") and hasAnyAncestor(isPopup())).assertDoesNotExist()
  compose.onNodeWithText("Edit task").assertIsDisplayed().performClick()
  compose.onNodeWithText("Cancel").performScrollTo().performClick()
  compose.onNodeWithContentDescription("Options for Scheduled").performScrollTo().performClick()
  compose.onNodeWithText("Archive task").performClick()
  compose.onNodeWithText("Archive task?").assertIsDisplayed()
  compose.onNodeWithText("Cancel").performClick()
  compose.onNodeWithText("Routines").performClick()
  compose.onNodeWithContentDescription("Options for Scheduled").performScrollTo().performClick()
  compose.onNodeWithText("Edit task").performClick()
  compose.onNodeWithText("Cancel").performScrollTo().performClick()
 }
 @Test fun currentTitleAlsoOffersOccurrenceActions() {
  val a = Occurrence("a@$date", "a", "Current", "", "Personal", "daily", 1, 0, date, false, false)
  var picked: Occurrence? = null
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture().copy(today=listOf(a), total=1), true)), Actions(onPick={picked=it})) } }
  compose.onNodeWithText("Current").performClick()
  compose.onNodeWithText("Make current").performClick()
  compose.runOnIdle { assertEquals(a, picked) }
 }
 @Test fun completedChoiceSurvivesSettingsNavigation() {
  val done = Occurrence("a@$date", "a", "Finished", "", "Personal", "daily", 1, 0, date, true, false)
  val state = androidx.compose.runtime.mutableStateOf(UiState(Snapshot(fixture().copy(today=listOf(done), completed=1, total=1), true), session=Session("https://example.test", "one", "fixture")))
  compose.setContent { TasksTheme { TasksApp(state.value, Actions()) } }
  compose.onNodeWithText("Completed today (1)").performScrollTo().performClick()
  compose.runOnIdle { state.value=state.value.copy(settings=true) }
  compose.runOnIdle { state.value=state.value.copy(settings=false) }
  compose.onNodeWithText("Completed today (1)").performScrollTo()
  compose.onNodeWithText("Finished").assertDoesNotExist()
 }
 @Test fun routineRowUsesTodayOccurrenceAndNeverFutureOne() {
  val task = Task("a", "Routine", "", "Personal", "daily", 1, date, 0)
  val occurrence = Occurrence("a@$date", "a", task.title, "", "Personal", "daily", 1, 0, date, true, false)
  var undone: Occurrence? = null
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture().copy(tasks=listOf(task), today=listOf(occurrence), total=1, completed=1), true)), Actions(onUndo={undone=it})) } }
  compose.onNodeWithText("Routines").performClick()
  compose.onNodeWithText("Routine").performClick()
  compose.onNodeWithText("Make current").assertDoesNotExist()
  compose.onNodeWithText("Undo completion").performClick()
  compose.runOnIdle { assertEquals(occurrence, undone) }
 }
 @Test fun editorKeepsDraftAcrossRefreshOfflineAndUnconfirmedSave() {
  val task = Task("a", "Original", "", "Personal", "daily", 1, date, 0)
  val occurrence = Occurrence("a@$date", "a", task.title, "", "Personal", "daily", 1, 0, date, false, false)
  val online = Snapshot(fixture().copy(tasks=listOf(task), today=listOf(occurrence), total=1), true)
  val state = androidx.compose.runtime.mutableStateOf(UiState(online))
  var saves=0
  compose.setContent { TasksTheme { TasksScreen(state.value, Actions(onSave={_,_,_ -> saves++})) } }
  compose.onNodeWithContentDescription("Current task options").performClick()
  compose.onNodeWithText("Edit task").performClick()
  compose.onNodeWithText("Task title").performTextReplacement("Unsaved draft")
  compose.runOnIdle { state.value=state.value.copy(busy=true) }
  compose.onNodeWithText("Save task").performScrollTo().assertIsNotEnabled()
  compose.runOnIdle { state.value=state.value.copy(busy=false, snapshot=Snapshot(error="Connection required")) }
  compose.onNodeWithText("Save task").assertIsNotEnabled()
  compose.onNodeWithText("Task title").assertTextContains("Unsaved draft")
  compose.runOnIdle { state.value=state.value.copy(snapshot=online) }
  compose.onNodeWithText("Save task").performScrollTo().performClick()
  compose.runOnIdle { assertEquals(1, saves) }
  compose.onNodeWithText("Edit task").assertExists()
  compose.onNodeWithText("Task title").assertTextContains("Unsaved draft")
 }
 @Test fun addDialogValidatesAndCancels() {
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture(), true)), Actions()) } }
  compose.onNodeWithText("Add task").performClick()
  compose.onNodeWithText("New task").assertIsDisplayed()
  compose.onNodeWithText("Save task").performScrollTo().performClick()
  compose.onNodeWithText("Enter a title of 1–200 characters.").assertExists()
  compose.onNodeWithText("Cancel").performClick()
  compose.onNodeWithText("New task").assertDoesNotExist()
 }
 @Test fun offlineCacheCannotMutate() {
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture(), false, "Connection failed")), Actions()) } }
  compose.onNodeWithText("Add task").assertIsNotEnabled()
  compose.onNodeWithText("Connection failed", substring=true).assertExists()
 }
 @Test fun settingsNavigationIsExplicit() {
  var opened=false
  compose.setContent { TasksTheme { TasksScreen(UiState(Snapshot(fixture(), true)), Actions(onSettings={opened=true})) } }
  compose.onAllNodesWithText("Settings")[0].performClick()
  compose.runOnIdle { assertTrue(opened) }
 }
}