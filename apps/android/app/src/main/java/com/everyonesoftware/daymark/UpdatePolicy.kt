package com.everyonesoftware.daymark

import org.json.JSONObject
import java.net.URI

const val RELEASE_URL="https://api.github.com/repos/everyonesoftware/tasks/releases/latest"
const val MAX_APK_BYTES=150L*1024*1024
object GithubPolicy {
 private fun uri(url: String): URI? = runCatching { URI(url).also { require(it.scheme=="https" && it.rawUserInfo==null && it.rawFragment==null && (it.port==-1 || it.port==443)) } }.getOrNull()
 fun initial(url: String): Boolean {
  val u=uri(url) ?: return false
  if(u.rawQuery!=null) return false
  return (u.host=="api.github.com" && (u.rawPath=="/repos/everyonesoftware/tasks/releases/latest" || Regex("/repos/everyonesoftware/tasks/releases/assets/[0-9]+").matches(u.rawPath))) || (u.host=="github.com" && Regex("/everyonesoftware/tasks/releases/download/[^/]+/[^/]+").matches(u.rawPath) && !u.rawPath.contains("..") && !u.rawPath.contains('%'))
 }
 fun redirect(url: String): Boolean { val u=uri(url) ?: return false; return initial(url) || (u.host in setOf("release-assets.githubusercontent.com","objects.githubusercontent.com","github-releases.githubusercontent.com") && u.rawPath.startsWith('/')) }
}
data class ReleaseManifest(val versionName: String,val versionCode: Long,val minSdk: Int,val apkAssetName: String,val sha256: String) {
 companion object {
  fun parse(json: JSONObject,sdk: Int): ReleaseManifest {
   fun integer(key: String): Long { val value=json.get(key); require(value is Int || value is Long); return (value as Number).toLong() }
   require(integer("schemaVersion")==1L && json.getString("packageName")=="com.everyonesoftware.daymark")
   val code=integer("versionCode"); val min=integer("minSdk"); val name=json.getString("versionName"); val asset=json.getString("apkAssetName"); val hash=json.getString("sha256")
   require(code in 1..Int.MAX_VALUE.toLong() && min in 26..sdk.toLong())
   require(name.isNotBlank() && name.length<=100 && Regex("[A-Za-z0-9._-]+\\.apk").matches(asset) && !asset.contains(".."))
   require(Regex("[a-f0-9]{64}").matches(hash))
   return ReleaseManifest(name,code,min.toInt(),asset,hash)
  }
 }
}
data class ApkIdentity(val packageName: String,val versionCode: Long,val signers: Set<String>)
fun verifyApk(manifest: ReleaseManifest,digest: String,candidate: ApkIdentity,installed: ApkIdentity) {
 require(digest==manifest.sha256) { "APK checksum mismatch" }
 require(candidate.packageName=="com.everyonesoftware.daymark" && candidate.packageName==installed.packageName) { "APK package mismatch" }
 require(candidate.versionCode==manifest.versionCode && candidate.versionCode>installed.versionCode) { "APK version mismatch" }
 require(installed.signers.isNotEmpty() && candidate.signers==installed.signers) { "APK signing certificate mismatch" }
}
enum class UpdateStatus { IDLE,CHECKING,NO_RELEASES,FAILED,CURRENT,AVAILABLE,DOWNLOADING,READY,CANCELLED }
fun classifyRelease(code: Int,json: JSONObject?): UpdateStatus = when {
 code==404 -> UpdateStatus.NO_RELEASES
 code!=200 || json==null || json.optBoolean("draft",true) || json.optBoolean("prerelease",true) -> UpdateStatus.FAILED
 else -> UpdateStatus.AVAILABLE
}
data class Release(val manifest: ReleaseManifest,val apkUrl: String,val size: Long,val notes: String)
data class UpdateState(val status: UpdateStatus=UpdateStatus.IDLE,val release: Release?=null,val downloaded: Long=0,val error: String?=null)

enum class InstallAction { NONE,REQUEST_SOURCE_PERMISSION,OPEN_SYSTEM_INSTALLER }
fun installerAction(verified: Boolean,permission: Boolean)=if(!verified) InstallAction.NONE else if(!permission) InstallAction.REQUEST_SOURCE_PERMISSION else InstallAction.OPEN_SYSTEM_INSTALLER
