package com.everyonesoftware.daymark
class FocusOrder(private val store: Store = MemoryStore(), private val key: String = "focus") {
 fun pick(id: String) { order = listOf(id) + order.filterNot { it == id }; save() }
 private var day = store.read("$key:date") ?: ""
 private var order = runCatching { org.json.JSONArray(store.read("$key:order") ?: "[]").let { a -> (0 until a.length()).map { a.getString(it) } } }.getOrDefault(emptyList())
 private fun save() { store.write("$key:date", day); store.write("$key:order", org.json.JSONArray(order).toString()) }
 fun arrange(date: String, ids: List<String>): List<String> {
  if (day != date) { day = date; order = emptyList() }
  order = order.filter { it in ids } + ids.filter { it !in order }
  save()
  return order
 }
 fun notNow(id: String) { order = order.filterNot { it == id } + id; save() }
}
