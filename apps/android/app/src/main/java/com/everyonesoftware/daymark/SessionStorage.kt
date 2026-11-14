package com.everyonesoftware.daymark

import org.json.JSONArray

interface PrivateRecords { fun entries(): Map<String,String>;fun put(key: String,value: String);fun remove(key: String) }
interface TokenCipher { fun encrypt(value: String): String;fun decrypt(value: String): String }
class ProtectedSessionVault(private val records: PrivateRecords,private val cipher: TokenCipher): SessionVault {
 init { records.entries().keys.filter { it !in setOf("sessionEnvelope","autoCheck") }.forEach(records::remove) }
 override fun load(): Session? = try {
  records.entries()["sessionEnvelope"]?.let { encrypted ->
   val fields=JSONArray(cipher.decrypt(encrypted))
   require(fields.length()==3 && (0..2).all { fields.get(it) is String })
   Session(fields.getString(0),fields.getString(1),fields.getString(2))
  }
 } catch(_: Exception) { clear();null }
 override fun save(session: Session) {
  // Bind the destination and account to the token under the same authenticated
  // ciphertext; a single commit can only replace the complete session.
  val fields=JSONArray().put(session.endpoint).put(session.username).put(session.token)
  records.put("sessionEnvelope",cipher.encrypt(fields.toString()))
 }
 override fun clear() { listOf("sessionEnvelope","endpoint","username","session").forEach(records::remove) }
}
