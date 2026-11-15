package com.everyonesoftware.daymark

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.lifecycle.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.File
import java.time.LocalDate

data class UiState(val snapshot: Snapshot=Snapshot(),val busy: Boolean=false,val order: List<String> = emptyList(),val baseUrl: String=DEFAULT_BASE_URL,val session: Session?=null,val settings: Boolean=false,val notice: String?=null,val installedName: String="",val installedCode: Long=0,val autoCheck: Boolean=true,val update: UpdateState=UpdateState())
class Actions(
 val onRefresh: ()->Unit={},val onNotNow: ()->Unit={},val onPick: (Occurrence)->Unit={},val onComplete: (Occurrence)->Unit={},val onUndo: (Occurrence)->Unit={},
 val onSave: (Task?,TaskDraft,()->Unit)->Unit={_,_,_->},val onArchive: (Task,()->Unit)->Unit={_,_->},val onConnection: (String)->Unit={},
 val onLogin: (String,String,String,Boolean)->Unit={_,_,_,_->},val onSettings: ()->Unit={},val onTest: ()->Unit={},val onSignOut: ()->Unit={},val onCheckUpdates: ()->Unit={},val onDownload: ()->Unit={},val onCancelDownload: ()->Unit={},val onInstall: ()->Unit={},val onAutoCheck: (Boolean)->Unit={}
)
class TasksViewModel(application: Application): AndroidViewModel(application) {
 private val records=AndroidRecords(application)
 private val manager=ConnectionManager(ProtectedSessionVault(records,KeystoreTokenCipher()),AuthApi())
 private val packages=AndroidPackages(application)
 private val updater=UpdateService(GithubTransport(),android.os.Build.VERSION.SDK_INT)
 private val updateDir=File(application.cacheDir,"updates")
 private var repository: TasksRepository?=null
 private var focus=FocusOrder()
 private var updateJob: Job?=null
 private var taskJob: Job?=null
 private val mutable=MutableStateFlow(UiState(session=manager.session,autoCheck=records.entries()["autoCheck"]!="false"))
 val state=mutable.asStateFlow()
 init {
  updateDir.deleteRecursively()
  manager.session?.let { if(validateBaseUrl(it.endpoint,BuildConfig.DEBUG)==null) manager.clear() else repository=TasksRepository(it.endpoint,MemoryStore(),it.token) }
  mutable.value=mutable.value.copy(session=manager.session)
  readInstalled()
  if(mutable.value.autoCheck) checkUpdates()
 }
 private fun readInstalled() { val info=packages.installedInfo();mutable.value=mutable.value.copy(installedName=info.versionName.orEmpty(),installedCode=packages.installed().versionCode) }
 private fun publish() {
  val snapshot=repository?.snapshot ?: Snapshot()
  if(snapshot.expired) { manager.clear();repository=null;focus=FocusOrder();discardDownload();mutable.value=mutable.value.copy(session=null,snapshot=Snapshot(),order=emptyList(),busy=false,notice="Your session expired. Sign in again.");return }
  val ids=snapshot.data?.today?.filterNot {it.completed}?.map {it.occurrenceId}.orEmpty()
  if(!snapshot.online) focus=FocusOrder()
  mutable.value=mutable.value.copy(snapshot=snapshot,busy=false,session=manager.session,baseUrl=manager.session?.endpoint.orEmpty(),order=focus.arrange(snapshot.data?.date ?: LocalDate.now().toString(),ids))
 }
 fun refresh() {
  readInstalled()
  if(mutable.value.busy || manager.session==null) return
  val repo=repository ?: return
  mutable.value=mutable.value.copy(busy=true)
  taskJob=viewModelScope.launch {try {repo.refresh(LocalDate.now().toString())} finally {publish()} }
 }
 private fun write(method: String,path: String,body: JSONObject?,success: ()->Unit={}) {
  val repo=repository ?: return
  if(mutable.value.busy || !repo.snapshot.online) return
  mutable.value=mutable.value.copy(busy=true)
  taskJob=viewModelScope.launch {try {if(repo.write(method,path,body,LocalDate.now().toString())) success()} finally {publish()} }
 }
 private fun occurrence(action: String,item: Occurrence)=write("POST","/api/occurrences/$action",JSONObject().put("taskId",item.taskId).put("dueDate",item.dueDate).put("date",LocalDate.now().toString()))
 private fun login(url: String,user: String,password: String,confirmed: Boolean) {
  if(mutable.value.busy || validateBaseUrl(url,BuildConfig.DEBUG)==null) return
  mutable.value=mutable.value.copy(busy=true,notice=null)
  taskJob=viewModelScope.launch {
   try {
    manager.connect(url,user,password,confirmed)
    discardDownload();focus=FocusOrder()
    val session=manager.session!!;repository=TasksRepository(session.endpoint,MemoryStore(),session.token)
    mutable.value=mutable.value.copy(session=session,snapshot=Snapshot(),order=emptyList(),settings=false,notice=null)
    repository!!.refresh(LocalDate.now().toString());publish()
   } catch(e: Exception) { if(e is CancellationException) throw e;mutable.value=mutable.value.copy(busy=false,notice=e.message?.takeIf {e is AuthFailure} ?: "Could not authenticate this connection. Saved connection is unchanged.") }
  }
 }
 private fun testConnection() {
  if(mutable.value.busy) return
  mutable.value=mutable.value.copy(busy=true,notice=null)
  taskJob=viewModelScope.launch {
   try {manager.test();repository?.refresh(LocalDate.now().toString());publish();mutable.value=mutable.value.copy(notice=if(mutable.value.snapshot.online) "Connection verified." else "Connection required.")}
   catch(e: Exception) {if(e is CancellationException) throw e;repository=null;focus=FocusOrder();if(e is AuthFailure && e.status==401) manager.clear();mutable.value=mutable.value.copy(session=manager.session,snapshot=Snapshot(),order=emptyList(),busy=false,notice=if(manager.session==null) "Your session expired. Sign in again." else "Connection required. Saved connection is unchanged.");manager.session?.let {repository=TasksRepository(it.endpoint,MemoryStore(),it.token)} }
  }
 }
 private fun signOut() {
  taskJob?.cancel();discardDownload();repository=null;focus=FocusOrder()
  val session=manager.session;manager.clear()
  mutable.value=mutable.value.copy(session=null,snapshot=Snapshot(),order=emptyList(),busy=false,notice=null)
  viewModelScope.launch {val revoked=session==null || runCatching {AuthApi().logout(session)}.isSuccess;if(!revoked) mutable.value=mutable.value.copy(notice="Signed out on this device. Remote revocation could not be confirmed.")}
 }
 private fun checkUpdates() {
  if(updateJob?.isActive==true) return
  mutable.value=mutable.value.copy(update=UpdateState(UpdateStatus.CHECKING))
  updateJob=viewModelScope.launch {mutable.value=mutable.value.copy(update=updater.check(packages.installed().versionCode))}
 }
 private fun cancelDownload() { discardDownload(userRequested=true) }
 private fun discardDownload(userRequested: Boolean=false) {
  val previous=mutable.value.update
  updateDir.deleteRecursively()
  if(previous.status !in setOf(UpdateStatus.DOWNLOADING,UpdateStatus.READY)) return
  updateJob?.cancel()
  mutable.value=mutable.value.copy(update=if(userRequested) UpdateState(UpdateStatus.CANCELLED,previous.release) else UpdateState())
 }
 private fun download() {
  if(updateJob?.isActive==true) return
  val release=mutable.value.update.release ?: return
  mutable.value=mutable.value.copy(update=UpdateState(UpdateStatus.DOWNLOADING,release))
  updateJob=viewModelScope.launch {
   try {updater.download(release,updateDir,packages.installed(),packages::inspect) {count -> mutable.value=mutable.value.copy(update=UpdateState(UpdateStatus.DOWNLOADING,release,count))};mutable.value=mutable.value.copy(update=UpdateState(UpdateStatus.READY,release,release.size))}
   catch(e: Exception) {if(e is CancellationException) throw e;mutable.value=mutable.value.copy(update=UpdateState(UpdateStatus.FAILED,error="Download or APK verification failed. Nothing was installed."))}
  }
 }
 private fun install() {
  if(mutable.value.update.status!=UpdateStatus.READY) return
  val file=File(updateDir,"Tasks.apk");val manifest=mutable.value.update.release?.manifest ?: return
  viewModelScope.launch {
   try {withContext(Dispatchers.IO) {val digest=java.security.MessageDigest.getInstance("SHA-256");file.inputStream().use {stream -> val buffer=ByteArray(16384);while(true) {val n=stream.read(buffer);if(n<0) break;digest.update(buffer,0,n)}};verifyApk(manifest,digest.digest().joinToString("") {"%02x".format(it)},packages.inspect(file),packages.installed())};packages.beginInstall(file)}
   catch(_: Exception) {updateDir.deleteRecursively();mutable.value=mutable.value.copy(update=UpdateState(UpdateStatus.FAILED,error="Installation could not be started safely."))}
  }
 }
 val actions=Actions(onRefresh=::refresh,onNotNow={if(!mutable.value.busy) {mutable.value.order.firstOrNull()?.let(focus::notNow);publish()}},onPick={if(!mutable.value.busy) {focus.pick(it.occurrenceId);publish()}},onComplete={occurrence("complete",it)},onUndo={occurrence("undo",it)},onSave={task,draft,success -> if(draft.error()==null) write(if(task==null) "POST" else "PUT",if(task==null) "/api/tasks" else "/api/tasks/${encode(task.id)}",draft.json(),success)},onArchive={task,success -> write("DELETE","/api/tasks/${encode(task.id)}",null,success)},onLogin=::login,onSettings={mutable.value=mutable.value.copy(settings=!mutable.value.settings)},onTest=::testConnection,onSignOut=::signOut,onCheckUpdates=::checkUpdates,onDownload=::download,onCancelDownload=::cancelDownload,onInstall=::install,onAutoCheck={enabled -> records.put("autoCheck",enabled.toString());mutable.value=mutable.value.copy(autoCheck=enabled)})
 private fun encode(value: String)=java.net.URLEncoder.encode(value,"UTF-8").replace("+","%20")
}
class MainActivity: ComponentActivity() {
 private lateinit var model: TasksViewModel
 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  enableEdgeToEdge(statusBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),navigationBarStyle=SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
  model=ViewModelProvider(this)[TasksViewModel::class.java]
  setContent {val state by model.state.collectAsStateWithLifecycle();TasksTheme {TasksApp(state,model.actions)}}
  lifecycleScope.launch {repeatOnLifecycle(Lifecycle.State.STARTED) {while(true) {delay(30_000);model.refresh()}}}
 }
 override fun onResume() {super.onResume();if(::model.isInitialized) model.refresh()}
}
