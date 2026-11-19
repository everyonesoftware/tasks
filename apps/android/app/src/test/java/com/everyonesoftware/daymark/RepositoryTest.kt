package com.everyonesoftware.daymark
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
class RepositoryTest {
 @Test fun createdDetailsUseReturnedIdentityNotAnUnrelatedNewTask() = runBlocking {
  val server=MockWebServer();server.start()
  try {
   val repo=TasksRepository(server.url("/").toString(),MemoryStore())
   server.enqueue(MockResponse().setBody(FIXTURE));repo.refresh("2026-11-14")
   server.enqueue(MockResponse().setResponseCode(201).setBody("{\"id\":\"created-id\"}"))
   server.enqueue(MockResponse().setBody(FIXTURE))
   assertFalse(repo.write("POST","/api/tasks",TaskDraft(title="Created").json(),"2026-11-14"))
   assertEquals("created-id",repo.savedTaskId)
  } finally {server.shutdown()}
 }
 @Test fun acknowledgedCreateSurvivesFailedReadbackAndReconnectWithoutDuplicatePost() = runBlocking {
  val server=MockWebServer();server.start()
  try {
   val store=MemoryStore();val repo=TasksRepository(server.url("/").toString(),store)
   server.enqueue(MockResponse().setBody(FIXTURE));repo.refresh("2026-11-14")
   server.enqueue(MockResponse().setResponseCode(201).setBody("{\"id\":\"exact-id\"}"))
   server.enqueue(MockResponse().setResponseCode(503))
   assertFalse(repo.write("POST","/api/tasks",TaskDraft(title="Created").json(),"2026-11-14"))
   assertEquals("exact-id",repo.savedTaskId)
   assertFalse(repo.snapshot.online)
   server.enqueue(MockResponse().setBody(FIXTURE));repo.refresh("2026-11-14")
   val count=server.requestCount
   server.enqueue(MockResponse().setResponseCode(500))
   assertFalse(repo.write("POST","/api/tasks",TaskDraft(title="Created").json(),"2026-11-14"))
   assertEquals(count,server.requestCount)
   assertEquals("exact-id",repo.savedTaskId)
   assertNull(TasksRepository(server.url("/").toString(),store).savedTaskId)
  } finally {server.shutdown()}
 }
 @Test fun endingCreateEditorAllowsAnIndependentNewDraft() = runBlocking {
  val server=MockWebServer();server.start()
  try {
   val repo=TasksRepository(server.url("/").toString(),MemoryStore())
   server.enqueue(MockResponse().setBody(FIXTURE));repo.refresh("2026-11-14")
   server.enqueue(MockResponse().setResponseCode(201).setBody("{\"id\":\"first\"}"));server.enqueue(MockResponse().setBody(FIXTURE.replace("\"a\"","\"first\"")))
   assertTrue(repo.write("POST","/api/tasks",TaskDraft(title="First").json(),"2026-11-14"))
   repo.finishCreateEditor()
   server.enqueue(MockResponse().setResponseCode(201).setBody("{\"id\":\"second\"}"));server.enqueue(MockResponse().setBody(FIXTURE.replace("\"a\"","\"second\"")))
   assertTrue(repo.write("POST","/api/tasks",TaskDraft(title="Second").json(),"2026-11-14"))
   assertEquals("second",repo.savedTaskId)
  } finally {server.shutdown()}
 }
 @Test fun removedTasksCannotBeEditedOrArchivedFromCapturedDetails() = runBlocking {
  for(method in listOf("PUT","DELETE")) {
   val server=MockWebServer();server.start()
   try {
    val repo=TasksRepository(server.url("/").toString(),MemoryStore())
    server.enqueue(MockResponse().setBody(FIXTURE));repo.refresh("2026-11-14");server.takeRequest()
    server.enqueue(MockResponse().setResponseCode(500))
    assertFalse(repo.write(method,"/api/tasks/removed",if(method=="PUT") TaskDraft(title="Changed").json() else null,"2026-11-14"))
    assertEquals(1,server.requestCount)
    assertTrue(repo.snapshot.online)
   } finally {server.shutdown()}
  }
 }
 @Test fun occurrenceWritesRejectFutureMissingAndChangedCompletionBeforeTransport() = runBlocking {
   val cases=listOf(
    Triple(FIXTURE,"complete","2026-11-15"),
    Triple(FIXTURE.replace("\"completed\":false","\"completed\":true"),"complete","2026-11-14"),
    Triple(FIXTURE,"undo","2026-11-14"),
    Triple(FIXTURE.replace("\"taskId\":\"a\"","\"taskId\":\"removed\""),"complete","2026-11-14")
   )
   for((fixture,action,due) in cases) {
    val server=MockWebServer();server.start()
    try {
    val repo=TasksRepository(server.url("/").toString(),MemoryStore())
    server.enqueue(MockResponse().setBody(fixture));repo.refresh("2026-11-14");server.takeRequest()
    val count=server.requestCount
    server.enqueue(MockResponse().setResponseCode(500))
    val body=org.json.JSONObject().put("taskId","a").put("dueDate",due).put("date","2026-11-14")
    assertFalse(repo.write("POST","/api/occurrences/$action",body,"2026-11-14"))
    assertEquals("Rejected action must not reach HTTP: $action $due",count,server.requestCount)
    // A rejected action must leave the loaded state usable.
    assertTrue(repo.snapshot.online)
    } finally {server.shutdown()}
   }
 }
 @Test fun readsFlattenedOccurrencesAndClientDate() = runBlocking {
  val server = MockWebServer(); server.start()
  try {
   server.enqueue(MockResponse().setBody(FIXTURE))
   val repo = TasksRepository(server.url("/").toString(), MemoryStore())
   repo.refresh("2026-11-14")
   assertEquals("Read", repo.snapshot.data?.today?.single()?.title)
   assertEquals("a@2026-11-14", repo.snapshot.data?.today?.single()?.occurrenceId)
   assertEquals(2, repo.snapshot.data?.tasks?.single()?.priority)
   assertTrue(repo.snapshot.online)
   assertEquals("/api/state?date=2026-11-14", server.takeRequest().path)
  } finally { server.shutdown() }
 }
 @Test fun failedRefreshClearsTasksAndNeverPersistsPayload() = runBlocking {
  val server = MockWebServer(); server.start()
  try {
   val store = MemoryStore()
   server.enqueue(MockResponse().setBody(FIXTURE))
   TasksRepository(server.url("/").toString(), store).refresh("2026-11-14")
   val restarted = TasksRepository(server.url("/").toString(), store)
   assertNull(restarted.snapshot.data)
   assertFalse(restarted.snapshot.online)
   server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
   restarted.refresh("2026-11-14")
   assertNull(restarted.snapshot.data)
   assertFalse(restarted.snapshot.online)
   assertNotNull(restarted.snapshot.error)
  } finally { server.shutdown() }
 }
 @Test fun completionOnlyChangesAfterServerAcknowledges() = runBlocking {
  val server = MockWebServer(); server.start()
  try {
   server.enqueue(MockResponse().setBody(FIXTURE))
   val repo = TasksRepository(server.url("/").toString(), MemoryStore())
   repo.refresh("2026-11-14"); server.takeRequest()
   val body = org.json.JSONObject().put("taskId", "a").put("dueDate", "2026-11-14").put("date", "2026-11-14")
   server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
   assertFalse(repo.write("POST", "/api/occurrences/complete", body, "2026-11-14"))
   assertNull(repo.snapshot.data)
   assertFalse(repo.snapshot.online)
   val failedRequest = server.takeRequest()
   assertEquals("POST", failedRequest.method)
   assertEquals("2026-11-14", org.json.JSONObject(failedRequest.body.readUtf8()).getString("date"))
   server.enqueue(MockResponse().setBody(FIXTURE)); repo.refresh("2026-11-14"); server.takeRequest()
   server.enqueue(MockResponse().setBody(FIXTURE.replace("\"completed\":false", "\"completed\":true")))
   assertTrue(repo.write("POST", "/api/occurrences/complete", body, "2026-11-14"))
   assertTrue(repo.snapshot.data!!.today.single().completed)
  } finally { server.shutdown() }
 }
 @Test fun refusesMutationWithPreviousClientDate() = runBlocking {
  val server = MockWebServer(); server.start()
  try {
   server.enqueue(MockResponse().setBody(FIXTURE))
   val repo = TasksRepository(server.url("/").toString(), MemoryStore())
   repo.refresh("2026-11-14"); server.takeRequest()
   server.enqueue(MockResponse().setBody(FIXTURE))
   assertFalse(repo.write("POST", "/api/occurrences/complete", org.json.JSONObject(), "2026-11-15"))
   assertEquals(1, server.requestCount)
  } finally { server.shutdown() }
 }
 @Test fun parsesServerTimestampsIncludingNull() {
  val parsed = parseState(FIXTURE)
  assertEquals("2026-11-14T10:00:00Z", parsed.tasks.single().createdAt)
  assertNull(parsed.today.single().completedAt)
  val completed = parseState(FIXTURE.replace("\"completedAt\":null", "\"completedAt\":\"2026-11-14T12:00:00Z\""))
  assertEquals("2026-11-14T12:00:00Z", completed.today.single().completedAt)
 }
 @Test fun taskCreateEditArchiveReadBackAuthoritativeState() = runBlocking {
  val server = MockWebServer(); server.start()
  try {
   val repo = TasksRepository(server.url("/").toString(), MemoryStore())
   server.enqueue(MockResponse().setBody(FIXTURE)); repo.refresh("2026-11-14"); server.takeRequest()
   for ((method,path) in listOf("POST" to "/api/tasks", "PUT" to "/api/tasks/a", "DELETE" to "/api/tasks/a")) {
    server.enqueue(MockResponse().setResponseCode(if(method=="POST") 201 else if(method=="DELETE") 204 else 200).setBody(if(method=="DELETE") "" else if(method=="POST") "{\"id\":\"a\"}" else "{}"))
    server.enqueue(MockResponse().setBody(FIXTURE))
    assertTrue(repo.write(method,path,if(method=="DELETE") null else TaskDraft(title="Read", startDate="2026-11-14").json(), "2026-11-14"))
    val request = server.takeRequest()
    assertEquals(method, request.method); assertEquals(path, request.path)
    if(method!="DELETE") assertEquals("Read", org.json.JSONObject(request.body.readUtf8()).getString("title"))
    assertEquals("/api/state?date=2026-11-14", server.takeRequest().path)
   }
  } finally { server.shutdown() }
 }
 @Test fun malformedRefreshCannotReplaceCacheOrEnableOfflineWrites() = runBlocking {
  val server = MockWebServer(); server.start()
  try {
   val store = MemoryStore(); val url=server.url("/").toString()
   val repo = TasksRepository(url, store)
   assertFalse(repo.write("POST", "/api/tasks", org.json.JSONObject(), "2026-11-14"))
   assertEquals(0, server.requestCount)
   server.enqueue(MockResponse().setBody(FIXTURE)); repo.refresh("2026-11-14")
   server.enqueue(MockResponse().setBody("{broken")); repo.refresh("2026-11-14")
   assertFalse(repo.snapshot.online)
   assertNull(TasksRepository(url,store).snapshot.data)
  } finally { server.shutdown() }
 }
 @Test fun failedPostWriteRefreshDoesNotReportSuccess() = runBlocking {
  val server = MockWebServer(); server.start()
  try {
   val repo = TasksRepository(server.url("/").toString(), MemoryStore())
   server.enqueue(MockResponse().setBody(FIXTURE)); repo.refresh("2026-11-14")
   server.enqueue(MockResponse().setResponseCode(201).setBody("{}"))
   server.enqueue(MockResponse().setResponseCode(500))
   assertFalse(repo.write("POST", "/api/tasks", TaskDraft(title="Read").json(), "2026-11-14"))
   assertFalse(repo.snapshot.online)
   assertNull(repo.snapshot.data)
  } finally { server.shutdown() }
 }
 @Test fun undoUsesContractRouteAndBody() = runBlocking {
  val server = MockWebServer(); server.start()
  try {
   val repo = TasksRepository(server.url("/").toString(), MemoryStore())
   server.enqueue(MockResponse().setBody(FIXTURE.replace("\"completed\":false","\"completed\":true"))); repo.refresh("2026-11-14"); server.takeRequest()
   server.enqueue(MockResponse().setBody(FIXTURE))
   val body=org.json.JSONObject().put("taskId","a").put("dueDate","2026-11-14").put("date","2026-11-14")
   assertTrue(repo.write("POST", "/api/occurrences/undo", body, "2026-11-14"))
   val request=server.takeRequest()
   assertEquals("/api/occurrences/undo",request.path)
   assertEquals("a",org.json.JSONObject(request.body.readUtf8()).getString("taskId"))
   assertFalse(repo.snapshot.data!!.today.single().completed)
  } finally { server.shutdown() }
 }
 companion object {
 val FIXTURE = """{"date":"2026-11-14","tasks":[{"id":"a","title":"Read","notes":"A note","category":"Personal","repeat":"weekly","interval":2,"startDate":"2026-11-14","priority":2,"createdAt":"2026-11-14T10:00:00Z"}],"today":[{"occurrenceId":"a@2026-11-14","taskId":"a","title":"Read","notes":"A note","category":"Personal","repeat":"weekly","interval":2,"priority":2,"dueDate":"2026-11-14","completed":false,"completedAt":null,"overdue":false}],"upcoming":[],"progress":{"completed":0,"total":1}}"""
 }
}
