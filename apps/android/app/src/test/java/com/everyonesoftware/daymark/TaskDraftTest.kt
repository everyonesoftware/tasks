package com.everyonesoftware.daymark
import org.junit.Assert.*
import org.junit.Test
class TaskDraftTest {
 @Test fun simplifiedEditPreservesLatestHiddenValuesWithoutChangingScheduleAnchor() {
  val task=Task("a","Original","  Existing notes\n","Work","monthly",3,"2026-01-31",2)
  val draft=TaskDraft(title="Changed",repeat="monthly",interval="3",startDate="2026-01-31")
  val body=draft.preservingHidden(task).json()
  assertEquals(task.notes,body.getString("notes"))
  assertEquals(task.category,body.getString("category"))
  assertEquals(task.priority,body.getInt("priority"))
  assertEquals("Changed",body.getString("title"))
  assertEquals("2026-01-31",body.getString("startDate"))
  assertEquals(3,body.getInt("interval"))
  assertEquals(TaskDraft(),TaskDraft().preservingHidden(null))
 }
 @Test fun oneTimeNormalizesHiddenInvalidIntervalButRecurringStillRejectsIt() {
  for(interval in listOf("", "0")) {
   val recurring=TaskDraft(title="Roundtrip",repeat="monthly",interval=interval)
   assertNotNull(recurring.error())
   val once=recurring.copy(repeat="once")
   assertNull(once.error())
   assertEquals(1,once.json().getInt("interval"))
  }
 }
 @Test fun fullEditableReplacementMatchesContract() {
  val draft = TaskDraft(title="  Read  ", notes="Notes", category="Home", repeat="yearly", interval="3", startDate="2028-02-29", priority=2)
  assertNull(draft.error())
  val body = draft.json()
  assertEquals("Read", body.getString("title"))
  assertEquals(3, body.getInt("interval"))
  assertEquals("2028-02-29", body.getString("startDate"))
  assertEquals(2, body.getInt("priority"))
  assertEquals(setOf("title", "notes", "category", "repeat", "interval", "startDate", "priority"), body.keys().asSequence().toSet())
 }
 @Test fun rejectsInvalidCalendarDateAndLimits() {
  for (draft in listOf(TaskDraft(title=""), TaskDraft(title="A", startDate="2026-02-30"), TaskDraft(title="A", repeat="daily", interval="0"), TaskDraft(title="A", repeat="daily", interval="366"), TaskDraft(title="x".repeat(201)), TaskDraft(title="A", notes="x".repeat(2001)), TaskDraft(title="A", category="x".repeat(61)), TaskDraft(title="A", repeat="hourly"))) assertNotNull(draft.error())
 }
}
