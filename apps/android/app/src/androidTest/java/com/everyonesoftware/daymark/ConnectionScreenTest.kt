package com.everyonesoftware.daymark
import androidx.compose.ui.test.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
class ConnectionScreenTest {
 @get:Rule val compose=createComposeRule()
 @Test fun firstInstallBlankAndNoTaskAccess() {
  compose.setContent { TasksTheme { TasksApp(UiState(),Actions()) } }
  compose.onNodeWithTag("server").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText,AnnotatedString("")))
  compose.onNodeWithTag("username").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText,AnnotatedString("")))
  compose.onNodeWithTag("password").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText,AnnotatedString("")))
  compose.onNodeWithText("Sign in").assertIsNotEnabled()
  compose.onNodeWithText("Add task").assertDoesNotExist()
 }
 @Test fun loginOnlySubmitsExplicitCredentials() {
  var credentials=""
  compose.setContent { TasksTheme { TasksApp(UiState(),Actions(onLogin={url,user,pw,_ -> credentials="$url|$user|$pw"})) } }
  compose.onNodeWithTag("server").performTextInput("https://example.org")
  compose.onNodeWithTag("username").performTextInput("alice")
  compose.onNodeWithTag("password").performTextInput(" secret ")
  compose.onNodeWithText("Sign in").performScrollTo().performClick()
  compose.runOnIdle { assertEquals("https://example.org|alice| secret ",credentials) }
 }
 @Test fun settingsPanelsInstalledVersionAndSwitchConfirmation() {
  var switched=false
  compose.setContent { TasksTheme { TasksApp(UiState(session=Session("https://example.org","Alice","token"),settings=true,installedName="0.2.0",installedCode=2),Actions(onLogin={_,_,_,_ -> switched=true})) } }
  compose.onNodeWithText("Connection").assertExists()
  compose.onNodeWithText("App updates").performScrollTo().assertExists()
  compose.onNodeWithText("0.2.0 · Build 2").assertExists()
  compose.onNodeWithText("Edit connection").performScrollTo().performClick()
  compose.onNodeWithTag("server").performTextReplacement("https://new.example.org")
  compose.onNodeWithTag("password").performTextInput("password")
  compose.onNodeWithText("Test & save").performScrollTo().performClick()
  compose.onNodeWithText("Switch connection?").assertExists()
  compose.runOnIdle { assertFalse(switched) }
  compose.onNodeWithText("Test & switch").performClick()
  compose.runOnIdle { assertTrue(switched) }
 }
 @Test fun updateReviewRequiresExplicitDownload() {
  var downloads=0
  val manifest=ReleaseManifest("0.3.0",3,26,"Tasks.apk","a".repeat(64))
  val update=UpdateState(UpdateStatus.AVAILABLE,Release(manifest,"https://github.com/everyonesoftware/tasks/releases/download/v3/Tasks.apk",4,"Fixture release notes"))
  compose.setContent { TasksTheme { TasksApp(UiState(session=Session("https://example.org","Alice","token"),settings=true,update=update),Actions(onDownload={downloads++})) } }
  compose.onNodeWithText("Download update").assertDoesNotExist()
  compose.onNodeWithText("Review update").performScrollTo().performClick()
  compose.onNodeWithText("Fixture release notes").assertIsDisplayed()
  compose.runOnIdle { assertEquals(0,downloads) }
  compose.onNodeWithText("Download update").performClick()
  compose.runOnIdle { assertEquals(1,downloads) }
 }
 @Test fun update404IsNotFailedAndDownloadIsUserAction() {
  compose.setContent { TasksTheme { TasksApp(UiState(session=Session("https://example.org","Alice","token"),settings=true,update=UpdateState(UpdateStatus.NO_RELEASES)),Actions()) } }
  compose.onNodeWithText("No published releases yet.").performScrollTo().assertExists()
  compose.onNodeWithText("Install update").assertDoesNotExist()
 }
}
