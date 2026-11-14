package com.everyonesoftware.daymark
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
class AuthTest {
 @Test fun blankInstallAndFailedProposalPreservesOldSession() = runBlocking {
  val vault=MemorySessionVault(); val server=MockWebServer(); server.start()
  try {
   val manager=ConnectionManager(vault, AuthApi())
   assertNull(manager.session)
   server.enqueue(MockResponse().setBody("""{"token":"secret","username":"Alice","expiresAt":"2027-01-01T00:00:00Z"}"""))
   server.enqueue(MockResponse().setBody("""{"username":"Alice","expiresAt":"2027-01-01T00:00:00Z"}"""))
   manager.connect(server.url("/").toString().trimEnd('/'),"alice"," password ",true)
   val old=manager.session
   assertEquals("Alice",old?.username)
   assertTrue(server.takeRequest().body.readUtf8().contains(" password "))
   server.takeRequest()
   server.enqueue(MockResponse().setResponseCode(401))
   assertTrue(runCatching { manager.connect(server.url("/").toString().trimEnd('/'),"bob","bad",true) }.isFailure)
   assertEquals(old,manager.session); assertEquals(old,vault.load())
  } finally { server.shutdown() }
 }
 @Test fun switchRequiresConfirmationAndLogoutClearsEvenOnFailure() = runBlocking {
  val vault=MemorySessionVault(); vault.save(Session("http://127.0.0.1:1","Alice","secret"))
  val manager=ConnectionManager(vault,AuthApi())
  assertTrue(manager.needsConfirmation("https://other.example","alice"))
  assertTrue(runCatching { manager.connect("https://other.example","alice","password",false) }.isFailure)
  assertFalse(manager.signOut()); assertNull(vault.load()); assertNull(manager.session)
 }
 @Test fun tailnetHttpRequiresDebugAndOriginsRejectExtraParts() {
  assertEquals("",DEFAULT_BASE_URL)
  assertNull(validateBaseUrl("http://hermesdan.tail1a7c8f.ts.net:8787",false))
  assertNotNull(validateBaseUrl("http://hermesdan.tail1a7c8f.ts.net:8787",true))
 }
 @Test fun bearerSessionAndRateLimitAndRedirectAreNotCredentialsForwarded() = runBlocking {
  val server=MockWebServer(); server.start()
  try {
   val session=Session(server.url("/").toString().trimEnd('/'),"Alice","opaque")
   server.enqueue(MockResponse().setBody("""{"username":"Alice","expiresAt":"2027-01-01T00:00:00Z"}"""))
   AuthApi().test(session); assertEquals("Bearer opaque",server.takeRequest().getHeader("Authorization"))
   server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After","60"))
   assertTrue(runCatching { AuthApi().login(session.endpoint,"Alice","password") }.exceptionOrNull()!!.message!!.contains("Too many"))
   server.enqueue(MockResponse().setResponseCode(302).setHeader("Location","https://example.org"))
   assertTrue(runCatching { AuthApi().login(session.endpoint,"Alice","password") }.isFailure)
  } finally { server.shutdown() }
 }
}
