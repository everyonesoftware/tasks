package com.everyonesoftware.daymark
const val DEFAULT_BASE_URL = ""
fun validateBaseUrl(input: String, debug: Boolean = BuildConfig.DEBUG): String? = runCatching {
 val value = input.trim().trimEnd('/')
 val uri = java.net.URI(value)
 require(uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
 require(uri.rawPath.isNullOrEmpty() && (uri.port == -1 || uri.port in 1..65535))
 val scheme = uri.scheme?.lowercase()
 require(scheme == "https" || (scheme == "http" && (uri.host.lowercase() in setOf("localhost", "127.0.0.1", "10.0.2.2") || (debug && uri.host == "hermesdan.tail1a7c8f.ts.net"))))
 value
}.getOrNull()
