import {orderWaiting, deferOccurrence, readCachedState, canMutate, isCurrentRefresh, escapeHTML as esc} from './state.mjs';

import {occurrenceActions, createCompletedDisclosure} from './interactions.mjs';
const $ = selector => document.querySelector(selector);
import {createConnection} from './auth.mjs';
import {fetchBuildVersion} from './version.mjs';
import {welcomeMarkup} from './welcome.mjs';
let buildVersion = 'Checking…';
fetchBuildVersion().then(version => {
  buildVersion = version;
  if (view === 'settings' && connection.session && !editingConnection && !checking) render();
});
let browserStorage;
try { browserStorage = localStorage; } catch { /* Storage is never required. */ }
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {weekday:'long',month:'long',day:'numeric',year:'numeric'});
const schedule = task => task.repeat === 'once' ? 'One time' : `Every ${task.interval > 1 ? `${task.interval} ` : ''}${({daily:'day',weekly:'week',monthly:'month',yearly:'year'})[task.repeat]}${task.interval > 1 ? 's' : ''}`;
let state = null, connected = false, pending = false, refreshing = false;
let view = 'today', editingId = null, archiveId = null, returnFocus = null;
let mutationVersion = 0;
let occurrenceIdOpen = null;
const completedDisclosure = createCompletedDisclosure();
let orderDate = '', order = [];
let checking = true, authBusy = false, editingConnection = false, signedOut = false;
let setupRequired = null;
let connectionMessage = '', authError = '';
const connection = createConnection({storage:browserStorage,onClear:()=> {
  state = null; connected = false; order = []; orderDate = ''; mutationVersion += 1;
  const keepDraft = connection.session && $('#task-dialog')?.open;
  if (!keepDraft) editingId = null;
  archiveId = null; if (!keepDraft) returnFocus = null; occurrenceIdOpen = null;
  if (!connection.session) completedDisclosure.reset();
  for (const dialog of document.querySelectorAll('dialog')) if (!(keepDraft && dialog.id === 'task-dialog')) dialog.close();
  if (!keepDraft) $('#task-form').reset();
  $('#archive-copy').textContent = '';
  for (const id of ['#occurrence-title','#occurrence-content','#occurrence-error']) if ($(id)) $(id).textContent = '';
  if (!$('#setup-form') && !$('#auth-form')) $('#view').replaceChildren();
}});
function clearAuthSecrets() {
  for (const id of ['#setup-key','#password']) if ($(id)) $(id).value='';
}
function replaceView(markup) {
  clearAuthSecrets();
  $('#view').innerHTML=markup;
}
async function initialize() {
  if (refreshing || authBusy) return;
  checking=true; refreshing=true; connectionMessage=''; render();
  try { setupRequired=await connection.setupStatus(); }
  catch (error) { connectionMessage=error.message; }
  finally { refreshing=false; }
  if (setupRequired === false) await refresh();
  else { checking=false; render(); }
}
function loadOrder(date) {
  if (date !== orderDate) { orderDate = date; order = []; }
}
function saveOrder() { /* Focus order intentionally lives only in memory. */ }
function notify(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
function setError(id, message) { const el = $(id); el.textContent = message; el.hidden = !message; }
function acceptState(next) {
  const now = new Date().toISOString();
  if (!readCachedState(JSON.stringify({state:next,savedAt:now}), localDate())) {
    connection.clear();
    throw new Error('Connection required. The server returned an invalid state.');
  }
  if (!connection.session || !connection.connected) return;
  state = next; connected = true;
}
const request = (path, options) => connection.request(path, options);
async function refresh() {
  if (setupRequired !== false || ($('#auth-form') && !connection.session)) return;
  if (refreshing || pending || authBusy || editingConnection || signedOut) return;
  refreshing = true;
  const startVersion = mutationVersion;
  if (!state) render();
  try {
    await connection.check();
    const next = await request(`/api/state?date=${localDate()}`);
    if (isCurrentRefresh(startVersion, mutationVersion, pending)) acceptState(next);
    connectionMessage = '';
  } catch (error) {
    connected = false; state = null;
    connectionMessage = error.message;
  } finally { checking = false; refreshing = false; render(); }
}
function disabled() { return canMutate(state, connected, pending, localDate()) ? '' : 'disabled'; }
function metadata(row, due = false) {
  return `${esc(schedule(row))} · ${esc(row.category)}${row.priority ? ` · ${row.priority === 2 ? 'High' : 'Medium'} priority` : ''}${due ? ` · Due ${esc(row.dueDate)}` : ''}${row.overdue ? ` · Overdue since ${esc(row.dueDate)}` : ''}`;
}
function render() {
  const focused = document.activeElement;
  const focusKey = focused?.closest('.menu-dropdown')?.parentElement.querySelector('.menu-trigger')?.dataset.focusKey || focused?.dataset?.focusKey;
  const completedOpen = completedDisclosure.read(state?.date, $('#completed')?.open);
  const n = state?.today.filter(row => !row.completed).length ?? 0;
  const welcomeScreen=checking || setupRequired !== false || !connection.session;
  document.body.classList.toggle('welcome-screen',welcomeScreen);
  $('.app-top').hidden=welcomeScreen;
  $('#navigation').innerHTML = connection.session && !signedOut ? ['today','upcoming','routines','settings'].map(name => `<button data-view="${name}" data-focus-key="nav-${name}" ${view === name ? 'aria-current="page"' : ''}><span aria-hidden="true">${({today:'◉',upcoming:'▦',routines:'↻',settings:'⚙'})[name]}</span>${name[0].toUpperCase()+name.slice(1)}${name === 'today' && state ? `<small>${n}</small>` : ''}</button>`).join('') : '';
  $('#add-task').hidden = !connection.session || view === 'settings' || editingConnection;
  $('#add-task').disabled = !connected || pending || authBusy;
  $('#connection').hidden = welcomeScreen || connected && !pending || checking;
  $('#connection').innerHTML = welcomeScreen ? '' : pending ? 'Saving changes…' : connected ? '' : `${esc(connectionMessage || 'Connection required. Tasks are only available while connected.')} <button id="retry" ${refreshing || authBusy ? 'disabled' : ''}>${refreshing ? 'Connecting…' : 'Retry connection'}</button>`;
  $('#view').setAttribute('aria-busy', String(pending || refreshing || authBusy));
  if (checking) {
    replaceView(welcomeMarkup('checking'));
  } else if (setupRequired === null) {
    replaceView(welcomeMarkup('error',connectionMessage));
  } else if (setupRequired) {
    renderSetup();
  } else if (!connection.session || editingConnection) {
    renderSignIn();
  } else if (view === 'settings') {
    renderSettings();
  } else if (!state) {
    $('#view').innerHTML = `<h1>One thing at a time.</h1><div class="empty"><h2>${refreshing ? 'Loading your tasks…' : 'Your tasks are out of reach.'}</h2><p class="muted">${refreshing ? 'Connecting to your Tasks server.' : 'Check your connection and retry. No tasks have been changed.'}</p></div>`;
  } else {
    loadOrder(state.date);
    if (view === 'today') renderToday();
    if (view === 'upcoming') renderUpcoming();
    if (view === 'routines') renderRoutines();
  }
  if ($('#completed')) $('#completed').open = completedOpen;
  if ($('#occurrence-dialog')?.open) renderOccurrence();
  if (focusKey && !document.querySelector('dialog[open]')) [...document.querySelectorAll('[data-focus-key]')].find(el => el.dataset.focusKey === focusKey)?.focus({preventScroll:true});
  for (const dialog of document.querySelectorAll('dialog')) {
    for (const button of dialog.querySelectorAll('button')) button.disabled = pending || (!connected && (button.type === 'submit' || button.id === 'confirm-archive'));
  }
}
function renderSetup() {
  // Refresh, focus and offline events must not discard a partly completed form.
  if (!$('#setup-form')) replaceView(welcomeMarkup('setup'));
  setError('#setup-error',authError);
  for (const control of $('#setup-form').querySelectorAll('button,input')) control.disabled=authBusy;
  $('#setup-form').querySelector('button[type="submit"]').textContent=authBusy ? 'Creating account…' : 'Create account & start';
}
function renderSignIn() {
  // Leave an in-progress form intact during focus/periodic refresh.
  if ($('#auth-form')) {
    setError('#auth-error',authError || connectionMessage);
    for (const control of $('#auth-form').querySelectorAll('button,input:not([readonly])')) control.disabled = authBusy;
    return;
  }
  if (!editingConnection) {
    replaceView(welcomeMarkup('signin','',location.origin));
    setError('#auth-error',authError || connectionMessage);
    for (const control of $('#auth-form').querySelectorAll('button,input')) control.disabled=authBusy;
    return;
  }
  $('#view').innerHTML = `<h1>${editingConnection ? 'Edit connection.' : 'Welcome to Tasks.'}</h1><p class="page-sub">${editingConnection ? 'Re-enter your password to test and save this connection. Failed credentials leave your current session unchanged.' : 'Sign in to your server to see your tasks. Ask your server administrator for an account.'}</p><form id="auth-form" class="settings-panel"><h2>${editingConnection ? 'Connection details' : 'Sign in'}</h2><p id="auth-error" class="error" role="alert" hidden></p><label for="server-origin">Current server</label><input id="server-origin" readonly value="${esc(location.origin)}" aria-describedby="server-help"><p id="server-help" class="field-hint">This browser connects only to the server you opened. To use another server, open its address directly.</p><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9._\\-]+" maxlength="64" required value="${esc(connection.session?.username || '')}"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><p class="field-hint">Tasks never saves your password. Your browser may offer its own password manager.</p><footer>${editingConnection ? '<button type="button" id="cancel-connection">Cancel</button>' : ''}<button type="submit" class="primary">${editingConnection ? 'Test and save' : 'Sign in'}</button></footer></form>`;
  setError('#auth-error',authError);
  for (const control of $('#auth-form').querySelectorAll('button,input:not([readonly])')) control.disabled = authBusy;
}
function renderSettings() {
  $('#view').innerHTML = `<h1>Settings.</h1><p class="page-sub">Your connection and app.</p><section class="settings-panel" aria-labelledby="connection-heading"><h2 id="connection-heading">Connection</h2><dl><dt>Server</dt><dd>${esc(location.origin)}</dd><dt>Account</dt><dd>${esc(connection.session.username)}</dd><dt>Session</dt><dd>${connected ? 'Connected' : 'Connection required'}${connection.session.expiresAt ? ` · Expires ${esc(connection.session.expiresAt)}` : ''}</dd></dl><p class="muted">Tasks and history stay on your server. Nothing is available offline.</p><div class="settings-actions"><button id="edit-connection" ${authBusy || pending || refreshing ? 'disabled' : ''}>Edit connection</button><button id="test-session" ${authBusy || pending || refreshing ? 'disabled' : ''}>Test session</button><button id="sign-out" ${authBusy || pending ? 'disabled' : ''}>Sign out</button></div></section><section class="version-panel" aria-labelledby="current-version-heading" aria-live="polite"><h2 id="current-version-heading">Current Version: ${esc(buildVersion)}</h2><div class="version-card"><h3>Web app</h3><p>This version is served by your Tasks server.</p></div></section>`;
}
function taskMenu(taskId, title) {
  const key = `options-${taskId}`;
  return `<div class="task-menu"><button class="menu-trigger" data-menu-trigger aria-label="Options for ${esc(title)}" aria-expanded="false" aria-controls="${esc(key)}" data-focus-key="${esc(key)}" ${disabled()}>⋮</button><div id="${esc(key)}" class="menu-dropdown" hidden><button data-edit="${esc(taskId)}" ${disabled()}>Edit task</button><button data-archive="${esc(taskId)}" ${disabled()}>Archive task</button></div></div>`;
}
function renderToday() {
  const waiting = orderWaiting(state.today, order), current = waiting[0];
  const done = state.today.filter(row => row.completed);
  const {completed,total} = state.progress;
  const progress = `<div class="progress-wrap"><div class="progress-label"><b>Today’s progress</b><span>${completed} of ${total} complete</span></div><progress max="${Math.max(1,total)}" value="${completed}" aria-label="Today’s task completion: ${completed} of ${total}"></progress></div>`;
  let focus;
  if (current) {
    focus = `<section class="focus-card" aria-label="Current task"><div class="focus-header"><span class="focus-eyebrow"><i></i>Current task</span><div class="task-menu"><button id="task-menu-trigger" aria-label="Current task options" aria-expanded="false" aria-controls="task-menu" class="menu-trigger" data-focus-key="task-options">⋮</button><div id="task-menu" class="menu-dropdown" hidden><button data-defer ${pending || waiting.length < 2 ? 'disabled' : ''}>Not now</button><button data-edit="${esc(current.taskId)}" ${disabled()}>Edit task</button><button data-archive="${esc(current.taskId)}" ${disabled()}>Archive task</button></div></div></div><h2><button type="button" class="current-title" data-task-open="${esc(current.taskId)}" data-focus-key="current-title" aria-haspopup="dialog" aria-controls="occurrence-dialog" ${disabled()}>${esc(current.title)}</button></h2><p class="metadata">${metadata(current)}</p>${current.notes ? `<p class="task-notes">${esc(current.notes)}</p>` : ''}<div class="focus-actions"><button class="primary" data-complete="${esc(current.occurrenceId)}" data-focus-key="complete" ${disabled()}><span aria-hidden="true">✓</span> Mark done</button></div></section>`;
  } else if (!state.tasks.length) {
    focus = '<section class="focus-card empty"><span class="focus-eyebrow">A fresh start</span><h2>Your first task goes here</h2><p>Add a one-off task or a routine you want to repeat.</p><div class="focus-actions"><button class="primary" data-add '+disabled()+'>Add your first task</button></div></section>';
  } else {
    focus = `<section class="focus-card empty"><span class="focus-eyebrow">${total ? 'Today, complete' : 'Nothing due today'}</span><h2>${total ? 'You’ve made room for the rest of your day.' : 'A little breathing room.'}</h2><p>Your upcoming tasks will be here when they’re due.</p></section>`;
  }
  const emptyQueue = !state.tasks.length ? '<h2 class="queue-title">Waiting tasks</h2><p class="muted">No tasks yet. Your queue will build as you add them.</p>' : '';
  $('#view').innerHTML = `<h1>One thing at a time.</h1><p class="page-sub">${esc(dateLabel(state.date))} · ${waiting.length} ${waiting.length === 1 ? 'task' : 'tasks'} remaining</p>${progress}<div class="work-layout">${focus}<section class="queue" aria-label="The rest of today">${waiting.length > 1 ? `<h2 class="queue-title">Still to come <span>${waiting.length-1} tasks</span></h2>${waiting.slice(1).map((row,i)=>`<div class="queue-item"><button class="queue-row" data-pick="${esc(row.occurrenceId)}" data-focus-key="pick-${esc(row.occurrenceId)}" ${pending ? 'disabled' : ''}><span class="queue-number">${String(i+2).padStart(2,'0')}</span><span class="row-copy"><strong>${esc(row.title)}</strong><small>${metadata(row)}</small></span><span aria-hidden="true">›</span></button>${taskMenu(row.taskId,row.title)}</div>`).join('')}` : emptyQueue}</section></div>${done.length ? `<details id="completed" class="completed"><summary>Completed today (${done.length})</summary>${done.map(row=>`<div class="done-row"><span aria-hidden="true">✓</span><button class="completed-task" data-pick="${esc(row.occurrenceId)}" data-focus-key="pick-${esc(row.occurrenceId)}">${esc(row.title)}</button><button data-undo="${esc(row.occurrenceId)}" data-focus-key="undo-${esc(row.occurrenceId)}" aria-label="Undo completion of ${esc(row.title)}" ${disabled()}>Undo</button>${taskMenu(row.taskId,row.title)}</div>`).join('')}</details>` : ''}`;
}
function renderUpcoming() {
  let previous = '';
  $('#view').innerHTML = `<h1>Not for today.</h1><p class="page-sub">Your next scheduled tasks.</p>${state.upcoming.length ? state.upcoming.map(row => { const heading = previous !== row.dueDate ? `<h2 class="list-heading">${esc(dateLabel(row.dueDate))}</h2>` : ''; previous = row.dueDate; return `${heading}<article class="task-row"><button class="row-copy row-open" data-pick="${esc(row.occurrenceId)}" data-focus-key="pick-${esc(row.occurrenceId)}"><strong>${esc(row.title)}</strong><small>${metadata(row)}</small></button>${taskMenu(row.taskId,row.title)}</article>`; }).join('') : '<div class="empty"><h2>Nothing scheduled ahead.</h2><p class="muted">New tasks with a future start date will appear here.</p></div>'}`;
}
function renderRoutines() {
  $('#view').innerHTML = `<h1>Your routines.</h1><p class="page-sub">All your tasks and the schedules behind them.</p>${state.tasks.length ? state.tasks.map(task=>`<article class="task-row"><button class="row-copy row-open" data-task-open="${esc(task.id)}" data-focus-key="task-${esc(task.id)}"><strong>${esc(task.title)}</strong><small>${metadata(task)} · Starts ${esc(task.startDate)}</small></button>${taskMenu(task.id,task.title)}</article>`).join('') : '<div class="empty"><h2>No routines yet.</h2><p class="muted">Add a one-time task or a repeating routine.</p></div>'}`;
}
function renderOccurrence() {
  const row = [...(state?.today || []),...(state?.upcoming || [])].find(row => row.occurrenceId === occurrenceIdOpen) || state?.tasks.find(task=>`task:${task.id}` === occurrenceIdOpen);
  if (!row || !connected) { $('#occurrence-dialog').close(); return; }
  $('#occurrence-title').textContent = row.title;
  $('#occurrence-content').innerHTML = `<p class="metadata">${metadata(row)}</p>${row.notes ? `<p class="task-notes">${esc(row.notes)}</p>` : ''}`;
  const actions = occurrenceActions(state, occurrenceIdOpen, connected, pending, localDate());
  $('[data-make-current]').hidden = !actions.makeCurrent;
  const action = $('#occurrence-complete');
  action.hidden = !actions.complete && !actions.undo;
  action.textContent = actions.undo ? 'Undo' : 'Mark done';
}
function openDialog(id, trigger) { returnFocus = trigger?.closest('.task-menu')?.querySelector('.menu-trigger') || trigger; $(id).showModal(); }
function openTask(id, trigger) {
  if (!connected || pending) return;
  editingId = id;
  const task = id ? state.tasks.find(t=>t.id === id) : {title:'',notes:'',category:'Personal',repeat:'once',interval:1,startDate:localDate(),priority:0};
  if (!task) return;
  $('#task-form').reset();
  for (const key of ['title','notes','category','repeat','interval','startDate','priority']) $('#task-form').elements[key].value = task[key];
  $('#task-dialog-title').textContent = id ? 'Edit task' : 'Add task';
  $('#save-task').textContent = id ? 'Save changes' : 'Add task';
  setError('#form-error',''); updateInterval(); openDialog('#task-dialog',trigger); $('#title').focus();
}
function updateInterval() {
  const repeat = $('#repeat').value;
  $('#interval').disabled = repeat === 'once';
  $('#interval-unit').textContent = ({once:'interval',daily:'days',weekly:'weeks',monthly:'months',yearly:'years'})[repeat];
}
async function mutate(path, method, body, afterSuccess, errorTarget) {
  if (!connected || pending) return;
  if (!canMutate(state, connected, pending, localDate())) { refresh(); return; }
  mutationVersion += 1;
  pending = true; notify(''); render();
  try {
    const result = await request(path, {method, ...(body ? {body:JSON.stringify(body)} : {})});
    if (result?.today) acceptState(result);
    else {
      // The write succeeded, but only a successful read can verify the active lists.
      try { acceptState(await request(`/api/state?date=${localDate()}`)); }
      catch { connected = false; throw new Error('Change saved, but refreshing failed. Reconnect to verify your tasks before making more changes.'); }
    }
    afterSuccess();
  } catch (error) {
    if (errorTarget) setError(errorTarget,error.message);
    else notify(error.message);
  } finally { pending = false; render(); }
}
function closeMenu(restore = false) {
  for (const menu of document.querySelectorAll('.menu-dropdown:not([hidden])')) {
    menu.hidden = true;
    const trigger = menu.parentElement.querySelector('.menu-trigger');
    trigger.setAttribute('aria-expanded','false');
    if (restore) trigger.focus();
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) { if (!event.target.closest('.task-menu')) closeMenu(); return; }
  if (button.id === 'retry') { if (setupRequired === null) initialize(); else { signedOut = false; refresh(); } return; }
  if (button.id === 'edit-connection') { editingConnection = true; authError = ''; render(); $('#username').focus(); return; }
  if (button.id === 'cancel-connection') { editingConnection = false; authError = ''; $('#password').value = ''; render(); return; }
  if (button.id === 'test-session') { refresh().then(()=> { if (connected) notify('Session verified. Connected to your server.'); }); return; }
  if (button.id === 'sign-out') {
    signedOut = true; editingConnection = false; authBusy = true;
    const result = connection.logout(); render();
    result.then(message=> { connectionMessage = message; authBusy = false; view = 'today'; notify(message); render(); }); return;
  }
  if (button.dataset.close) { document.getElementById(button.dataset.close).close(); return; }
  if (button.dataset.view) { view = button.dataset.view; notify(''); render(); return; }
  if (button.id === 'add-task' || button.hasAttribute('data-add')) { openTask(null,button); return; }
  if (button.id === 'task-menu-trigger' || button.hasAttribute('data-menu-trigger')) {
    const menu = document.getElementById(button.getAttribute('aria-controls')); const opening = menu.hidden; closeMenu(); menu.hidden = !opening; button.setAttribute('aria-expanded',String(!menu.hidden)); if (!menu.hidden) menu.querySelector('button:not(:disabled)')?.focus(); return;
  }
  if (button.hasAttribute('data-defer')) {
    order = deferOccurrence(state.today,order,orderWaiting(state.today,order)[0]?.occurrenceId); saveOrder(); render(); $('#task-menu-trigger')?.focus(); return;
  }
  if (button.dataset.taskOpen) {
    if (!canMutate(state, connected, pending, localDate())) return;
    const row = state.today.find(row=>row.taskId === button.dataset.taskOpen);
    occurrenceIdOpen = row?.occurrenceId || `task:${button.dataset.taskOpen}`;
    setError('#occurrence-error',''); renderOccurrence(); openDialog('#occurrence-dialog',button); return;
  }
  if (button.dataset.pick) {
    if (!canMutate(state, connected, pending, localDate())) return;
    occurrenceIdOpen = button.dataset.pick; setError('#occurrence-error',''); renderOccurrence(); openDialog('#occurrence-dialog',button); return;
  }
  if (button.hasAttribute('data-make-current')) {
    if (!canMutate(state, connected, pending, localDate())) return;
    if (!occurrenceActions(state, occurrenceIdOpen, connected, pending, localDate()).makeCurrent) return;
    const row = state.today.find(row=>row.occurrenceId === occurrenceIdOpen);
    if (!row) return;
    order = [row.occurrenceId,...orderWaiting(state.today,order).map(row=>row.occurrenceId).filter(id=>id !== row.occurrenceId)];
    $('#occurrence-dialog').close(); saveOrder(); render(); $('[data-complete]')?.focus(); return;
  }
  if (button.dataset.edit) { closeMenu(); openTask(button.dataset.edit,button); return; }
  if (button.dataset.archive) {
    if (!connected || pending) return;
    archiveId = button.dataset.archive;
    const task = state.tasks.find(t=>t.id === archiveId); if (!task) return;
    $('#archive-copy').textContent = `Archive “${task.title}”?`;
    setError('#archive-error',''); closeMenu(); openDialog('#archive-dialog',button); return;
  }
  const popupAction = button.id === 'occurrence-complete';
  const occurrenceId = popupAction ? occurrenceIdOpen : button.dataset.complete || button.dataset.undo;
  if (occurrenceId) {
    const row = state.today.find(row=>row.occurrenceId === occurrenceId); if (!row) return;
    const undo = popupAction ? row.completed : Boolean(button.dataset.undo);
    const actions = occurrenceActions(state, occurrenceId, connected, pending, localDate());
    if (!(undo ? actions.undo : actions.complete)) return;
    mutate(`/api/occurrences/${undo ? 'undo' : 'complete'}`, 'POST', {taskId:row.taskId,dueDate:row.dueDate,date:localDate()}, ()=> { $('#occurrence-dialog').close(); notify(undo ? 'Task restored to today.' : 'Task completed. You can undo it under Completed today.'); $('[data-complete]')?.focus(); }, popupAction ? '#occurrence-error' : null); return;
  }
  if (button.id === 'confirm-archive') {
    mutate(`/api/tasks/${encodeURIComponent(archiveId)}`, 'DELETE', null, ()=> { $('#archive-dialog').close(); notify('Task archived. Completion history retained.'); }, '#archive-error'); return;
  }
  if (!event.target.closest('.task-menu')) closeMenu();
});
document.addEventListener('submit', async event => {
  if (event.target.id === 'setup-form') {
    event.preventDefault();
    if (authBusy || pending || refreshing || setupRequired !== true) return;
    const setupKey=$('#setup-key').value, username=$('#username').value, password=$('#password').value;
    $('#password').value='';
    authBusy=true; authError=''; render();
    try {
      await connection.setup(setupKey,username,password);
      clearAuthSecrets(); setupRequired=false; signedOut=false; editingConnection=false;
      view='today'; connectionMessage='';
    } catch (error) {
      authError=error.message;
      if (error.status === 409) { clearAuthSecrets(); setupRequired=false; }
    }
    finally { authBusy=false; render(); }
    if (connection.session && !authError) await refresh();
    return;
  }
  if (event.target.id !== 'auth-form') return;
  event.preventDefault();
  if (authBusy || pending || refreshing) return;
  const username = $('#username').value;
  if (connection.session && username.toLowerCase() !== connection.session.username.toLowerCase() && !window.confirm('Sign in as a different user? Your current tasks will be cleared after the new credentials are verified.')) { $('#password').value = ''; return; }
  const password = $('#password').value;
  $('#password').value = '';
  authBusy = true; authError = ''; notify(''); render();
  try {
    await connection.login(username,password);
    signedOut = false; editingConnection = false; view = 'today'; connectionMessage = '';
  } catch (error) { authError = error.message; }
  finally { authBusy = false; render(); }
  if (!authError) await refresh();
});
$('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!connected || pending) return;
  const fields = $('#task-form').elements;
  const body = Object.fromEntries(['title','notes','category','repeat','startDate'].map(key=>[key,fields[key].value]));
  body.title = body.title.trim(); body.category = body.category.trim() || 'Personal';
  body.interval = body.repeat === 'once' ? 1 : Number(fields.interval.value); body.priority = Number(fields.priority.value);
  if (!body.title) { setError('#form-error','Enter a task title.'); $('#title').focus(); return; }
  mutate(editingId ? `/api/tasks/${encodeURIComponent(editingId)}` : '/api/tasks', editingId ? 'PUT' : 'POST', body, ()=> { $('#task-dialog').close(); notify(editingId ? 'Task updated.' : 'Task added.'); }, '#form-error');
});
$('#repeat').addEventListener('change', updateInterval);
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', ()=> {
    if (document.querySelector('dialog[open]')) return;
    const key = returnFocus?.dataset.focusKey;
    const target = returnFocus?.isConnected ? returnFocus : [...document.querySelectorAll('[data-focus-key]')].find(el=>el.dataset.focusKey === key);
    (target || $('[data-complete]') || $('#add-task')).focus();
  });
}
document.addEventListener('keydown', event => {
  const menu = event.target.closest('.task-menu')?.querySelector('.menu-dropdown');
  if (event.key === 'Escape' && menu && !menu.hidden) { event.preventDefault(); closeMenu(true); }
  if (event.target.matches('.menu-trigger') && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); if (menu.hidden) event.target.click(); }
  if (event.target.closest('.menu-dropdown') && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
    event.preventDefault(); const items = [...menu.querySelectorAll('button:not(:disabled)')];
    let index = items.indexOf(document.activeElement);
    index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }
  if (event.key === 'Tab' && event.target.closest('.menu-dropdown')) setTimeout(()=>closeMenu(),0);
});
window.addEventListener('focus', refresh);
window.addEventListener('pagehide', clearAuthSecrets);
window.addEventListener('online', refresh);
window.addEventListener('offline', ()=> { connection.clear(); connectionMessage = 'Connection required. Reconnect to access your tasks.'; render(); });
document.addEventListener('visibilitychange', ()=> { if (!document.hidden) refresh(); });

setInterval(()=> { if (!document.hidden) refresh(); }, 30_000);
render(); initialize();
