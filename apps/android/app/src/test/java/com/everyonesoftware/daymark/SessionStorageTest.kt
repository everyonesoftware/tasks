package com.everyonesoftware.daymark

import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class SessionStorageTest {
 @Test fun interruptedReplacementNeverRestoresMixedSession() {
  val old=Session("https://old.example.org","Alice","old-token")
  val replacement=Session("https://new.example.org","Bob","new-token")
  // Simulate interruption before or after every possible individual commit,
  // both when replacing a session and when saving the first session.
  for (initial in listOf(null,old)) for (commitsBeforeFailure in 0..3) {
   val records=mutableMapOf<String,String>()
   var remaining=Int.MAX_VALUE
   val storage=object: PrivateRecords {
    override fun entries()=records.toMap()
    override fun put(key: String,value: String) {
     check(remaining>0) { "interrupted commit" }
     records[key]=value
     remaining--
     check(remaining>0) { "interrupted after commit" }
    }
    override fun remove(key: String) { records.remove(key) }
   }
   val cipher=TestCipher()
   val vault=ProtectedSessionVault(storage,cipher)
   initial?.let(vault::save)
   remaining=commitsBeforeFailure
   val result=runCatching { vault.save(replacement) }
   if(commitsBeforeFailure<=1) assertTrue(result.isFailure) else assertTrue(result.isSuccess)
   val restored=ProtectedSessionVault(storage,cipher).load()
   assertTrue("After $commitsBeforeFailure commits restored a mixed session: $restored",restored==null || restored==initial || restored==replacement)
   assertEquals(if(commitsBeforeFailure==0) initial else replacement,restored)
  }
 }
 @Test fun migrationDeletesLegacyPayloadsAndOnlyRetainsEncryptedSession() {
  val storage=MemoryRecords(mutableMapOf("cache:https://old" to "task data","focus:order" to "ids","baseUrl" to "old","password" to "bad","autoCheck" to "false"))
  val cipher=TestCipher()
  val vault=ProtectedSessionVault(storage,cipher)
  assertEquals(setOf("autoCheck"),storage.values.keys)
  val session=Session("https://example.org","Alice","opaque")
  vault.save(session)
  assertEquals(setOf("autoCheck","sessionEnvelope"),storage.values.keys)
  assertEquals(listOf(session.endpoint,session.username,session.token),JSONArray(cipher.decrypt(storage.values.getValue("sessionEnvelope"))).let { (0..2).map(it::getString) })
  assertEquals(session,vault.load())
  vault.clear();assertEquals(mapOf("autoCheck" to "false"),storage.values)
 }
 @Test fun completeSessionRoundTripsEscapesAndUnicodeWithOnePut() {
  val storage=MemoryRecords()
  val cipher=TestCipher()
  val session=Session("https://example.org","Alice\"\\\n雪","token\u0000\n\"\\:☃")
  ProtectedSessionVault(storage,cipher).save(session)
  assertEquals(1,storage.puts)
  assertEquals(setOf("sessionEnvelope"),storage.values.keys)
  assertEquals(session,ProtectedSessionVault(storage,cipher).load())
 }
 @Test fun unreadableCiphertextClearsSession() {
  val storage=MemoryRecords(mutableMapOf("sessionEnvelope" to "broken","autoCheck" to "false"))
  assertNull(ProtectedSessionVault(storage,TestCipher()).load())
  assertEquals(mapOf("autoCheck" to "false"),storage.values)
 }
 @Test fun tamperedAuthenticatedEnvelopeIsPurged() {
  val storage=MemoryRecords()
  val cipher=TestCipher()
  ProtectedSessionVault(storage,cipher).save(Session("https://example.org","Alice","opaque"))
  val bytes=Base64.getDecoder().decode(storage.values.getValue("sessionEnvelope"))
  bytes[12]=(bytes[12].toInt() xor 1).toByte()
  storage.values["sessionEnvelope"]=Base64.getEncoder().encodeToString(bytes)
  assertNull(ProtectedSessionVault(storage,cipher).load())
  assertTrue(storage.values.isEmpty())
 }
 @Test fun malformedEnvelopesArePurged() {
  for (plaintext in listOf("not json","{}","[]","[\"url\",\"user\"]","[\"url\",\"user\",\"token\",\"extra\"]","[null,\"user\",\"token\"]","[\"url\",1,\"token\"]","[\"url\",\"user\",false]")) {
   val cipher=TestCipher()
   val storage=MemoryRecords(mutableMapOf("sessionEnvelope" to cipher.encrypt(plaintext),"autoCheck" to "false"))
   assertNull(ProtectedSessionVault(storage,cipher).load())
   assertEquals(mapOf("autoCheck" to "false"),storage.values)
  }
 }
 @Test fun legacySplitRecordsAreNeverRestoredEvenWhenComplete() {
  val legacy=mapOf("endpoint" to "https://old.example.org","username" to "Alice","session" to "old-token")
  for (keys in listOf(legacy.keys,setOf("endpoint"),setOf("username","session"),setOf("session"))) {
   val storage=MemoryRecords(legacy.filterKeys { it in keys }.toMutableMap().apply { put("autoCheck","false") })
   assertNull(ProtectedSessionVault(storage,TestCipher()).load())
   assertEquals(mapOf("autoCheck" to "false"),storage.values)
  }
 }
 @Test fun failedEncryptionPreservesCompleteOldSessionWithoutWriting() {
  val storage=MemoryRecords()
  val cipher=TestCipher()
  val old=Session("https://old.example.org","Alice","old-token")
  ProtectedSessionVault(storage,cipher).save(old)
  val failing=object: TokenCipher {
   override fun encrypt(value: String): String=error("encryption failed")
   override fun decrypt(value: String)=cipher.decrypt(value)
  }
  assertTrue(runCatching { ProtectedSessionVault(storage,failing).save(Session("https://new.example.org","Bob","new-token")) }.isFailure)
  assertEquals(1,storage.puts)
  assertEquals(old,ProtectedSessionVault(storage,cipher).load())
 }
 @Test fun clearRemovesEnvelopeAndSplitRemnantsButPreservesAutoCheck() {
  val storage=MemoryRecords(mutableMapOf("autoCheck" to "false"))
  val vault=ProtectedSessionVault(storage,TestCipher())
  vault.save(Session("https://example.org","Alice","opaque"))
  storage.values.putAll(mapOf("endpoint" to "old","username" to "old","session" to "old"))
  vault.clear()
  assertNull(vault.load())
  assertEquals(mapOf("autoCheck" to "false"),storage.values)
 }
 private class MemoryRecords(val values: MutableMap<String,String> = mutableMapOf()): PrivateRecords {
  var puts=0
  override fun entries()=values.toMap()
  override fun put(key: String,value: String) { puts++;values[key]=value }
  override fun remove(key: String) { values.remove(key) }
 }
 // Exercise real authenticated encryption without requiring an Android Keystore.
 private class TestCipher: TokenCipher {
  private val key=KeyGenerator.getInstance("AES").apply { init(128) }.generateKey()
  override fun encrypt(value: String): String {
   val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE,key) }
   return Base64.getEncoder().encodeToString(cipher.iv+cipher.doFinal(value.toByteArray(Charsets.UTF_8)))
  }
  override fun decrypt(value: String): String {
   val bytes=Base64.getDecoder().decode(value)
   val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(0,12))) }
   return cipher.doFinal(bytes.copyOfRange(12,bytes.size)).toString(Charsets.UTF_8)
  }
 }
}
