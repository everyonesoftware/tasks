package com.everyonesoftware.daymark
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
class UpdaterTest {
 private val manifest="""{"schemaVersion":1,"packageName":"com.everyonesoftware.daymark","versionName":"0.3.0","versionCode":3,"minSdk":26,"apkAssetName":"Tasks.apk","sha256":"${"a".repeat(64)}"}"""
 private val base="https://github.com/everyonesoftware/tasks/releases/download/v3/"
 private fun release(extra: String="")="""{"draft":false,"prerelease":false,"body":"Real notes","assets":[{"name":"tasks-release.json","browser_download_url":"${base}tasks-release.json","size":300},{"name":"Tasks.apk","browser_download_url":"${base}Tasks.apk","size":4}]$extra}"""
 @Test fun prefersTasksManifestAndSupportsLegacyOnlyReleasesWithoutMaskingFailures() = runBlocking {
  val primary=org.json.JSONObject(release())
  val legacy=org.json.JSONObject(release().replace("tasks-release.json","daymark-release.json"))
  primary.getJSONArray("assets").put(legacy.getJSONArray("assets").getJSONObject(0))
  var body=primary.toString(); var manifestCode=200; var manifestBody=manifest
  val calls=mutableListOf<String>()
  val transport=object: UpdateTransport { override suspend fun get(url: String,limit: Long,consume: (ByteArray,Int)->Unit): Int {
   calls+=url; val data=(if(url==RELEASE_URL) body else manifestBody).toByteArray(); consume(data,data.size)
   return if(url==RELEASE_URL) 200 else manifestCode
  } }
  val service=UpdateService(transport,35)
  assertEquals(UpdateStatus.AVAILABLE,service.check(2).status)
  assertEquals(listOf(RELEASE_URL,base+"tasks-release.json"),calls)
  for(code in listOf(404,503)) {
   calls.clear(); manifestCode=code
   assertEquals(UpdateStatus.FAILED,service.check(2).status)
   assertEquals(listOf(RELEASE_URL,base+"tasks-release.json"),calls)
  }
  manifestCode=200; manifestBody="{}"; calls.clear()
  assertEquals(UpdateStatus.FAILED,service.check(2).status)
  assertEquals(listOf(RELEASE_URL,base+"tasks-release.json"),calls)
  manifestBody=manifest; body=legacy.toString(); calls.clear()
  assertEquals(UpdateStatus.AVAILABLE,service.check(2).status)
  assertEquals(listOf(RELEASE_URL,base+"daymark-release.json"),calls)
  primary.getJSONArray("assets").put(primary.getJSONArray("assets").getJSONObject(0))
  body=primary.toString(); calls.clear()
  assertEquals(UpdateStatus.FAILED,service.check(2).status)
  assertEquals(listOf(RELEASE_URL),calls)
 }
 @Test fun checksActualAssets404FailureCurrentAndNewer() = runBlocking {
  var code=404; var body=""; val calls=mutableListOf<String>()
  val transport=object: UpdateTransport { override suspend fun get(url: String,limit: Long,consume: (ByteArray,Int)->Unit): Int { calls+=url; val data=(if(url==RELEASE_URL) body else manifest).toByteArray(); consume(data,data.size); return code } }
  val service=UpdateService(transport,35)
  assertEquals(UpdateStatus.NO_RELEASES,service.check(2).status)
  code=503; assertEquals(UpdateStatus.FAILED,service.check(2).status)
  code=200;body=release(); assertEquals(UpdateStatus.AVAILABLE,service.check(2).status)
  assertEquals(UpdateStatus.CURRENT,service.check(3).status)
  body=release().replace("${base}Tasks.apk","https://evil.test/Tasks.apk")
  assertEquals(UpdateStatus.FAILED,service.check(2).status)
 }
 @Test fun downloadCancellationAndHashFailureRemoveStaging() = runBlocking {
  val dir=Files.createTempDirectory("tasks-update").toFile()
  try {
   val m=ReleaseManifest.parse(org.json.JSONObject(manifest),35);val release=Release(m,base+"Tasks.apk",4,"")
   val installed=ApkIdentity("com.everyonesoftware.daymark",2,setOf("signer"))
   val transport=object: UpdateTransport { override suspend fun get(url: String,limit: Long,consume: (ByteArray,Int)->Unit): Int { consume(byteArrayOf(1,2,3,4),4); return 200 } }
   assertTrue(runCatching { UpdateService(transport,35).download(release,dir,installed,{ installed },{}) }.isFailure)
   assertEquals(0,dir.listFiles()!!.size)
   val cancelled=object: UpdateTransport { override suspend fun get(url: String,limit: Long,consume: (ByteArray,Int)->Unit): Int { consume(byteArrayOf(1),1); throw CancellationException() } }
   assertTrue(runCatching { UpdateService(cancelled,35).download(release,dir,installed,{installed},{}) }.exceptionOrNull() is CancellationException)
   assertEquals(0,dir.listFiles()!!.size)
  } finally { dir.deleteRecursively() }
 }
}
