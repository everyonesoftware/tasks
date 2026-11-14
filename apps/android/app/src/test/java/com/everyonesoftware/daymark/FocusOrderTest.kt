package com.everyonesoftware.daymark
import org.junit.Assert.*
import org.junit.Test
class FocusOrderTest {
 @Test fun pickPersistsAndNewDateResetsServerOrder() {
  val store = MemoryStore()
  val focus = FocusOrder(store)
  focus.arrange("2026-11-14", listOf("a", "b", "c")); focus.pick("c")
  val restarted = FocusOrder(store)
  assertEquals(listOf("c", "a", "b"), restarted.arrange("2026-11-14", listOf("a", "b", "c")))
  assertEquals(listOf("c", "b", "d"), restarted.arrange("2026-11-14", listOf("b", "c", "d")))
  assertEquals(listOf("b", "c", "d"), restarted.arrange("2026-11-15", listOf("b", "c", "d")))
 }

 @Test fun notNowRotatesWithoutCompleting() {
  val focus = FocusOrder()
  assertEquals(listOf("a", "b", "c"), focus.arrange("2026-11-14", listOf("a", "b", "c")))
  focus.notNow("a")
  assertEquals(listOf("b", "c", "a"), focus.arrange("2026-11-14", listOf("a", "b", "c")))
 }
}
