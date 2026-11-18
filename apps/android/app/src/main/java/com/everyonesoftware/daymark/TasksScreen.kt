package com.everyonesoftware.daymark

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val Slate = Color(0xFF202B30)
private val Panel = Color(0xFF2B393F)
private val Mint = Color(0xFFBEDFC7)
private val Muted = Color(0xFFA4B4B4)
private val Focus = Color(0xFF30453E)
private val Ink = Color(0xFFEDF2ED)

@Composable fun TasksTheme(content: @Composable () -> Unit) {
 MaterialTheme(
  colorScheme=darkColorScheme(primary=Mint, onPrimary=Color(0xFF1F392B), background=Slate, onBackground=Ink, surface=Panel, onSurface=Ink, surfaceVariant=Color(0xFF344B41), onSurfaceVariant=Muted, outline=Color(0xFF647579)),
  typography=Typography(
   bodyLarge=TextStyle(fontSize=16.sp, lineHeight=24.sp),
   bodyMedium=TextStyle(fontSize=16.sp, lineHeight=24.sp),
   bodySmall=TextStyle(fontSize=14.sp, lineHeight=21.sp),
   labelLarge=TextStyle(fontSize=16.sp, lineHeight=22.sp, fontWeight=FontWeight.Medium),
   labelMedium=TextStyle(fontSize=14.sp, lineHeight=20.sp),
   headlineLarge=TextStyle(fontSize=32.sp, lineHeight=39.sp, fontFamily=FontFamily.Serif),
   titleLarge=TextStyle(fontSize=18.sp, lineHeight=26.sp, fontWeight=FontWeight.Medium)
  ), content=content
 )
}

private fun schedule(repeat: String, interval: Int): String = when(repeat) {
 "once" -> "One time"
 "daily" -> if(interval == 1) "Every day" else "Every $interval days"
 "weekly" -> if(interval == 1) "Every week" else "Every $interval weeks"
 "monthly" -> if(interval == 1) "Every month" else "Every $interval months"
 "yearly" -> if(interval == 1) "Every year" else "Every $interval years"
 else -> repeat
}

@Composable fun TasksScreen(state: UiState, actions: Actions, completedSection: MutableState<Boolean>? = null) {
 var page by rememberSaveable { mutableStateOf("Today") }
 var formOpen by rememberSaveable { mutableStateOf(false) }
 var editing by remember { mutableStateOf<Task?>(null) }
 var archiving by remember { mutableStateOf<Task?>(null) }
 val data = if(state.snapshot.online) state.snapshot.data else null
 val writable = state.snapshot.online && !state.busy && data?.date == LocalDate.now().toString()
 val expandedState: MutableState<Boolean> = completedSection ?: remember(data?.date, state.session?.endpoint, state.session?.username) { mutableStateOf(true) }
 var completedExpanded by expandedState
 val incomplete = data?.today?.filterNot { it.completed }.orEmpty()
 val waiting = if (state.order.isEmpty()) incomplete else state.order.mapNotNull { id -> incomplete.find { it.occurrenceId == id } } + incomplete.filter { it.occurrenceId !in state.order }
 val current = waiting.firstOrNull()
 Scaffold(
  containerColor=Slate,
  contentWindowInsets=WindowInsets.safeDrawing,
  bottomBar={
   NavigationBar(containerColor=Color(0xFF192328), windowInsets=NavigationBarDefaults.windowInsets) {
    listOf("Today" to "◉", "Upcoming" to "▦", "Routines" to "↻", "Settings" to "⚙").forEach { (label, symbol) ->
     NavigationBarItem(selected=page==label, onClick={ if(label=="Settings") actions.onSettings() else page=label }, icon={ Text(symbol, fontSize=22.sp) }, label={ Text(label, fontSize=14.sp) }, colors=NavigationBarItemDefaults.colors(selectedIconColor=Mint, selectedTextColor=Mint, indicatorColor=Color(0xFF344B41), unselectedIconColor=Muted, unselectedTextColor=Muted))
    }
   }
  }
 ) { padding ->
  LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding=PaddingValues(start=22.dp, end=22.dp, top=12.dp, bottom=28.dp), verticalArrangement=Arrangement.spacedBy(20.dp)) {
   item {
    Row(Modifier.fillMaxWidth(), verticalAlignment=Alignment.CenterVertically) {
     Text("Tasks", fontFamily=FontFamily.Serif, fontSize=28.sp, modifier=Modifier.weight(1f))
     TextButton(onClick=actions.onSettings, enabled=!state.busy) { Text("Settings", fontSize=16.sp) }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.End) {
     TextButton(onClick={ editing=null; formOpen=true }, enabled=writable) { Text("Add task", fontSize=16.sp) }
    }
   }
   if(state.busy) item {
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
     LinearProgressIndicator(Modifier.fillMaxWidth())
     Text(if(data==null) "Loading Tasks…" else "Syncing…", style=MaterialTheme.typography.bodySmall, color=Muted)
    }
   }
   if(!state.snapshot.online || state.snapshot.error != null || (data != null && data.date != LocalDate.now().toString())) item {
    Surface(color=Panel, shape=RoundedCornerShape(12.dp)) {
     Column(Modifier.padding(16.dp), verticalArrangement=Arrangement.spacedBy(6.dp)) {
      Text(state.snapshot.error ?: if(data==null) "Not connected" else "Connection required", color=Mint)
      if(data!=null) Text("Refresh to enable changes.", style=MaterialTheme.typography.bodySmall, color=Muted)
      else Text("Connect to your Tasks server to load your tasks.", style=MaterialTheme.typography.bodySmall, color=Muted)
      TextButton(onClick=actions.onRefresh, enabled=!state.busy) { Text("Refresh", fontSize=16.sp) }
     }
    }
   }
   item {
    Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
     Text(when(page) { "Today" -> "One thing at a time."; "Upcoming" -> "Not for today."; else -> "Your routines." }, style=MaterialTheme.typography.headlineLarge)
     if(page=="Today") {
      Text(runCatching { LocalDate.parse(data?.date ?: LocalDate.now().toString()).format(DateTimeFormatter.ofPattern("EEEE, MMMM d")) }.getOrDefault(data?.date.orEmpty()), color=Muted)
     }
    }
   }
   if(data != null) {
    when(page) {
     "Today" -> {
      item {
       Column(verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.SpaceBetween) {
         Text("Today’s progress", style=MaterialTheme.typography.bodySmall, fontWeight=FontWeight.Medium)
         Text("${data.completed} of ${data.total} complete", style=MaterialTheme.typography.bodySmall, color=Muted)
        }
        LinearProgressIndicator(progress={ if(data.total==0) 0f else data.completed.toFloat()/data.total }, modifier=Modifier.fillMaxWidth().height(7.dp), color=Mint, trackColor=Color(0xFF3B4B50))
       }
      }
      item {
       if(current==null) {
        Surface(color=Focus, shape=RoundedCornerShape(14.dp)) {
         Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement=Arrangement.spacedBy(14.dp)) {
          Text(if(data.today.isEmpty()) "Nothing due today" else "Today, complete", style=MaterialTheme.typography.headlineLarge)
          Text(if(data.today.isEmpty()) "Add a task when you’re ready." else "You’ve made room for the rest of your day.")
         }
        }
       } else CurrentTask(current, waiting.size>1 && writable, writable, actions, data.tasks.find { it.id==current.taskId }, onEdit={ editing=it; formOpen=true }, onArchive={ archiving=it })
      }
      if(waiting.size>1) item { Text("STILL TO COME", style=MaterialTheme.typography.bodySmall, color=Muted) }
      items(waiting.drop(1), key={ it.occurrenceId }) { item ->
       var open by remember(item.occurrenceId) { mutableStateOf(false) }
       Box {
        Column(Modifier.fillMaxWidth().clickable(enabled=writable) { open=true }.padding(vertical=12.dp), verticalArrangement=Arrangement.spacedBy(6.dp)) {
         Row(Modifier.fillMaxWidth(), verticalAlignment=Alignment.CenterVertically) {
          Text(item.title, style=MaterialTheme.typography.titleLarge, modifier=Modifier.weight(1f))
          TaskOptions(data.tasks.find { it.id==item.taskId }, writable, onEdit={ editing=it; formOpen=true }, onArchive={ archiving=it })
         }
         Text("${schedule(item.repeat,item.interval)} · ${item.category}${if(item.overdue) " · Overdue ${item.dueDate}" else ""}", style=MaterialTheme.typography.bodySmall, color=Muted)
         HorizontalDivider(color=Color(0xFF3B4B50), modifier=Modifier.padding(top=10.dp))
        }
        DropdownMenu(expanded=open && writable, onDismissRequest={ open=false }) {
         DropdownMenuItem(text={ Text("Make current") }, onClick={ open=false; actions.onPick(item) })
         DropdownMenuItem(text={ Text("Mark done") }, onClick={ open=false; actions.onComplete(item) })
        }
       }
      }
      val done = data.today.filter { it.completed }
      if(done.isNotEmpty()) item {
       TextButton(onClick={ completedExpanded=!completedExpanded }, modifier=Modifier.fillMaxWidth().semantics { stateDescription=if(completedExpanded) "Expanded" else "Collapsed" }) {
        Text("Completed today (${done.size})", modifier=Modifier.weight(1f), style=MaterialTheme.typography.bodySmall, color=Muted)
        Text(if(completedExpanded) "⌃" else "⌄", color=Muted)
       }
      }
      if(completedExpanded) items(done, key={ "done:${it.occurrenceId}" }) { item ->
       var open by remember(item.occurrenceId) { mutableStateOf(false) }
       Box {
        Row(Modifier.fillMaxWidth().clickable(enabled=writable) { open=true }, verticalAlignment=Alignment.CenterVertically) {
         Text(item.title, modifier=Modifier.weight(1f).padding(vertical=12.dp), style=MaterialTheme.typography.titleLarge)
         TaskOptions(data.tasks.find { it.id==item.taskId }, writable, onEdit={ editing=it; formOpen=true }, onArchive={ archiving=it })
         TextButton(onClick={ actions.onUndo(item) }, enabled=writable, modifier=Modifier.semantics { contentDescription="Undo completion of ${item.title}" }) { Text("Undo", fontSize=16.sp) }
        }
        DropdownMenu(expanded=open && writable, onDismissRequest={ open=false }) {
         DropdownMenuItem(text={ Text("Undo completion") }, onClick={ open=false; actions.onUndo(item) })
        }
       }
      }
     }
     "Upcoming" -> {
      if(data.upcoming.isEmpty()) item { Text("No upcoming tasks", color=Muted) }
      items(data.upcoming, key={ it.occurrenceId }) { item ->
       var open by remember(item.occurrenceId) { mutableStateOf(false) }
       val task = data.tasks.find { it.id==item.taskId }
       Box {
        Column(Modifier.fillMaxWidth().clickable(enabled=writable && task!=null) { open=true }.padding(vertical=10.dp), verticalArrangement=Arrangement.spacedBy(6.dp)) {
         Row(Modifier.fillMaxWidth(), verticalAlignment=Alignment.CenterVertically) {
          Text(item.title, style=MaterialTheme.typography.titleLarge, modifier=Modifier.weight(1f))
          TaskOptions(task, writable, onEdit={ editing=it; formOpen=true }, onArchive={ archiving=it })
         }
         Text("${item.dueDate} · ${schedule(item.repeat,item.interval)} · ${item.category}", color=Muted, style=MaterialTheme.typography.bodySmall)
         if(item.notes.isNotEmpty()) Text(item.notes)
         HorizontalDivider(color=Color(0xFF3B4B50), modifier=Modifier.padding(top=12.dp))
        }
        DropdownMenu(expanded=open && writable && task!=null, onDismissRequest={ open=false }) {
         if(task!=null) {
          DropdownMenuItem(text={ Text("Edit task") }, onClick={ open=false; editing=task; formOpen=true })
          DropdownMenuItem(text={ Text("Archive task") }, onClick={ open=false; archiving=task })
         }
        }
       }
      }
     }
     "Routines" -> {
      if(data.tasks.isEmpty()) item { Text("No tasks yet", color=Muted) }
      items(data.tasks, key={ it.id }) { task ->
       var open by remember(task.id) { mutableStateOf(false) }
       val occurrence = data.today.find { it.taskId==task.id && it.dueDate<=data.date }
       Box {
        Column(Modifier.fillMaxWidth().clickable(enabled=writable) { open=true }.padding(vertical=8.dp), verticalArrangement=Arrangement.spacedBy(6.dp)) {
         Row(Modifier.fillMaxWidth(), verticalAlignment=Alignment.CenterVertically) {
          Text(task.title, style=MaterialTheme.typography.titleLarge, modifier=Modifier.weight(1f))
          TaskOptions(task, writable, onEdit={ editing=it; formOpen=true }, onArchive={ archiving=it })
         }
         Text("${schedule(task.repeat,task.interval)} · ${task.category}", style=MaterialTheme.typography.bodySmall, color=Muted)
         Text("Starts ${task.startDate} · ${listOf("Normal", "Medium", "High")[task.priority.coerceIn(0,2)]} priority", style=MaterialTheme.typography.bodySmall, color=Muted)
         if(task.notes.isNotEmpty()) Text(task.notes)
         HorizontalDivider(color=Color(0xFF3B4B50))
        }
        DropdownMenu(expanded=open && writable, onDismissRequest={ open=false }) {
         if(occurrence!=null) {
          if(occurrence.completed) DropdownMenuItem(text={ Text("Undo completion") }, onClick={ open=false; actions.onUndo(occurrence) })
          else {
           DropdownMenuItem(text={ Text("Make current") }, onClick={ open=false; actions.onPick(occurrence) })
           DropdownMenuItem(text={ Text("Mark done") }, onClick={ open=false; actions.onComplete(occurrence) })
          }
         }
         DropdownMenuItem(text={ Text("Edit task") }, onClick={ open=false; editing=task; formOpen=true })
         DropdownMenuItem(text={ Text("Archive task") }, onClick={ open=false; archiving=task })
        }
       }
      }
     }
    }
   }
   if(state.snapshot.online) item { TextButton(onClick=actions.onRefresh, enabled=!state.busy) { Text("Refresh", fontSize=16.sp) } }
  }
 }
 if(formOpen) TaskDialog(editing, state.busy, writable, state.snapshot.error, onDismiss={ if(!state.busy) formOpen=false }, onSave={ draft -> actions.onSave(editing, draft) { formOpen=false } }, onArchive={ if(editing!=null) archiving=editing })
 archiving?.let { task ->
  AlertDialog(onDismissRequest={ if(!state.busy) archiving=null }, title={ Text("Archive task?") }, text={ Column { Text("“${task.title}” will leave your active lists. Completion history is retained."); if(state.snapshot.error!=null) Text(state.snapshot.error, color=MaterialTheme.colorScheme.error) } },
   confirmButton={ TextButton(onClick={ actions.onArchive(task) { archiving=null; formOpen=false } }, enabled=writable) { Text("Archive", fontSize=16.sp) } },
   dismissButton={ TextButton(onClick={ archiving=null }, enabled=!state.busy) { Text("Cancel", fontSize=16.sp) } })
 }
}

@Composable private fun TaskOptions(task: Task?, writable: Boolean, onEdit: (Task) -> Unit, onArchive: (Task) -> Unit) {
 if(task==null) return
 var open by remember(task.id) { mutableStateOf(false) }
 Box {
  IconButton(onClick={ open=true }, enabled=writable, modifier=Modifier.semantics { contentDescription="Options for ${task.title}" }) { Text("⋮", fontSize=28.sp, color=Ink) }
  DropdownMenu(expanded=open && writable, onDismissRequest={ open=false }) {
   DropdownMenuItem(text={ Text("Edit task") }, onClick={ open=false; onEdit(task) })
   DropdownMenuItem(text={ Text("Archive task") }, onClick={ open=false; onArchive(task) })
  }
 }
}

@Composable private fun CurrentTask(item: Occurrence, canSkip: Boolean, writable: Boolean, actions: Actions, task: Task?, onEdit: (Task) -> Unit, onArchive: (Task) -> Unit) {
 var menu by remember(item.occurrenceId) { mutableStateOf(false) }
 var occurrenceMenu by remember(item.occurrenceId) { mutableStateOf(false) }
 Surface(color=Focus, shape=RoundedCornerShape(14.dp)) {
  Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement=Arrangement.spacedBy(16.dp)) {
   Row(Modifier.fillMaxWidth(), verticalAlignment=Alignment.CenterVertically) {
    Text("CURRENT TASK", color=Mint, style=MaterialTheme.typography.bodySmall, modifier=Modifier.weight(1f))
    Box {
     IconButton(onClick={ menu=true }, modifier=Modifier.semantics { contentDescription="Current task options" }) { Text("⋮", fontSize=28.sp, color=Ink) }
     DropdownMenu(expanded=menu && writable, onDismissRequest={ menu=false }) {
      DropdownMenuItem(text={ Text("Not now", fontSize=16.sp) }, onClick={ menu=false; actions.onNotNow() }, enabled=canSkip)
      if(task!=null) {
       DropdownMenuItem(text={ Text("Edit task") }, onClick={ menu=false; onEdit(task) })
       DropdownMenuItem(text={ Text("Archive task") }, onClick={ menu=false; onArchive(task) })
      }
     }
    }
   }
   Box {
    Text(item.title, style=MaterialTheme.typography.headlineLarge, modifier=Modifier.fillMaxWidth().clickable(enabled=writable) { occurrenceMenu=true })
    DropdownMenu(expanded=occurrenceMenu && writable, onDismissRequest={ occurrenceMenu=false }) {
     DropdownMenuItem(text={ Text("Make current") }, onClick={ occurrenceMenu=false; actions.onPick(item) })
     DropdownMenuItem(text={ Text("Mark done") }, onClick={ occurrenceMenu=false; actions.onComplete(item) })
    }
   }
   Text("${schedule(item.repeat,item.interval)} · ${item.category}${if(item.priority==2) " · High priority" else ""}", style=MaterialTheme.typography.bodySmall, color=Color(0xFFB4CDBB))
   if(item.overdue) Text("Overdue · ${item.dueDate}", style=MaterialTheme.typography.bodySmall, color=Mint)
   if(item.notes.isNotBlank()) Text(item.notes, fontSize=16.sp, lineHeight=24.sp)
   Row(Modifier.fillMaxWidth().padding(top=14.dp), horizontalArrangement=Arrangement.End) {
    Button(onClick={ actions.onComplete(item) }, enabled=writable, shape=RoundedCornerShape(8.dp), modifier=Modifier.heightIn(min=48.dp)) { Text("Mark done", fontSize=16.sp) }
   }
  }
 }
}

@Composable private fun TaskDialog(task: Task?, busy: Boolean, writable: Boolean, networkError: String?, onDismiss: () -> Unit, onSave: (TaskDraft) -> Unit, onArchive: () -> Unit) {
 var draft by remember(task?.id) { mutableStateOf(task?.let { TaskDraft(it.title,it.notes,it.category,it.repeat,it.interval.toString(),it.startDate,it.priority) } ?: TaskDraft()) }
 var submitted by rememberSaveable { mutableStateOf(false) }
 val error = if(submitted) draft.error() else null
 Dialog(onDismissRequest=onDismiss, properties=DialogProperties(usePlatformDefaultWidth=false)) {
  Surface(Modifier.fillMaxWidth().padding(16.dp).widthIn(max=600.dp).heightIn(max=760.dp).imePadding(), shape=RoundedCornerShape(18.dp), color=Panel) {
   Column(Modifier.verticalScroll(rememberScrollState()).padding(22.dp), verticalArrangement=Arrangement.spacedBy(14.dp)) {
    Text(if(task==null) "New task" else "Edit task", style=MaterialTheme.typography.headlineLarge)
    if(task!=null && task.repeat!="once") Text("Changes apply to the entire task schedule, not just this occurrence.", style=MaterialTheme.typography.bodySmall, color=Muted)
    OutlinedTextField(draft.title, { draft=draft.copy(title=it.take(200)) }, label={ Text("Task title") }, modifier=Modifier.fillMaxWidth(), enabled=!busy, singleLine=true)
    ChoiceField("Repeat", schedule(draft.repeat,1), listOf("once", "daily", "weekly", "monthly", "yearly").map { it to schedule(it,1) }, enabled=!busy) { draft=draft.copy(repeat=it) }
    OutlinedTextField(draft.interval, { draft=draft.copy(interval=it) }, label={ Text("Repeat interval (1–365)") }, keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number), modifier=Modifier.fillMaxWidth(), enabled=!busy, singleLine=true)
    OutlinedTextField(draft.startDate, { draft=draft.copy(startDate=it) }, label={ Text("Start date (YYYY-MM-DD)") }, keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Ascii), modifier=Modifier.fillMaxWidth(), enabled=!busy, singleLine=true)
    OutlinedTextField(draft.category, { draft=draft.copy(category=it.take(60)) }, label={ Text("Category") }, modifier=Modifier.fillMaxWidth(), enabled=!busy, singleLine=true)
    OutlinedTextField(draft.notes, { draft=draft.copy(notes=it.take(2000)) }, label={ Text("Notes (optional)") }, modifier=Modifier.fillMaxWidth(), enabled=!busy, minLines=2, maxLines=5)
    ChoiceField("Priority", listOf("Normal", "Medium", "High")[draft.priority], listOf("0" to "Normal", "1" to "Medium", "2" to "High"), enabled=!busy) { draft=draft.copy(priority=it.toInt()) }
    if(error!=null) Text(error, color=MaterialTheme.colorScheme.error, style=MaterialTheme.typography.bodySmall)
    if(networkError!=null) Text(networkError, color=MaterialTheme.colorScheme.error, style=MaterialTheme.typography.bodySmall)
    if(busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.End, verticalAlignment=Alignment.CenterVertically) {
     TextButton(onClick=onDismiss, enabled=!busy) { Text("Cancel", fontSize=16.sp) }
     Button(onClick={ submitted=true; if(draft.error()==null) onSave(draft) }, enabled=writable) { Text("Save task", fontSize=16.sp) }
    }
    if(task!=null) TextButton(onClick=onArchive, enabled=writable) { Text("Archive task", fontSize=16.sp) }
   }
  }
 }
}

@Composable private fun ChoiceField(label: String, value: String, choices: List<Pair<String,String>>, enabled: Boolean, onChoose: (String) -> Unit) {
 var open by remember { mutableStateOf(false) }
 Column {
  Text(label, style=MaterialTheme.typography.bodySmall, color=Muted)
  Box {
   OutlinedButton(onClick={ open=true }, enabled=enabled, modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text(value, fontSize=16.sp) }
   DropdownMenu(expanded=open, onDismissRequest={ open=false }) {
    choices.forEach { (key,text) -> DropdownMenuItem(text={ Text(text, fontSize=16.sp) }, onClick={ open=false; onChoose(key) }) }
   }
  }
 }
}

