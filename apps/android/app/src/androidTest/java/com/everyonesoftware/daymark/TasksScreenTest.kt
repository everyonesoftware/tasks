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