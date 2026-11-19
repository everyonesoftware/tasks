package com.everyonesoftware.daymark

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CurrentVersionPanelTest {
 @get:Rule val compose=createComposeRule()
 private val base=UiState(session=Session("https://example.org","Alice","fixture"),settings=true,installedName="127",installedCode=127,autoCheck=false)

 @Test fun currentCardHeaderAndActionFitNarrowPhoneAtLargeFont() {
  var checks=0
  var preferences=0
  compose.setContent {
   CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density,1.5f)) {
    Box(Modifier.width(320.dp)) { TasksTheme { TasksApp(base.copy(update=UpdateState(UpdateStatus.CURRENT)),Actions(onCheckUpdates={checks++},onAutoCheck={preferences++})) } }
   }
  }
  compose.onNodeWithTag("updates-status").performScrollTo()
  compose.onNodeWithText("Up to date").assertIsDisplayed()
  compose.onNodeWithText("No newer Android version is available.").assertIsDisplayed()
  compose.onNodeWithText("Current Version: 127").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Check now").assertIsDisplayed()
  val viewport=compose.onRoot().fetchSemanticsNode().boundsInRoot
  val heading=compose.onNodeWithText("Current Version: 127").fetchSemanticsNode().boundsInRoot
  val check=compose.onNodeWithText("Check now").fetchSemanticsNode().boundsInRoot
  for(bounds in listOf(heading,check)) {
   assertTrue("header controls stay within viewport",bounds.left>=viewport.left && bounds.right<=viewport.right && bounds.top>=viewport.top && bounds.bottom<=viewport.bottom)
  }
  assertTrue("heading must remain left of check",heading.right<=check.left)
  assertTrue("heading and check share a row",heading.top<check.bottom && check.top<heading.bottom)
  for(text in listOf("App updates","Installed version","127 · Build 127","Check at app launch","Release source: github.com/everyonesoftware/tasks","Downloads and installation always need your confirmation.")) compose.onNodeWithText(text).assertDoesNotExist()
  compose.onNodeWithText("Check now").performScrollTo().performClick()
  compose.runOnIdle { assertEquals(1,checks);assertEquals(0,preferences) }
 }

 @Test fun initialCheckingNoReleaseErrorAndCurrentRemainDistinctAcrossRecomposition() {
  var update by mutableStateOf(UpdateState())
  compose.setContent { TasksTheme { TasksApp(base.copy(update=update),Actions()) } }
  compose.onNodeWithText("Check whether a newer version is available.").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Up to date").assertDoesNotExist()
  compose.runOnIdle {update=UpdateState(UpdateStatus.CHECKING)}
  compose.onNodeWithText("Checking for updates").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Checking…").assertIsNotEnabled()
  compose.runOnIdle {update=UpdateState(UpdateStatus.NO_RELEASES)}
  compose.onNodeWithText("No published releases yet.").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Up to date").assertDoesNotExist()
  compose.runOnIdle {update=UpdateState(UpdateStatus.FAILED,error="Fixture network failure")}
  compose.onNodeWithText("Update failed").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Fixture network failure").assertIsDisplayed()
  compose.onNodeWithText("Check now").assertIsEnabled()
  compose.runOnIdle {update=UpdateState(UpdateStatus.CURRENT)}
  compose.onNodeWithText("Up to date").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Fixture network failure").assertDoesNotExist()
 }

 @Test fun downloadVerificationAndInstallationFailuresKeepTheirSpecificReason() {
  var update by mutableStateOf(UpdateState(UpdateStatus.FAILED,error="Download or APK verification failed. Nothing was installed."))
  compose.setContent { TasksTheme { TasksApp(base.copy(update=update),Actions()) } }
  compose.onNodeWithText("Update failed").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Download or APK verification failed. Nothing was installed.").assertIsDisplayed()
  compose.onNodeWithText("Couldn’t check for updates").assertDoesNotExist()
  compose.runOnIdle {update=UpdateState(UpdateStatus.FAILED,error="Installation could not be started safely.")}
  compose.onNodeWithText("Update failed").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Installation could not be started safely.").assertIsDisplayed()
  compose.onNodeWithText("Check now").assertIsEnabled()
  compose.onNodeWithText("Install update").assertDoesNotExist()
 }

 @Test fun reviewDownloadProgressAndInstallStayExplicit() {
  val manifest=ReleaseManifest("128",128,26,"Tasks.apk","a".repeat(64))
  val release=Release(manifest,"https://github.com/everyonesoftware/tasks/releases/download/v128/Tasks.apk",100,"Fixture release notes")
  var update by mutableStateOf(UpdateState(UpdateStatus.AVAILABLE,release))
  var downloads=0;var installs=0;var cancels=0
  compose.setContent { TasksTheme { TasksApp(base.copy(update=update),Actions(onDownload={downloads++},onInstall={installs++},onCancelDownload={cancels++})) } }
  compose.onNodeWithText("Update available").performScrollTo().assertIsDisplayed()
  compose.onNodeWithText("Tasks 128").assertIsDisplayed()
  compose.onNodeWithText("Install update").assertDoesNotExist()
  compose.onNodeWithText("Review update").performScrollTo().performClick()
  compose.onNodeWithText("Fixture release notes").assertIsDisplayed()
  compose.runOnIdle {assertEquals(0,downloads);assertEquals(0,installs)}
  compose.onNodeWithText("Download update").performClick()
  compose.runOnIdle {assertEquals(1,downloads);update=UpdateState(UpdateStatus.DOWNLOADING,release,50)}
  compose.onNodeWithText("Downloading… 50 / 100 bytes").assertIsDisplayed()
  compose.onNodeWithText("Install update").assertDoesNotExist()
  compose.onNodeWithText("Cancel download").performClick()
  compose.runOnIdle {assertEquals(1,cancels);update=UpdateState(UpdateStatus.READY,release,100)}
  compose.onNodeWithText("Install update").assertIsEnabled().performClick()
  compose.runOnIdle {assertEquals(1,installs)}
 }
}
