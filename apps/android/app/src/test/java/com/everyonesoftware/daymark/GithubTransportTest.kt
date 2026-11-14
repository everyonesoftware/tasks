package com.everyonesoftware.daymark

import org.junit.Assert.assertEquals
import org.junit.Test

class GithubTransportTest {
 @Test fun releaseMetadataRequestsGitHubJsonRatherThanBinaryMedia() {
  assertEquals("application/vnd.github+json", GithubTransport().requestFor(RELEASE_URL).header("Accept"))
 }
 @Test fun releaseAssetsRetainBinaryMediaWithoutBackendCredentials() {
  val request=GithubTransport().requestFor("https://github.com/everyonesoftware/tasks/releases/download/v0.2.0/daymark-release.json")
  assertEquals("application/octet-stream",request.header("Accept"))
  assertEquals(null,request.header("Authorization"))
 }
}
