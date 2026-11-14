package com.everyonesoftware.daymark
import org.junit.Assert.*
import org.junit.Test
class ConnectionUrlTest {
 @Test fun acceptsSecureOrExplicitLocalHosts() {
  assertEquals("https://example.org:443", validateBaseUrl(" https://example.org:443/ "))
  for (host in listOf("localhost", "127.0.0.1", "10.0.2.2", "hermesdan.tail1a7c8f.ts.net")) assertNotNull(validateBaseUrl("http://$host:8787"))
 }
 @Test fun rejectsCredentialsPathsAndUntrustedCleartext() {
  for (url in listOf("http://example.org", "http://foo.ts.net", "https://user:pass@example.org", "https://example.org/path", "https://example.org?q=x", "https://example.org#x", "ftp://localhost", "http://hermesdan.tail1a7c8f.ts.net.evil.com", "https://example.org:99999", "garbage")) assertNull(url, validateBaseUrl(url))
 }
}
