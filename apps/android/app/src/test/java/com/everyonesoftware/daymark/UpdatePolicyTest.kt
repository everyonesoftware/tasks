package com.everyonesoftware.daymark
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
class UpdatePolicyTest {
 private fun manifest()=JSONObject("""{"schemaVersion":1,"packageName":"com.everyonesoftware.daymark","versionName":"0.3.0","versionCode":3,"minSdk":26,"apkAssetName":"Tasks-0.3.0-3.apk","sha256":"${"a".repeat(64)}"}""")
 @Test fun manifestRejectsMalformedIdentityBoundsDigestAndAsset() {
  assertEquals(3,ReleaseManifest.parse(manifest(),35).versionCode)
  for((key,value) in listOf("schemaVersion" to 2,"packageName" to "evil","versionCode" to -1,"minSdk" to 99,"sha256" to "BAD","apkAssetName" to "../evil.apk")) {
   assertTrue(key,runCatching { ReleaseManifest.parse(manifest().put(key,value),35) }.isFailure)
  }
 }
 @Test fun githubUrlsRejectLookalikesNonHttpsAndOtherRepository() {
  assertTrue(GithubPolicy.initial("https://api.github.com/repos/everyonesoftware/tasks/releases/latest"))
  assertTrue(GithubPolicy.initial("https://github.com/everyonesoftware/tasks/releases/download/v0.3.0/a.apk"))
  for(url in listOf("http://github.com/everyonesoftware/tasks/releases/download/v/a.apk","https://github.com.evil/everyonesoftware/tasks/releases/download/v/a.apk","https://github.com/other/tasks/releases/download/v/a.apk","https://user@github.com/everyonesoftware/tasks/releases/download/v/a.apk","https://github.com/everyonesoftware/tasks/releases/download/v/a.apk?q=1")) assertFalse(url,GithubPolicy.initial(url))
  assertTrue(GithubPolicy.redirect("https://release-assets.githubusercontent.com/github-production-release-asset/123/a?sig=abc"))
  assertFalse(GithubPolicy.redirect("https://evil.com/a"))
 }
 @Test fun apkRequiresExactDigestPackageVersionAndInstalledSigner() {
  val m=ReleaseManifest.parse(manifest(),35)
  val installed=ApkIdentity("com.everyonesoftware.daymark",2,setOf("installed"))
  val candidate=ApkIdentity(installed.packageName,3,installed.signers)
  verifyApk(m,"a".repeat(64),candidate,installed)
  for((digest,apk) in listOf("b".repeat(64) to candidate,"a".repeat(64) to candidate.copy(packageName="evil"),"a".repeat(64) to candidate.copy(versionCode=2),"a".repeat(64) to candidate.copy(signers=setOf("other")))) assertTrue(runCatching { verifyApk(m,digest,apk,installed) }.isFailure)
  assertTrue(runCatching { verifyApk(m,"a".repeat(64),candidate,installed.copy(versionCode=3)) }.isFailure)
 }
 @Test fun release404DiffersFromFailureAndStableOnly() {
  assertEquals(UpdateStatus.NO_RELEASES,classifyRelease(404,null))
  assertEquals(UpdateStatus.FAILED,classifyRelease(500,null))
  assertEquals(UpdateStatus.FAILED,classifyRelease(200,JSONObject().put("draft",true).put("prerelease",false)))
 }
}
