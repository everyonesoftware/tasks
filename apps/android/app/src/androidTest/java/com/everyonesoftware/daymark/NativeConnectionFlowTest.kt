package com.everyonesoftware.daymark

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/** Isolated, on-emulator HTTP fixtures. Never contacts a user server. */
class NativeConnectionFlowTest {
 private val context=InstrumentationRegistry.getInstrumentation().targetContext
 private val fixture=FixtureServer()
 init {context.getSharedPreferences("daymark",Context.MODE_PRIVATE).edit().clear().putString("autoCheck","false").commit()}
 @get:Rule val compose=createAndroidComposeRule<MainActivity>()
 @After fun close() {fixture.close();context.getSharedPreferences("daymark",Context.MODE_PRIVATE).edit().clear().commit()}
 @Test fun realLoginBearerKeystoreFailureExpiryAndSignout() {
  compose.onNodeWithTag("server").performTextInput(fixture.endpoint)
  compose.onNodeWithTag("username").performTextInput("fixture")
  compose.onNodeWithTag("password").performTextInput("fixture-password")
  compose.onNodeWithText("Sign in").performScrollTo().performClick()
  compose.waitUntil(20000) {compose.onAllNodesWithText("Fixture task").fetchSemanticsNodes().isNotEmpty()}
  val prefs=context.getSharedPreferences("daymark",Context.MODE_PRIVATE)
  assertEquals(setOf("autoCheck","endpoint","username","session"),prefs.all.keys)
  assertFalse(prefs.getString("session","")!!.contains("fixture-token"))
  assertFalse(prefs.all.values.any {it.toString().contains("Fixture task") || it.toString().contains("fixture-password")})
  assertEquals("fixture-token",ProtectedSessionVault(AndroidRecords(context),KeystoreTokenCipher()).load()?.token)
  assertTrue(fixture.requests.any {it.contains("Authorization: Bearer fixture-token",true)})
  compose.onAllNodesWithText("Settings")[0].performClick()
  compose.onNodeWithText("Download cancelled.").assertDoesNotExist()
  compose.onNodeWithText("Edit connection").performScrollTo().performClick()
  compose.onNodeWithTag("password").performTextInput("wrong-password")
  compose.onNodeWithText("Test & save").performScrollTo().performClick()
  compose.waitUntil(20000) {compose.onAllNodesWithText("Sign-in expired or credentials not accepted.").fetchSemanticsNodes().isNotEmpty()}
  assertEquals("fixture-token",ProtectedSessionVault(AndroidRecords(context),KeystoreTokenCipher()).load()?.token)
  compose.onNodeWithText("Cancel").performClick()
  fixture.expired=true
  compose.onNodeWithText("Test").performScrollTo().performClick()
  compose.waitUntil(20000) {compose.onAllNodesWithText("Connect your server.").fetchSemanticsNodes().isNotEmpty()}
  compose.onNodeWithText("Fixture task").assertDoesNotExist()
  assertNull(ProtectedSessionVault(AndroidRecords(context),KeystoreTokenCipher()).load())
 }
 @Test fun keystoreUsesRandomIvAndTamperingFailsClosed() {
  val cipher=KeystoreTokenCipher();val first=cipher.encrypt("test-token");val second=cipher.encrypt("test-token")
  assertNotEquals(first,second);assertEquals("test-token",cipher.decrypt(first))
  val bytes=android.util.Base64.decode(first,android.util.Base64.NO_WRAP);bytes[bytes.lastIndex]=(bytes.last().toInt() xor 1).toByte()
  assertTrue(runCatching {cipher.decrypt(android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP))}.isFailure)
 }
 private class FixtureServer {
  private val socket=ServerSocket(0)
  val endpoint="http://127.0.0.1:${socket.localPort}"
  val requests=CopyOnWriteArrayList<String>()
  @Volatile var expired=false
  private val worker=thread(isDaemon=true,name="daymark-test-fixture") {
   while(!socket.isClosed) {try {socket.accept().use(::respond)} catch(_: Exception) {if(socket.isClosed) break} }
  }
  private fun respond(client: Socket) {
   client.soTimeout=5000
   val input=client.getInputStream().bufferedReader();val lines=mutableListOf<String>();while(true) {val line=input.readLine() ?: break;if(line.isEmpty()) break;lines+=line}
   val length=lines.firstOrNull {it.startsWith("Content-Length:",true)}?.substringAfter(':')?.trim()?.toInt() ?: 0
   val buffer=CharArray(length);var read=0;while(read<length) {val n=input.read(buffer,read,length-read);if(n<0) break;read+=n}
   val request=lines.joinToString("\n");requests+=request
   val body=String(buffer);val path=lines.firstOrNull().orEmpty().split(' ').getOrNull(1).orEmpty()
   val authenticated=lines.any {it.equals("Authorization: Bearer fixture-token",true)} && !expired
   val (code,response)=when {
    path=="/api/auth/login" && body.contains("fixture-password") -> 200 to """{"username":"fixture","token":"fixture-token","expiresAt":"2099-01-01T00:00:00Z"}"""
    path=="/api/auth/login" -> 401 to "{}"
    !authenticated -> 401 to "{}"
    path=="/api/auth/session" -> 200 to """{"username":"fixture","expiresAt":"2099-01-01T00:00:00Z"}"""
    path.startsWith("/api/state") -> 200 to state()
    path=="/api/auth/logout" -> 204 to ""
    else -> 404 to "{}"
   }
   val bytes=response.toByteArray();client.getOutputStream().apply {write("HTTP/1.1 $code OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray());write(bytes);flush()}
  }
  private fun state(): String {val date=java.time.LocalDate.now().toString();return """{"date":"$date","tasks":[],"today":[{"occurrenceId":"fixture@$date","taskId":"fixture","title":"Fixture task","notes":"","category":"Test","repeat":"once","interval":1,"priority":0,"dueDate":"$date","completed":false,"completedAt":null,"overdue":false}],"upcoming":[],"progress":{"completed":0,"total":1}}"""}
  fun close() {socket.close();worker.join(1000)}
 }
}
