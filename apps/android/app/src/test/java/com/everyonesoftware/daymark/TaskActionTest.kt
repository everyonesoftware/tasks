package com.everyonesoftware.daymark

import org.junit.Assert.*
import org.junit.Test

class TaskActionTest {
 @Test fun idleRefreshKeepsEditorEnabledWhileMutationStillLocksFields() {
  assertFalse(UiState(busy=true,refreshing=true).editorBusy)
  assertTrue(UiState(busy=true).editorBusy)
  assertFalse(UiState().editorBusy)
 }
 @Test fun refreshedDetailsReplaceRemovedOccurrenceWithActualOriginsSchedule() {
  val data=parseState(RepositoryTest.FIXTURE);val old=data.today.single()
  val today=old.copy(occurrenceId="new-today",dueDate="2026-11-13",overdue=true)
  val future=old.copy(occurrenceId="new-upcoming",dueDate="2026-11-20")
  val refreshed=data.copy(today=listOf(today),upcoming=listOf(future))
  assertEquals(today,refreshed.detailsOccurrence(old.taskId,old.occurrenceId,"Today"))
  assertEquals(future,refreshed.detailsOccurrence(old.taskId,old.occurrenceId,"Upcoming"))
  assertEquals(today,refreshed.detailsOccurrence(old.taskId,null,"Routines"))
  assertEquals(future,refreshed.copy(today=emptyList()).detailsOccurrence(old.taskId,old.occurrenceId,"Today"))
  assertEquals(today,refreshed.copy(upcoming=emptyList()).detailsOccurrence(old.taskId,old.occurrenceId,"Upcoming"))
  assertNull(refreshed.detailsOccurrence("unrelated",old.occurrenceId,"Today"))
 }
 @Test fun detailsRetainStillValidSelectedOccurrence() {
  val data=parseState(RepositoryTest.FIXTURE);val selected=data.today.single()
  assertEquals(selected,data.detailsOccurrence(selected.taskId,selected.occurrenceId,"Today"))
 }
 @Test fun activationResolvesLatestSnapshotAndRejectsStaleFutureRemovedOrChangedStatus() {
  val data=parseState(RepositoryTest.FIXTURE)
  val item=data.today.single()
  val snapshot=Snapshot(data,true)
  assertEquals(item,snapshot.actionOccurrence(item,false,data.date))
  assertNull(snapshot.actionOccurrence(item,false,"2026-11-15"))
  assertNull(snapshot.actionOccurrence(item.copy(dueDate="2026-11-15"),false,data.date))
  assertNull(snapshot.copy(online=false).actionOccurrence(item,false,data.date))
  assertNull(snapshot.copy(data=data.copy(tasks=emptyList())).actionOccurrence(item,false,data.date))
  assertNull(snapshot.copy(data=data.copy(today=listOf(item.copy(completed=true)))).actionOccurrence(item,false,data.date))
  assertNull(snapshot.actionOccurrence(item,true,data.date))
  val latest=item.copy(title="Updated on server")
  assertEquals(latest,snapshot.copy(data=data.copy(today=listOf(latest))).actionOccurrence(item,false,data.date))
 }
}
