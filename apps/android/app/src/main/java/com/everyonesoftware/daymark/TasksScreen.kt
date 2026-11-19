package com.everyonesoftware.daymark

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val Slate = Color(0xFF202B30)
private val Panel = Color(0xFF2B393F)
private val Mint = Color(0xFFBEDFC7)
private val Muted = Color(0xFFA4B4B4)
private val Focus = Color(0xFF30453E)
private val Ink = Color(0xFFEDF2ED)

@Composable fun TasksTheme(content: @Composable () -> Unit) {
 MaterialTheme(colorScheme=darkColorScheme(primary=Mint,onPrimary=Color(0xFF1F392B),background=Slate,onBackground=Ink,surface=Panel,onSurface=Ink,surfaceVariant=Color(0xFF344B41),onSurfaceVariant=Muted,outline=Color(0xFF647579)),
  typography=Typography(bodyLarge=TextStyle(fontSize=16.sp,lineHeight=24.sp),bodyMedium=TextStyle(fontSize=16.sp,lineHeight=24.sp),bodySmall=TextStyle(fontSize=14.sp,lineHeight=21.sp),labelLarge=TextStyle(fontSize=16.sp,lineHeight=22.sp,fontWeight=FontWeight.Medium),labelMedium=TextStyle(fontSize=14.sp,lineHeight=20.sp),headlineLarge=TextStyle(fontSize=32.sp,lineHeight=39.sp,fontFamily=FontFamily.Serif),titleLarge=TextStyle(fontSize=18.sp,lineHeight=26.sp,fontWeight=FontWeight.Medium)),content=content)
}
private fun schedule(repeat: String, interval: Int): String = when(repeat) {
 "once" -> "One time"
 "daily" -> if(interval==1) "Every day" else "Every $interval days"
 "weekly" -> if(interval==1) "Every week" else "Every $interval weeks"
 "monthly" -> if(interval==1) "Every month" else "Every $interval months"
 "yearly" -> if(interval==1) "Every year" else "Every $interval years"
 else -> repeat
}

@Composable fun TasksScreen(state: UiState, actions: Actions, completedSection: MutableState<Boolean>? = null) {
 // Deliberately memory-only: task IDs, editor fields and list position are never saveable.
 key(state.session?.endpoint,state.session?.username,state.session?.token) {
  var page by remember { mutableStateOf("Today") }
  var selectedId by remember { mutableStateOf<String?>(null) }
  var occurrenceId by remember { mutableStateOf<String?>(null) }
  var editor by remember { mutableStateOf(false) }
  var original by remember { mutableStateOf<Task?>(null) }
  var draft by remember { mutableStateOf(TaskDraft()) }
  var archiving by remember { mutableStateOf<Task?>(null) }
  var createSubmitted by remember { mutableStateOf(false) }
  val pendingCreate=editor && original==null && createSubmitted && state.savedTaskId!=null
  val data=state.snapshot.data.takeIf { state.snapshot.online }
  val writable=state.snapshot.online && !state.busy && data?.date==LocalDate.now().toString()
  val expanded=completedSection ?: remember(data?.date) { mutableStateOf(true) }
  val listState=rememberLazyListState()
  val incomplete=data?.today?.filterNot { it.completed }.orEmpty()
  val waiting=state.order.mapNotNull { id -> incomplete.find { it.occurrenceId==id } } + incomplete.filter { it.occurrenceId !in state.order }
  val current=waiting.firstOrNull()
  val task=data?.tasks?.find { it.id==selectedId }
  fun open(id: String, occurrence: String?=null) { selectedId=id;occurrenceId=occurrence }
  fun edit(value: Task?) {
   if(value==null) actions.onFinishCreateEditor()
   createSubmitted=false
   original=value
   draft=value?.let { TaskDraft(it.title,it.notes,it.category,it.repeat,it.interval.toString(),it.startDate,it.priority) } ?: TaskDraft()
   editor=true
  }
  fun back() { if(!state.busy) { if(editor) { if(original==null) actions.onFinishCreateEditor();createSubmitted=false;editor=false;original=null;draft=TaskDraft() } else { selectedId=null;occurrenceId=null } } }
  BackHandler(enabled=editor || selectedId!=null) { back() }
  LaunchedEffect(data,pendingCreate,state.savedTaskId) {
   if(pendingCreate && data?.tasks?.find {it.id==state.savedTaskId}!=null) {
    selectedId=state.savedTaskId;occurrenceId=null
    editor=false;original=null;draft=TaskDraft();createSubmitted=false
    actions.onFinishCreateEditor()
   }
  }
  if(editor || selectedId!=null) {
   Surface(Modifier.fillMaxSize().safeDrawingPadding(),color=Slate) {
    if(editor) TaskEditorPage(original,draft,{draft=it},state.busy,state.editorBusy,writable && !pendingCreate && (original==null || task!=null),state.snapshot.error,pendingCreate,onRefresh=actions.onRefresh,onDismiss=::back,onSave={ value ->
     if(original==null) createSubmitted=true
     actions.onSave(original,value) {
      if(original!=null) {occurrenceId=null;editor=false;original=null;draft=TaskDraft()}
     }
    }) else TaskDetailsPage(task,data,occurrenceId,writable,current?.taskId==selectedId,state.busy,state.snapshot.error,page,onBack=::back,onEdit={task?.let { edit(it) }},onArchive={archiving=task},actions=actions)
   }
  } else Scaffold(containerColor=Slate,contentWindowInsets=WindowInsets.safeDrawing,bottomBar={
   NavigationBar(containerColor=Color(0xFF192328)) {
    listOf("Today" to "◉","Upcoming" to "▦","Routines" to "↻","Settings" to "⚙").forEach { (label,symbol) ->
     NavigationBarItem(selected=page==label,onClick={if(label=="Settings") actions.onSettings() else page=label},icon={Text(symbol,fontSize=22.sp)},label={Text(label,fontSize=14.sp)},colors=NavigationBarItemDefaults.colors(selectedIconColor=Mint,selectedTextColor=Mint,indicatorColor=Color(0xFF344B41),unselectedIconColor=Muted,unselectedTextColor=Muted))
    }
   }
  }) { padding ->
   LazyColumn(Modifier.fillMaxSize().padding(padding),state=listState,contentPadding=PaddingValues(22.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
    item {
     Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
      Text("Tasks",fontFamily=FontFamily.Serif,fontSize=28.sp,modifier=Modifier.weight(1f))
      TextButton(onClick=actions.onSettings,enabled=!state.busy) { Text("Settings") }
     }
     Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) { TextButton(onClick={edit(null)},enabled=writable) { Text("Add task") } }
    }
    if(state.busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
    if(!writable && !state.busy || state.snapshot.error!=null) item {
     Column {
      Text(state.snapshot.error ?: "Connection required",color=Mint)
      TextButton(onClick=actions.onRefresh,enabled=!state.busy) { Text("Refresh") }
     }
    }
    item {
     Text(when(page) {"Today"->"One thing at a time.";"Upcoming"->"Not for today.";else->"Your routines."},style=MaterialTheme.typography.headlineLarge)
     if(page=="Today") Text(runCatching { LocalDate.parse(data?.date ?: LocalDate.now().toString()).format(DateTimeFormatter.ofPattern("EEEE, MMMM d")) }.getOrDefault(""),color=Muted)
    }
    if(data!=null) when(page) {
     "Today" -> {
      item {
       Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
        Text("Today’s progress",style=MaterialTheme.typography.bodySmall)
        Text("${data.completed} of ${data.total} complete",style=MaterialTheme.typography.bodySmall,color=Muted)
       }
       LinearProgressIndicator(progress={if(data.total==0) 0f else data.completed.toFloat()/data.total},modifier=Modifier.fillMaxWidth().padding(top=10.dp).height(7.dp),color=Mint,trackColor=Color(0xFF3B4B50))
      }
      item {
       if(current==null) Surface(color=Focus,shape=RoundedCornerShape(14.dp)) {
        Column(Modifier.fillMaxWidth().padding(24.dp)) {
         Text(if(data.today.isEmpty()) "Nothing due today" else "Today, complete",style=MaterialTheme.typography.headlineLarge)
         Text(if(data.today.isEmpty()) "Add a task when you’re ready." else "You’ve made room for the rest of your day.")
        }
       } else CurrentTask(current,waiting.size>1,writable,actions,onOpen={open(current.taskId,current.occurrenceId)})
      }
      if(waiting.size>1) item { Text("STILL TO COME",style=MaterialTheme.typography.bodySmall,color=Muted) }
      items(waiting.drop(1),key={it.occurrenceId}) { item -> TaskRow(item.title,schedule(item.repeat,item.interval)+(if(item.overdue) " · Overdue ${item.dueDate}" else "")) {open(item.taskId,item.occurrenceId)} }
      val done=data.today.filter {it.completed}
      if(done.isNotEmpty()) item { TextButton(onClick={expanded.value=!expanded.value},modifier=Modifier.fillMaxWidth().semantics {stateDescription=if(expanded.value) "Expanded" else "Collapsed"}) {Text("Completed today (${done.size})")} }
      if(expanded.value) items(done,key={"done:${it.occurrenceId}"}) { item -> TaskRow(item.title,"Completed · ${item.dueDate}") {open(item.taskId,item.occurrenceId)} }
     }
     "Upcoming" -> {
      if(data.upcoming.isEmpty()) item {Text("No upcoming tasks",color=Muted)}
      items(data.upcoming,key={it.occurrenceId}) {item -> TaskRow(item.title,"${item.dueDate} · ${schedule(item.repeat,item.interval)}") {open(item.taskId,item.occurrenceId)} }
     }
     "Routines" -> {
      if(data.tasks.isEmpty()) item {Text("No tasks yet",color=Muted)}
      items(data.tasks,key={it.id}) {item -> TaskRow(item.title,"${schedule(item.repeat,item.interval)} · Starts ${item.startDate}") {open(item.id)} }
     }
    }
    if(state.snapshot.online) item {TextButton(onClick=actions.onRefresh,enabled=!state.busy) {Text("Refresh")} }
   }
  }
  archiving?.let { value ->
   AlertDialog(onDismissRequest={if(!state.busy) archiving=null},title={Text("Archive task?")},text={Column {Text("“${value.title}” will leave your active lists. Completion history is retained.");state.snapshot.error?.let {Text(it,color=MaterialTheme.colorScheme.error)}}},
    confirmButton={TextButton(onClick={actions.onArchive(value) {archiving=null;selectedId=null}},enabled=writable && task!=null) {Text("Archive")}},
    dismissButton={TextButton(onClick={archiving=null},enabled=!state.busy) {Text("Cancel")}})
  }
 }
}

@Composable private fun TaskRow(title: String, metadata: String, onOpen: ()->Unit) {
 Column(Modifier.fillMaxWidth().clickable(onClick=onOpen).padding(vertical=12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
  Text(title,style=MaterialTheme.typography.titleLarge)
  Text(metadata,style=MaterialTheme.typography.bodySmall,color=Muted)
  HorizontalDivider(color=Color(0xFF3B4B50),modifier=Modifier.padding(top=10.dp))
 }
}
@Composable private fun CurrentTask(item: Occurrence, canSkip: Boolean, writable: Boolean, actions: Actions, onOpen: ()->Unit) {
 var menu by remember(item.occurrenceId) {mutableStateOf(false)}
 Surface(color=Focus,shape=RoundedCornerShape(14.dp)) {
  Column(Modifier.fillMaxWidth().padding(22.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
   Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
    Text("CURRENT TASK",color=Mint,style=MaterialTheme.typography.bodySmall,modifier=Modifier.weight(1f))
    Box {
     IconButton(onClick={menu=true},enabled=writable,modifier=Modifier.semantics {contentDescription="Current task options"}) {Text("⋮",fontSize=28.sp)}
     DropdownMenu(expanded=menu && writable,onDismissRequest={menu=false}) {
      DropdownMenuItem(text={Text("Not now")},onClick={menu=false;actions.onNotNow()},enabled=canSkip)
     }
    }
   }
   Text(item.title,style=MaterialTheme.typography.headlineLarge,modifier=Modifier.fillMaxWidth().clickable(onClick=onOpen).padding(vertical=8.dp))
   Text("View task →",color=Mint,style=MaterialTheme.typography.bodySmall)
   Text(schedule(item.repeat,item.interval),style=MaterialTheme.typography.bodySmall,color=Muted)
   if(item.overdue) Text("Overdue · ${item.dueDate}",style=MaterialTheme.typography.bodySmall,color=Mint)
   Row(Modifier.fillMaxWidth().padding(top=14.dp),horizontalArrangement=Arrangement.End) {Button(onClick={actions.onComplete(item)},enabled=writable,shape=RoundedCornerShape(8.dp),modifier=Modifier.heightIn(min=48.dp)) {Text("Mark done")} }
  }
 }
}

@Composable private fun TaskDetailsPage(task: Task?, data: DayState?, selectedOccurrence: String?, writable: Boolean, current: Boolean, busy: Boolean, error: String?, origin: String, onBack: ()->Unit, onEdit: ()->Unit, onArchive: ()->Unit, actions: Actions) {
 Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp),verticalArrangement=Arrangement.spacedBy(18.dp)) {
  Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
   TextButton(onClick=onBack,enabled=!busy) {Text("← $origin")}
   Text("Task details",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
   TextButton(onClick=onEdit,enabled=writable && task!=null,modifier=Modifier.semantics {contentDescription="Edit task"}) {Text("✎ Edit")}
  }
  if(busy) LinearProgressIndicator(Modifier.fillMaxWidth())
  if(task==null) Text(error ?: "Task is no longer available. Refresh to reconnect.") else {
   Text(task.title,style=MaterialTheme.typography.headlineLarge)
   Text(schedule(task.repeat,task.interval),color=Mint)
   Text("Starts ${task.startDate}",color=Muted)
   val occurrence=data?.detailsOccurrence(task.id,selectedOccurrence,origin)
   if(occurrence!=null) Text("${if(occurrence.overdue) "Overdue" else "Due"} ${occurrence.dueDate}",color=Muted)
   Text("History",style=MaterialTheme.typography.titleLarge)
   if(task.createdAt.isNotBlank()) Text("Created ${task.createdAt}",style=MaterialTheme.typography.bodySmall,color=Muted)
   val available=data?.today.orEmpty().filter {it.taskId==task.id && it.completed}
   available.forEach {Text("Completed ${it.completedAt ?: "occurrence due ${it.dueDate}"}",style=MaterialTheme.typography.bodySmall)}
   Text("Only history available in the current server snapshot is shown. Full completion history is not available here.",style=MaterialTheme.typography.bodySmall,color=Muted)
   error?.let {Text(it,color=MaterialTheme.colorScheme.error)}
   if(occurrence!=null && occurrence.dueDate<=data!!.date) {
    if(occurrence.completed) OutlinedButton(onClick={actions.onUndo(occurrence)},enabled=writable) {Text("Undo completion")}
    else {
     if(current) Text("Current task",color=Mint) else OutlinedButton(onClick={actions.onPick(occurrence)},enabled=writable) {Text("Make current")}
     Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) {Button(onClick={actions.onComplete(occurrence)},enabled=writable) {Text("Mark done")} }
    }
   }
   TextButton(onClick=onArchive,enabled=writable) {Text("Archive task")}
  }
  if(!writable) TextButton(onClick=actions.onRefresh,enabled=!busy) {Text("Refresh")}
 }
}

@Composable private fun TaskEditorPage(task: Task?, draft: TaskDraft, update: (TaskDraft)->Unit, busy: Boolean, fieldBusy: Boolean, writable: Boolean, networkError: String?, pendingCreate: Boolean, onRefresh: ()->Unit, onDismiss: ()->Unit, onSave: (TaskDraft)->Unit) {
 var submitted by remember {mutableStateOf(false)}
 Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(22.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
  TextButton(onClick=onDismiss,enabled=!busy) {Text(if(task==null) "← Back" else "← Task details")}
  Text(if(task==null) "New task" else "Edit task",style=MaterialTheme.typography.headlineLarge)
  OutlinedTextField(draft.title,{update(draft.copy(title=it.take(200)))},label={Text("Task name")},modifier=Modifier.fillMaxWidth(),enabled=!fieldBusy && !pendingCreate,singleLine=true)
  ChoiceField("Repeat",schedule(draft.repeat,1),listOf("once","daily","weekly","monthly","yearly").map {it to schedule(it,1)},!fieldBusy && !pendingCreate) {update(draft.copy(repeat=it,interval=if(it=="once") "1" else draft.interval))}
  if(draft.repeat!="once") OutlinedTextField(draft.interval,{update(draft.copy(interval=it))},label={Text("Repeat interval (1–365)")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),modifier=Modifier.fillMaxWidth(),enabled=!fieldBusy && !pendingCreate,singleLine=true)
  OutlinedTextField(draft.startDate,{update(draft.copy(startDate=it))},label={Text("Start date (YYYY-MM-DD)")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Ascii),modifier=Modifier.fillMaxWidth(),enabled=!fieldBusy && !pendingCreate,singleLine=true)
  Text(if(task==null) "A task name and a schedule." else "Changes apply to the entire task schedule, not just this occurrence. Previous completions are retained.",style=MaterialTheme.typography.bodySmall,color=Muted)
  if(submitted) draft.error()?.let {Text(it,color=MaterialTheme.colorScheme.error)}
  networkError?.let {Text(it,color=MaterialTheme.colorScheme.error)}
  if(pendingCreate) Text("Created task is not available. Retry refresh or return to the list.",color=Mint)
  if(pendingCreate || networkError!=null) TextButton(onClick=onRefresh,enabled=!busy) {Text("Refresh")}
  if(!writable && networkError==null && !busy) Text("Connection required. Your unsaved changes stay here until you leave.",color=Mint)
  if(busy) LinearProgressIndicator(Modifier.fillMaxWidth())
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End,verticalAlignment=Alignment.CenterVertically) {
   TextButton(onClick=onDismiss,enabled=!busy) {Text("Cancel")}
   Button(onClick={submitted=true;if(draft.error()==null) onSave(draft)},enabled=writable) {Text(if(task==null) "Add task" else "Save changes")}
  }
 }
}
@Composable private fun ChoiceField(label: String, value: String, choices: List<Pair<String,String>>, enabled: Boolean, onChoose: (String)->Unit) {
 var open by remember {mutableStateOf(false)}
 Column {
  Text(label,style=MaterialTheme.typography.bodySmall,color=Muted)
  Box {
   OutlinedButton(onClick={open=true},enabled=enabled,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text(value)}
   DropdownMenu(expanded=open,onDismissRequest={open=false}) {choices.forEach {(key,text)->DropdownMenuItem(text={Text(text)},onClick={open=false;onChoose(key)})}}
  }
 }
}
