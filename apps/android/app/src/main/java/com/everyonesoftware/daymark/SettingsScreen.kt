package com.everyonesoftware.daymark

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable fun DaymarkApp(state: UiState,actions: Actions) {
 if(state.session==null) {
  Surface(Modifier.fillMaxSize()) {
   Column(Modifier.safeDrawingPadding().padding(24.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(20.dp)) {
    Text("daymark",style=MaterialTheme.typography.headlineLarge)
    Text("Connect your server.",style=MaterialTheme.typography.headlineLarge)
    Text("Sign in to the server where your tasks live.")
    CredentialForm(null,state.busy,state.notice,"Sign in",{url,user,password -> actions.onLogin(url,user,password,false) })
    Text("Use an HTTPS address and the account provided by your server administrator.")
    Text("Tasks stay on your server. This device keeps only the connection and a secure sign-in session.")
   }
  }
 } else if(state.settings) SettingsScreen(state,actions) else DaymarkScreen(state,actions)
}
@Composable private fun CredentialForm(session: Session?,busy: Boolean,error: String?,submit: String,onSubmit: (String,String,String)->Unit) {
 var url by remember { mutableStateOf(session?.endpoint.orEmpty()) }
 var user by remember { mutableStateOf(session?.username.orEmpty()) }
 var password by remember { mutableStateOf("") }
 var confirm by remember { mutableStateOf(false) }
 val endpoint=validateBaseUrl(url,BuildConfig.DEBUG)
 Column(verticalArrangement=Arrangement.spacedBy(14.dp)) {
  OutlinedTextField(url,{url=it},label={Text("Server URL")},placeholder={Text("https://tasks.example.net")},singleLine=true,enabled=!busy,modifier=Modifier.fillMaxWidth().testTag("server"))
  OutlinedTextField(user,{user=it},label={Text("Username")},singleLine=true,enabled=!busy,modifier=Modifier.fillMaxWidth().testTag("username"))
  OutlinedTextField(password,{password=it},label={Text("Password")},visualTransformation=PasswordVisualTransformation(),singleLine=true,enabled=!busy,modifier=Modifier.fillMaxWidth().testTag("password"))
  if(url.startsWith("http://")) Text(if(url.contains("hermesdan.tail1a7c8f.ts.net")) "Debug only: unencrypted HTTP over the trusted encrypted tailnet. Never use on the public Internet." else "Local development HTTP only. Use HTTPS in production.",color=MaterialTheme.colorScheme.error)
  if(error!=null) Text(error,color=MaterialTheme.colorScheme.error)
  Button(onClick={
   if(session!=null && (endpoint!=session.endpoint || !user.trim().equals(session.username,true))) confirm=true
   else { val secret=password;password="";onSubmit(endpoint!!,user.trim(),secret) }
  },enabled=!busy && endpoint!=null && Regex("[A-Za-z0-9._-]{1,64}").matches(user.trim()) && password.isNotEmpty(),modifier=Modifier.fillMaxWidth()) { Text(if(busy) "Connecting…" else submit) }
 }
 if(confirm) AlertDialog(onDismissRequest={confirm=false},title={Text("Switch connection?")},text={Text("You’re changing the server or account. Existing tasks stay on their original server. Nothing is moved or deleted.")},confirmButton={TextButton(onClick={confirm=false;val secret=password;password="";onSubmit(endpoint!!,user.trim(),secret)}) {Text("Test & switch")}},dismissButton={TextButton(onClick={confirm=false}) {Text("Go back")}})
}
@Composable private fun SettingsScreen(state: UiState,actions: Actions) {
 var edit by remember { mutableStateOf(false) }
 var logout by remember { mutableStateOf(false) }
 var review by remember { mutableStateOf(false) }
 Surface(Modifier.fillMaxSize()) {
  Column(Modifier.safeDrawingPadding().padding(22.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(18.dp)) {
   TextButton(onClick=actions.onSettings) { Text("Back to tasks") }
   Text("Settings",style=MaterialTheme.typography.headlineLarge)
   Text("Your connection and your app, in one place.")
   Card { Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
    Text("Connection",style=MaterialTheme.typography.titleLarge)
    Text("Server URL",style=MaterialTheme.typography.bodySmall); Text(state.session!!.endpoint)
    Text("Signed in as",style=MaterialTheme.typography.bodySmall);Text(state.session.username)
    Text(if(state.snapshot.online) "Connected" else "Connection required")
    if(state.notice!=null) Text(state.notice)
    Row { TextButton(onClick={edit=true},enabled=!state.busy) {Text("Edit connection")};TextButton(onClick=actions.onTest,enabled=!state.busy) {Text("Test")} }
    Text("All task data stays on the server. There’s no local task database on this device.")
    TextButton(onClick={logout=true},enabled=!state.busy) {Text("Sign out")}
   } }
   Card { Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
    Text("App updates",style=MaterialTheme.typography.titleLarge)
    Text("Installed version",style=MaterialTheme.typography.bodySmall)
    Text("${state.installedName} · Build ${state.installedCode}")
    val u=state.update
    Text(when(u.status) {
     UpdateStatus.IDLE -> "Check GitHub for a stable release."
     UpdateStatus.CHECKING -> "Checking GitHub…"
     UpdateStatus.NO_RELEASES -> "No published releases yet."
     UpdateStatus.FAILED -> u.error ?: "Couldn’t check GitHub. Installed version is unchanged."
     UpdateStatus.CURRENT -> "You’re up to date."
     UpdateStatus.AVAILABLE -> "Version ${u.release?.manifest?.versionName} available · Build ${u.release?.manifest?.versionCode}"
     UpdateStatus.DOWNLOADING -> "Downloading update… ${u.downloaded} / ${u.release?.size} bytes"
     UpdateStatus.READY -> "Verified update ready. Android will confirm installation."
     UpdateStatus.CANCELLED -> "Download cancelled."
    })
    u.release?.let { release ->
     if(u.status in setOf(UpdateStatus.AVAILABLE,UpdateStatus.DOWNLOADING,UpdateStatus.READY,UpdateStatus.CANCELLED)) {
      Button(onClick={review=true}) {Text("Review update")}
     }
    }
    TextButton(onClick=actions.onCheckUpdates,enabled=u.status !in setOf(UpdateStatus.CHECKING,UpdateStatus.DOWNLOADING)) {Text("Check for updates")}
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {Text("Check at app launch",modifier=Modifier.weight(1f));Switch(state.autoCheck,actions.onAutoCheck)}
    Text("Release source: github.com/everyonesoftware/tasks",style=MaterialTheme.typography.bodySmall)
    Text("Downloads and installation always need your confirmation.")
   } }
  }
 }
 if(review) androidx.compose.ui.window.Dialog(onDismissRequest={review=false},properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)) {
  Surface(Modifier.fillMaxSize()) {
   Column(Modifier.safeDrawingPadding().padding(22.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
    TextButton(onClick={review=false}) {Text("Back to Settings")}
    Text("App update",style=MaterialTheme.typography.headlineLarge)
    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(16.dp)) {
     Text("Installed: ${state.installedName} · Build ${state.installedCode}")
     state.update.release?.let {release ->
      Text("Available: ${release.manifest.versionName} · Build ${release.manifest.versionCode}",style=MaterialTheme.typography.titleLarge)
      Text("What’s new",style=MaterialTheme.typography.titleLarge)
      Text(release.notes.ifBlank {"No release notes supplied."})
     }
     state.update.error?.let {Text(it,color=MaterialTheme.colorScheme.error)}
     if(state.update.status==UpdateStatus.READY) Text("If Android asks for install-source permission, return here and tap Install update again. Starting the installer does not mean installation succeeded.")
    }
    when(state.update.status) {
     UpdateStatus.DOWNLOADING -> {
      Text("Downloading… ${state.update.downloaded} / ${state.update.release?.size} bytes")
      LinearProgressIndicator(progress={state.update.downloaded.toFloat()/(state.update.release?.size ?: 1)},modifier=Modifier.fillMaxWidth())
      TextButton(onClick=actions.onCancelDownload,modifier=Modifier.fillMaxWidth()) {Text("Cancel download")}
     }
     UpdateStatus.READY -> Button(onClick=actions.onInstall,modifier=Modifier.fillMaxWidth()) {Text("Install update")}
     UpdateStatus.AVAILABLE,UpdateStatus.CANCELLED -> Button(onClick=actions.onDownload,modifier=Modifier.fillMaxWidth()) {Text("Download update")}
     else -> TextButton(onClick=actions.onCheckUpdates) {Text("Check for updates")}
    }
   }
  }
 }
 if(edit) AlertDialog(onDismissRequest={if(!state.busy) edit=false},title={Text("Edit connection")},text={Column(Modifier.verticalScroll(rememberScrollState())) {Text("Re-enter your password. Test the new details before replacing your saved connection.");CredentialForm(state.session,state.busy,state.notice,"Test & save") {url,user,pw -> actions.onLogin(url,user,pw,true)} }},confirmButton={},dismissButton={TextButton(onClick={edit=false},enabled=!state.busy) {Text("Cancel")}})
 LaunchedEffect(state.session) {edit=false}
 if(logout) AlertDialog(onDismissRequest={logout=false},title={Text("Sign out here?")},text={Text("This removes the sign-in session from this device. Your tasks stay on the server.")},confirmButton={TextButton(onClick={logout=false;actions.onSignOut()}) {Text("Sign out")}},dismissButton={TextButton(onClick={logout=false}) {Text("Cancel")}})
}
