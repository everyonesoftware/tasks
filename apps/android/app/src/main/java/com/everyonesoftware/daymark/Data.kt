package com.everyonesoftware.daymark
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
data class Task(val id: String, val title: String, val notes: String, val category: String, val repeat: String, val interval: Int, val startDate: String, val priority: Int, val createdAt: String = "") : java.io.Serializable
data class Occurrence(val occurrenceId: String, val taskId: String, val title: String, val notes: String, val category: String, val repeat: String, val interval: Int, val priority: Int, val dueDate: String, val completed: Boolean, val overdue: Boolean, val completedAt: String? = null)
data class DayState(val date: String, val tasks: List<Task>, val today: List<Occurrence>, val upcoming: List<Occurrence>, val completed: Int, val total: Int)
data class Snapshot(val data: DayState? = null, val online: Boolean = false, val error: String? = null, val expired: Boolean = false)
interface Store { fun read(key: String): String?; fun write(key: String, value: String) }
class MemoryStore : Store { private val values = mutableMapOf<String,String>(); override fun read(key: String) = values[key]; override fun write(key: String, value: String) { values[key] = value } }
fun parseState(raw: String): DayState {
 val root = org.json.JSONObject(raw)
 fun tasks() = root.getJSONArray("tasks").let { a -> (0 until a.length()).map { i -> a.getJSONObject(i).let { t ->
  Task(t.getString("id"), t.getString("title"), t.getString("notes"), t.getString("category"), t.getString("repeat"), t.getInt("interval"), t.getString("startDate"), t.getInt("priority"), t.getString("createdAt"))
 } } }
 fun occurrences(key: String) = root.getJSONArray(key).let { a -> (0 until a.length()).map { i -> a.getJSONObject(i).let { t ->
  Occurrence(t.getString("occurrenceId"), t.getString("taskId"), t.getString("title"), t.getString("notes"), t.getString("category"), t.getString("repeat"), t.getInt("interval"), t.getInt("priority"), t.getString("dueDate"), t.getBoolean("completed"), t.getBoolean("overdue"), if(t.isNull("completedAt")) null else t.getString("completedAt"))
 } } }
 return DayState(root.getString("date"), tasks(), occurrences("today"), occurrences("upcoming"), root.getJSONObject("progress").getInt("completed"), root.getJSONObject("progress").getInt("total"))
}
class DaymarkRepository(val baseUrl: String, private val store: Store, private val token: String = "") {
 private val client = okhttp3.OkHttpClient.Builder().connectTimeout(8, java.util.concurrent.TimeUnit.SECONDS).readTimeout(12, java.util.concurrent.TimeUnit.SECONDS).followRedirects(false).build()
 var snapshot = Snapshot(); private set
 suspend fun write(method: String, path: String, body: org.json.JSONObject?, date: String): Boolean = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
  if (!snapshot.online || snapshot.data?.date != date) return@withContext false
  try {
   val request = okhttp3.Request.Builder().url(baseUrl.trimEnd('/') + path).method(method,
    body?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType())).build()
   client.newCall(request.newBuilder().header("Authorization", "Bearer $token").build()).execute().use { response ->
    if(response.code == 401) { snapshot=Snapshot(expired=true); return@withContext false }
    check(response.isSuccessful) { "Server returned ${response.code}" }
    if (path.startsWith("/api/occurrences/")) {
     val raw = response.body!!.string()
     val data = parseState(raw)
      snapshot = Snapshot(data, true)
    } else { refresh(date) }
   }
   snapshot.online
  } catch (e: Exception) {
   if (e is kotlinx.coroutines.CancellationException) throw e
   snapshot = Snapshot(error = "Write not confirmed. Connection required.")
   false
  }
 }
 suspend fun refresh(date: String) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
  try {
   val request = okhttp3.Request.Builder().url(baseUrl.trimEnd('/') + "/api/state?date=$date").build()
   client.newCall(request.newBuilder().header("Authorization", "Bearer $token").build()).execute().use { response ->
    if(response.code == 401) { snapshot=Snapshot(expired=true); return@withContext }
    check(response.isSuccessful) { "Server returned ${response.code}" }
    val raw = response.body!!.string()
    val data = parseState(raw)
    snapshot = Snapshot(data, true)
   }
  } catch (e: Exception) {
   if (e is kotlinx.coroutines.CancellationException) throw e
   snapshot = Snapshot(error = "Connection required. No tasks are stored on this device.")
  }
 }
}
