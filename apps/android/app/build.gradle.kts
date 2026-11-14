plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }
// Release keys are provisioned outside the checkout; never print values.
val signingNames = listOf("DAYMARK_KEYSTORE_PATH", "DAYMARK_KEYSTORE_PASSWORD", "DAYMARK_KEY_ALIAS", "DAYMARK_KEY_PASSWORD")
val signingValues = signingNames.associateWith { providers.environmentVariable(it).orNull }
val signingConfigured = signingValues.values.all { !it.isNullOrBlank() }
require(signingValues.values.all { it == null } || signingConfigured) {
 "Release signing requires all four DAYMARK_KEYSTORE_PATH, DAYMARK_KEYSTORE_PASSWORD, DAYMARK_KEY_ALIAS, DAYMARK_KEY_PASSWORD variables."
}
gradle.taskGraph.whenReady {
 if (!signingConfigured && allTasks.any { it.project == project && (it.name.contains("Release", ignoreCase = true) && (it.name.startsWith("assemble") || it.name.startsWith("package") || it.name.startsWith("bundle"))) }) {
  throw GradleException("Release packaging refused: configure all four DAYMARK signing environment variables.")
 }
}
android {
 if (signingConfigured) {
  signingConfigs.create("provisionedRelease") {
   storeFile = file(signingValues.getValue("DAYMARK_KEYSTORE_PATH")!!)
   storePassword = signingValues.getValue("DAYMARK_KEYSTORE_PASSWORD")
   keyAlias = signingValues.getValue("DAYMARK_KEY_ALIAS")
   keyPassword = signingValues.getValue("DAYMARK_KEY_PASSWORD")
  }
  buildTypes.getByName("release").signingConfig = signingConfigs.getByName("provisionedRelease")
 }
 namespace = "com.everyonesoftware.daymark"
 compileSdk = 36
 buildToolsVersion = "36.0.0"
 defaultConfig { applicationId = "com.everyonesoftware.daymark"; minSdk = 26; targetSdk = 36; versionCode = 2; versionName = "0.2.0"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
 buildFeatures { compose = true; buildConfig = true }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }

 testOptions { unitTests.isReturnDefaultValues = true }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
 implementation("androidx.core:core-ktx:1.17.0")
 implementation("androidx.activity:activity-compose:1.11.0")
 implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.9.4")
 implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
 implementation(platform("androidx.compose:compose-bom:2025.11.01"))
 implementation("androidx.compose.material3:material3")
 implementation("androidx.compose.ui:ui-tooling-preview")
 implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
 implementation("com.squareup.okhttp3:okhttp:4.12.0")
 testImplementation("junit:junit:4.13.2")
 testImplementation("org.json:json:20240303")
 testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
 androidTestImplementation(platform("androidx.compose:compose-bom:2025.11.01"))
 androidTestImplementation("androidx.compose.ui:ui-test-junit4")
 androidTestImplementation("androidx.test.ext:junit:1.3.0")
 androidTestImplementation("androidx.test:runner:1.7.0")
 debugImplementation("androidx.compose.ui:ui-test-manifest")
}
