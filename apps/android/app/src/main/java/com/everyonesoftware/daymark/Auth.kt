package com.everyonesoftware.daymark

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class Session(val endpoint: String, val username: String, val token: String)
interface SessionVault { fun load(): Session?; fun save(session: Session); fun clear() }
class MemorySessionVault : SessionVault {
 private var value: Session? = null
 override fun load() = value
 override fun save(session: Session) { value=session }
 override fun clear() { value=null }
}
class AuthFailure(val status: Int) : Exception(when(status) { 401 -> "Sign-in expired or credentials not accepted."; 429 -> "Too many attempts. Please wait before trying again."; else -> "Could not connect securely. Check the address and network." })
class AuthApi {
 private val client=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).callTimeout(20,TimeUnit.SECONDS).build()
 private suspend fun request(endpoint: String,path: String,token: String?=null,body: JSONObject?=null,post: Boolean=false): String = withContext(Dispatchers.IO) {
  val builder=Request.Builder().url(endpoint+path)
  if(token!=null) builder.header("Authorization","Bearer $token")
  if(post) builder.post((body?.toString()?:"").toRequestBody("application/json".toMediaType()))
  client.newCall(builder.build()).execute().use { response ->
   if(!response.isSuccessful) throw AuthFailure(response.code)
   val data=response.body?.string().orEmpty(); require(data.length<=65536); data
  }
 }
 suspend fun login(endpoint: String,username: String,password: String): Session {
  require(Regex("[A-Za-z0-9._-]{1,64}").matches(username) && password.isNotEmpty() && password.length<=1024)
  val json=JSONObject(request(endpoint,"/api/auth/login",body=JSONObject().put("username",username).put("password",password),post=true))
  require(java.time.Instant.parse(json.getString("expiresAt")).isAfter(java.time.Instant.now()))
  val token=json.getString("token"); require(token.isNotBlank() && !token.contains('\n') && !token.contains('\r'))
  return Session(endpoint,json.getString("username"),token)
 }
 suspend fun test(session: Session) { val json=JSONObject(request(session.endpoint,"/api/auth/session",session.token)); require(json.getString("username").equals(session.username,true)); require(java.time.Instant.parse(json.getString("expiresAt")).isAfter(java.time.Instant.now())) }
 suspend fun logout(session: Session) { request(session.endpoint,"/api/auth/logout",session.token,post=true) }
}
class ConnectionManager(private val vault: SessionVault,private val api: AuthApi) {
 var session=vault.load(); private set
 fun needsConfirmation(endpoint: String,username: String) = session?.let { it.endpoint!=endpoint || !it.username.equals(username,true) } ?: false
 suspend fun connect(endpoint: String,username: String,password: String,confirmed: Boolean) {
  require(!needsConfirmation(endpoint,username) || confirmed)
  val proposed=api.login(endpoint,username,password)
  api.test(proposed)
  val old=session
  vault.save(proposed); session=proposed
  if(old!=null) runCatching { api.logout(old) }
 }
 suspend fun test() { session?.let { api.test(it) } ?: throw AuthFailure(401) }
 fun clear() { vault.clear(); session=null }
 suspend fun signOut(): Boolean { val old=session; clear(); return old==null || runCatching { api.logout(old) }.isSuccess }
}
