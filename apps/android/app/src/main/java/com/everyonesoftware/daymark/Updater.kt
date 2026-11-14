package com.everyonesoftware.daymark

import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

interface UpdateTransport { suspend fun get(url: String,limit: Long,consume: (ByteArray,Int)->Unit): Int }
@OptIn(kotlinx.coroutines.InternalCoroutinesApi::class)
class GithubTransport : UpdateTransport {
 // Dedicated client: never shares cookies, interceptors or backend authorization.
 private val client=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(15,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).callTimeout(120,TimeUnit.SECONDS).build()
 internal fun requestFor(url: String): Request = Request.Builder().url(url)
  .header("Accept",if(url==RELEASE_URL) "application/vnd.github+json" else "application/octet-stream")
  .header("User-Agent","Daymark-Android").build()
 override suspend fun get(url: String,limit: Long,consume: (ByteArray,Int)->Unit): Int = withContext(Dispatchers.IO) {
  require(GithubPolicy.initial(url)); var current=url
  val context=coroutineContext
  val deadline=System.nanoTime()+TimeUnit.MINUTES.toNanos(3)
  repeat(6) { hop ->
   context.ensureActive(); check(System.nanoTime()<deadline)
   val request=requestFor(current)
   val call=client.newCall(request)
   val cancel=context[Job]?.invokeOnCompletion(onCancelling=true,invokeImmediately=true) { if(it!=null) call.cancel() }
   try {
    call.execute().use { response ->
     if(response.code in listOf(301,302,303,307,308)) {
      require(hop<5)
      current=response.header("Location")?.let { response.request.url.resolve(it)?.toString() } ?: error("Missing redirect")
      require(GithubPolicy.redirect(current)) { "Untrusted download redirect" }
     } else {
      if(response.code!=200) return@withContext response.code
      val body=response.body ?: error("Empty download")
      require(body.contentLength()<=limit)
      body.byteStream().use { input ->
       val buffer=ByteArray(16384); var count=0L
       while(true) { context.ensureActive(); check(System.nanoTime()<deadline); val n=input.read(buffer); if(n<0) break; count+=n; require(count<=limit); consume(buffer,n) }
      }
      return@withContext response.code
     }
    }
   } finally { cancel?.dispose() }
  }
  error("Too many redirects")
 }
}
class UpdateService(private val transport: UpdateTransport,private val sdk: Int) {
 private suspend fun json(url: String): Pair<Int,JSONObject?> {
  val bytes=ByteArrayOutputStream();val code=transport.get(url,1024*1024) { data,n -> require(bytes.size()+n<=1024*1024); bytes.write(data,0,n) }
  return code to if(code==200) JSONObject(bytes.toString("UTF-8")) else null
 }
 suspend fun check(installedCode: Long): UpdateState = withContext(Dispatchers.IO) {
  try {
   val (code,json)=json(RELEASE_URL); val status=classifyRelease(code,json)
   if(status!=UpdateStatus.AVAILABLE) return@withContext UpdateState(status)
   val release=json!!; val assets=release.getJSONArray("assets")
   fun asset(name: String): JSONObject { val matches=(0 until assets.length()).map { assets.getJSONObject(it) }.filter { it.getString("name")==name };require(matches.size==1);return matches.single().also { require(GithubPolicy.initial(it.getString("browser_download_url"))) } }
   val manifestAsset=asset("daymark-release.json"); val (mc,mj)=json(manifestAsset.getString("browser_download_url")); require(mc==200)
   val manifest=ReleaseManifest.parse(mj!!,sdk);val apk=asset(manifest.apkAssetName); val size=apk.getLong("size");require(size in 1..MAX_APK_BYTES)
   UpdateState(if(manifest.versionCode>installedCode) UpdateStatus.AVAILABLE else UpdateStatus.CURRENT,Release(manifest,apk.getString("browser_download_url"),size,release.optString("body","").take(100000)))
  } catch(e: Exception) { if(e is CancellationException) throw e; UpdateState(UpdateStatus.FAILED,error="Couldn’t check GitHub. Installed version is unchanged.") }
 }
 suspend fun download(release: Release,dir: File,installed: ApkIdentity,inspect: (File)->ApkIdentity,progress: (Long)->Unit): File = withContext(Dispatchers.IO) {
  require(release.size in 1..MAX_APK_BYTES && release.manifest.versionCode>installed.versionCode)
  require(GithubPolicy.initial(release.apkUrl))
  dir.mkdirs(); val stage=File(dir,"update.part");val ready=File(dir,"Daymark.apk");stage.delete();ready.delete()
  try {
   val digest=MessageDigest.getInstance("SHA-256");var count=0L
   stage.outputStream().use { output ->
    val code=transport.get(release.apkUrl,release.size) { bytes,n -> count+=n;require(count<=release.size);output.write(bytes,0,n);digest.update(bytes,0,n);progress(count) };require(code==200)
   }
   coroutineContext.ensureActive();require(count==release.size)
   verifyApk(release.manifest,digest.digest().joinToString("") { "%02x".format(it) },inspect(stage),installed)
   require(stage.renameTo(ready));ready
  } catch(e: Throwable) { stage.delete();ready.delete();throw e }
 }
}
