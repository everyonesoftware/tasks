package com.everyonesoftware.daymark
import java.time.LocalDate
import org.json.JSONObject
data class TaskDraft(val title: String = "", val notes: String = "", val category: String = "Personal", val repeat: String = "once", val interval: String = "1", val startDate: String = LocalDate.now().toString(), val priority: Int = 0) {
 fun error(): String? = when {
  title.trim().isEmpty() || title.trim().length > 200 -> "Enter a title of 1–200 characters."
  notes.length > 2000 -> "Notes must be at most 2000 characters."
  category.length > 60 -> "Category must be at most 60 characters."
  repeat !in listOf("once", "daily", "weekly", "monthly", "yearly") -> "Choose a repeat schedule."
  interval.toIntOrNull() !in 1..365 -> "Repeat interval must be 1–365."
  !Regex("\\d{4}-\\d{2}-\\d{2}").matches(startDate) || runCatching { LocalDate.parse(startDate) }.isFailure -> "Use a valid start date (YYYY-MM-DD)."
  priority !in 0..2 -> "Choose a priority."
  else -> null
 }
 fun json(): JSONObject {
  require(error() == null)
  return JSONObject().put("title", title.trim()).put("notes", notes).put("category", category.trim().ifEmpty { "Personal" }).put("repeat", repeat).put("interval", interval.toInt()).put("startDate", startDate).put("priority", priority)
 }
}
