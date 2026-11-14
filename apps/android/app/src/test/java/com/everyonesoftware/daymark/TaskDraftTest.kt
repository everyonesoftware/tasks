package com.everyonesoftware.daymark
import org.junit.Assert.*
import org.junit.Test
class TaskDraftTest {
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
  for (draft in listOf(TaskDraft(title=""), TaskDraft(title="A", startDate="2026-02-30"), TaskDraft(title="A", interval="0"), TaskDraft(title="A", interval="366"), TaskDraft(title="x".repeat(201)), TaskDraft(title="A", notes="x".repeat(2001)), TaskDraft(title="A", category="x".repeat(61)), TaskDraft(title="A", repeat="hourly"))) assertNotNull(draft.error())
 }
}
