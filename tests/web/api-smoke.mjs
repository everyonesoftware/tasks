// Real Chromium + Go API acceptance. All accounts and data are disposable.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'daymark-go-acceptance-'));
const binary = join(root, 'tasks');
const db = join(root, 'fixture.sqlite3');
const password = 'acceptance-only-password'; // Public test credential, never a user DB.
let apiProcess, chrome, socket;
const checks = [];
const build = spawnSync('go', ['build', '-o', binary, './cmd/tasks'], {cwd:resolve('.'), encoding:'utf8'});
assert.equal(build.status, 0, build.stderr);
for (const username of ['acceptance', 'second']) {
  const result = spawnSync(binary, ['create-user', '--db', db, '--username', username, '--password-stdin'], {input:password+'\n', encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
}
try {
  apiProcess = spawn(binary, ['serve', '--port', '0', '--db', db], {stdio:['ignore','pipe','pipe']});
  let startup = '', apiErrors = '';
  apiProcess.stdout.on('data', chunk => startup += chunk);
  apiProcess.stderr.on('data', chunk => apiErrors += chunk);
  async function waitFor(fn, label, timeout=15000) {
    const until = Date.now()+timeout;
    while (Date.now()<until) { if (await fn()) return; await delay(100); }
    throw new Error('Timed out: '+label+'; API stderr='+apiErrors);
  }
  await waitFor(()=>/http:\/\/127\.0\.0\.1:\d+/.test(startup), 'Go server startup');
  const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function api(path, body, token, method) {
    const response=await fetch(origin+path, {method:method ?? (body===undefined?'GET':'POST'), headers:{...(body===undefined?{}:{'Content-Type':'application/json'}), ...(token?{Authorization:'Bearer '+token}:{})}, ...(body===undefined?{}:{body:JSON.stringify(body)}), redirect:'error'});
    assert.ok(response.ok, `API ${path}: ${response.status} ${await response.clone().text()}`);
    return response.status===204 ? null : response.json();
  }
  const token=(await api('/api/auth/login',{username:'acceptance',password})).token;
  assert.deepEqual((await api('/api/state',undefined,token)).tasks,[]);
  const now=new Date();
  const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  for (const title of ['API acceptance task','Weekly acceptance','<img src=x onerror=window.xss=1>']) {
    await api('/api/tasks',{title,notes:'Acceptance fixture only',category:'Testing',repeat:'daily',interval:1,startDate:today,priority:0},token);
  }
  const profile=join(root,'chromium');
  chrome=spawn('chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  let port;
  await waitFor(async()=>{try {port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; return !!port;}catch{return false;}},'Chromium startup');
  const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;
  const pending=new Map(), runtimeErrors=[];
  socket.addEventListener('message',event=>{
    const reply=JSON.parse(event.data);
    if(reply.method==='Runtime.exceptionThrown') runtimeErrors.push(reply.params.exceptionDetails.text);
    const entry=pending.get(reply.id);
    if(!entry)return;
    clearTimeout(entry.timer);pending.delete(reply.id);
    reply.error?entry.reject(new Error(JSON.stringify(reply.error))):entry.resolve(reply.result);
  });
  function cdp(method,params={}) {
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method+' after '+checks.at(-1)));},20000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function js(expression) {
    const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  const wait=(expression)=>waitFor(()=>js(expression),expression);
  async function navigate() {
    await cdp('Page.navigate',{url:origin});
    await wait("document.readyState==='complete' && !!document.querySelector('#auth-form,.focus-card')");
  }
  async function login(username,passphrase=password) {
    await js(`document.querySelector('#username').value=${JSON.stringify(username)};document.querySelector('#password').value=${JSON.stringify(passphrase)};document.querySelector('#auth-form').requestSubmit()`);
  }
  async function currentTitlePopup(label) {
    assert.equal(await js("!!document.querySelector('.focus-card h2 button:not(:disabled)')"),true,`${label}: current title is an accessible button`);
    const title=await js("document.querySelector('.focus-card h2').textContent");
    for (const key of [null,'Enter',' ']) {
      await js("document.querySelector('.focus-card h2 button').focus()");
      if (key === null) {
        const point=await js("(()=>{const r=document.querySelector('.focus-card h2 button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
        await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
        await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
      } else {
        const code=key==='Enter'?'Enter':'Space', windowsVirtualKeyCode=key==='Enter'?13:32;
        await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,text:key==='Enter'?'\r':' ',unmodifiedText:key==='Enter'?'\r':' '});
        await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
      }
      assert.equal(await js("document.querySelector('#occurrence-dialog').open"),true,`${label}: ${key === null ? 'pointer' : key === ' ' ? 'Space' : key} opens popup`);
      assert.equal(await js("document.querySelector('#occurrence-title').textContent"),title);
      assert.equal(await js("document.querySelector('.focus-card h2').textContent"),title,'activation does not change current');
      assert.equal(await js("document.querySelector('[data-make-current]').hidden || document.querySelector('#occurrence-complete').hidden"),false,'current popup exposes Make current and Mark done');
      await js("document.querySelector('[data-close=occurrence-dialog]').click()");
      await wait("document.activeElement.matches('.focus-card h2 button')");
    }
    checks.push(`${label}: current title opens existing popup by pointer, Enter and Space; focus restored`);
  }
  await cdp('Network.enable');await cdp('Runtime.enable');await navigate();
  assert.equal(await js('document.title'), 'Tasks');
  assert.equal(await js("document.querySelector('.brand').getAttribute('aria-label')"), 'Tasks home');
  assert.equal(await js("document.querySelector('#signin-heading').textContent"), 'Sign in to Tasks');
  checks.push('Tasks title, accessible brand and sign-in copy');
  assert.ok(await js("document.querySelector('#password').value==='' && document.querySelector('#server-origin').readOnly"));
  checks.push('first-login and current origin');
  await login('acceptance');await wait("!!document.querySelector('[data-complete]')");
  assert.equal(await js("!!document.querySelector('#view img') || !!window.xss"),false);
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.json()).then(x=>x.username)"),'acceptance');
  assert.ok(!(await js('document.cookie')).includes('daymark_session'));
  assert.ok(await js('localStorage.length===0 && sessionStorage.length===0'));
  checks.push('HttpOnly cookie, XSS escaping and no browser task/credential storage');
  await currentTitlePopup('Multiple tasks');
  const initialCurrent=await js("document.querySelector('.focus-card h2').textContent");
  const pickedTitle=await js("document.querySelector('[data-pick] strong').textContent");
  await js("document.querySelector('[data-pick]').click()");
  assert.equal(await js("!!document.querySelector('#occurrence-dialog[open]')"),true,'queue click opens task popup');
  assert.equal(await js("document.querySelector('.focus-card h2').textContent"),initialCurrent,'opening popup does not change current');
  await js("document.querySelector('[data-make-current]').click()");
  assert.equal(await js("document.querySelector('.focus-card h2').textContent"),pickedTitle);
  await js("document.querySelector('[data-pick]').click();document.querySelector('#occurrence-complete').click()");await wait("document.querySelector('progress').value===1");
  checks.push('queue popup opens without selecting; explicit Make current and Mark done');
  assert.equal((await api('/api/state',undefined,token)).progress.completed,1);
  await js("document.querySelector('#completed').open=true");
  await delay(100);
  await js("document.querySelector('[data-view=routines]').click();document.querySelector('[data-view=today]').click()");
  assert.equal(await js("document.querySelector('#completed').open"),true,'explicit completed expansion survives navigation');
  await js("window.dispatchEvent(new Event('focus'))");await wait("document.querySelector('#view').getAttribute('aria-busy')==='false'");
  assert.equal(await js("document.querySelector('#completed').open"),true,'expansion survives refresh');
  await js("document.querySelector('#completed [data-pick]').click()");
  assert.equal(await js("document.querySelector('[data-make-current]').hidden"),true);
  assert.equal(await js("document.querySelector('#occurrence-complete').textContent"),'Undo');
  await js("document.querySelector('#occurrence-complete').click()");await wait("document.querySelector('progress').value===0");
  checks.push('completed popup Undo without Make current; expansion survives refresh/navigation');
  assert.equal((await api('/api/state',undefined,token)).progress.completed,0);
  assert.equal(await js("(()=>{const item=document.querySelector('.queue-item');const row=item.querySelector('.queue-row').getBoundingClientRect(), menu=item.querySelector('.menu-trigger').getBoundingClientRect();return menu.top>=row.top && menu.bottom<=row.bottom})()"),true,'queue menu sits alongside row, not below');
  await js("document.querySelector('[data-pick]').closest('.queue-item').querySelector('[data-menu-trigger]').click()");
  assert.equal(await js("document.activeElement.textContent"),'Edit task');
  await js("document.activeElement.click();document.querySelector('#title').value='Edited from queue';document.querySelector('#notes').value='Persisted queue notes';document.querySelector('#task-form').requestSubmit()");
  await wait("document.querySelector('#notice').textContent==='Task updated.'");
  assert.ok((await api('/api/state',undefined,token)).tasks.some(t=>t.title==='Edited from queue' && t.notes==='Persisted queue notes'));
  assert.equal(await js("!!document.querySelector('button button')"),false);
  checks.push('accessible queue menu reuses editor and persists title/notes without nested buttons');
  // Revalidate an already-open popup after another client completes its occurrence.
  const stale=await js("document.querySelector('#view [data-pick]').dataset.pick");
  await js("document.querySelector('#view [data-pick]').click()");
  const staleRow=(await api('/api/state',undefined,token)).today.find(row=>row.occurrenceId===stale);
  await api('/api/occurrences/complete',{taskId:staleRow.taskId,dueDate:staleRow.dueDate,date:today},token);
  await js("window.dispatchEvent(new Event('focus'))");
  await wait("document.querySelector('#occurrence-complete').textContent==='Undo'");
  assert.equal(await js("document.querySelector('[data-make-current]').hidden"),true);
  await js("document.querySelector('#occurrence-complete').click()");await wait("document.querySelector('progress').value===0");
  const tomorrowDate=new Date(now);tomorrowDate.setDate(tomorrowDate.getDate()+1);
  const tomorrow=`${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth()+1).padStart(2,'0')}-${String(tomorrowDate.getDate()).padStart(2,'0')}`;
  await api('/api/tasks',{title:'Future only',notes:'Not early',category:'Testing',repeat:'once',interval:1,startDate:tomorrow,priority:0},token);
  await delay(200);
  await js("window.dispatchEvent(new Event('focus'))");await wait("document.querySelector('#view').getAttribute('aria-busy')==='false'");
  await js("document.querySelector('[data-view=upcoming]').click()");
  assert.equal(await js("new Set([...document.querySelectorAll('.menu-dropdown')].map(el=>el.id)).size===document.querySelectorAll('.menu-dropdown').length"),true,'each occurrence menu has a unique controlled target');
  await wait("[...document.querySelectorAll('[data-pick]')].some(b=>b.textContent.includes('Future only'))");
  await js("[...document.querySelectorAll('[data-pick]')].find(b=>b.textContent.includes('Future only')).click()");
  assert.ok(await js("document.querySelector('[data-make-current]').hidden && document.querySelector('#occurrence-complete').hidden"));
  await js("document.querySelector('[data-close=occurrence-dialog]').click();document.querySelector('[data-view=today]').click();document.querySelector('#view [data-complete]').click()");
  await wait("document.querySelector('progress').value===1");
  await js("document.querySelector('#completed').open=false;document.querySelector('[data-view=routines]').click();document.querySelector('[data-view=today]').click()");
  assert.equal(await js("document.querySelector('#completed').open"),false);
  await js("document.querySelector('[data-undo]').click()");await wait("document.querySelector('progress').value===0");
  checks.push('stale popup revalidates completion; future popup has no early actions; explicit collapse retained');
  const archivedOccurrence=await js("document.querySelector('#view [data-pick]').dataset.pick");
  const archiveStaleRow=(await api('/api/state',undefined,token)).today.find(row=>row.occurrenceId===archivedOccurrence);
  await js("document.querySelector('#view [data-pick]').click()");
  await api('/api/tasks/'+encodeURIComponent(archiveStaleRow.taskId),undefined,token,'DELETE');
  await js("document.querySelector('#occurrence-complete').click()");
  await wait("document.querySelector('#view').getAttribute('aria-busy')==='false'");
  assert.equal(await js("!!document.querySelector('#occurrence-dialog[open] [role=alert]:not([hidden])')"),true,'failed popup write is explained inside modal');
  await js("window.dispatchEvent(new Event('focus'))");await wait("!document.querySelector('#occurrence-dialog').open");
  checks.push('archived stale popup write reports failure inside modal; refresh removes unavailable occurrence');
  await js("document.querySelector('[data-view=routines]').click()");
  assert.equal(await js("document.querySelectorAll('.task-row [data-task-open]').length===document.querySelectorAll('.task-row').length"),true,'every routine row opens task details');
  await js("document.querySelector('[data-task-open]').click()");
  assert.equal(await js("document.querySelector('#occurrence-dialog').open"),true);
  await js("document.querySelector('[data-close=occurrence-dialog]').click();document.querySelector('[data-menu-trigger]').click();document.activeElement.click();document.querySelector('#title').value='Unsaved refresh draft'");
  await cdp('Network.setBlockedURLs',{urls:['*/api/auth/session']});
  await js("window.dispatchEvent(new Event('focus'))");
  await wait("!!document.querySelector('#retry')");
  assert.ok(await js("document.querySelector('#task-dialog').open && document.querySelector('#title').value==='Unsaved refresh draft' && document.querySelector('#save-task').disabled"),'connection loss preserves editor draft while locking save');
  await cdp('Network.setBlockedURLs',{urls:[]});
  await js("document.querySelector('#retry').click()");await wait("!document.querySelector('#save-task').disabled");
  assert.equal(await js("document.querySelector('#title').value"),'Unsaved refresh draft');
  await js("document.querySelector('[data-close=task-dialog]').click()");await delay(100);
  assert.equal(await js("document.activeElement.matches('[data-menu-trigger]')"),true,'editor cancellation restores originating menu trigger after refresh');
  await js("document.activeElement.click();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal(await js("document.activeElement.matches('[data-menu-trigger]') && document.activeElement.getAttribute('aria-expanded')==='false'"),true,'Escape closes row menu and restores trigger');
  await js("document.querySelector('[data-view=today]').click()");
  checks.push('routine row popup; disconnected editor draft retained, save locked, reconnect preserves draft');
  checks.push('completion and undo independently read back');
  await js("document.querySelector('[data-view=settings]').click()");
  const buildVersion=(await api('/health')).version;
  await wait(`document.querySelector('[aria-labelledby=about-heading]').textContent.includes(${JSON.stringify('Tasks web · Version '+buildVersion)})`);
  checks.push('web About reports the actual server build version');
  await js("document.querySelector('[data-view=today]').click();document.querySelector('#view [data-complete]').click()");await wait("document.querySelector('progress').value===1");
  await js("document.querySelector('#completed').open=true;document.querySelector('[data-undo]').click()");await wait("document.querySelector('progress').value===0");
  await js("document.querySelector('[data-view=settings]').click();document.querySelector('#edit-connection').click();window.confirm=()=>true");
  await login('second','intentionally-wrong');await wait("document.querySelector('#auth-error')?.textContent.includes('Invalid')");
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.json()).then(x=>x.username)"),'acceptance');
  await js("document.querySelector('#cancel-connection').click();document.querySelector('#edit-connection').click();window.confirmedSwitches=0;window.confirm=()=>{window.confirmedSwitches++;return true}");
  await login('second');await wait("!!document.querySelector('.focus-card')");
  assert.equal(await js('window.confirmedSwitches'),1);
  assert.equal(await js("fetch('/api/state').then(r=>r.json()).then(x=>x.tasks.length)"),0);
  checks.push('failed credentials preserve session and confirmed account switch isolates data');
  const secondToken=(await api('/api/auth/login',{username:'second',password})).token;
  await api('/api/tasks',{title:'Single current task',notes:'Only task in this isolated account',category:'Testing',repeat:'once',interval:1,startDate:today,priority:0},secondToken);
  await js("window.dispatchEvent(new Event('focus'))");await wait("!!document.querySelector('.focus-card h2 button')");
  assert.equal((await api('/api/state',undefined,secondToken)).today.length,1);
  assert.equal(await js("document.querySelectorAll('.queue-row').length"),0);
  await currentTitlePopup('Single task');
  await js("document.querySelector('.focus-card h2 button').click()");
  const currentPopupScreenshot=join(root,'web-current-task-popup.png');
  await writeFile(currentPopupScreenshot,Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await js("document.querySelector('[data-make-current]').click()");
  assert.equal(await js("document.querySelector('.focus-card h2').textContent"),'Single current task');
  await js("document.querySelector('.focus-card h2 button').click();document.querySelector('#occurrence-complete').click()");
  await wait("document.querySelector('progress').value===1");
  assert.equal((await api('/api/state',undefined,secondToken)).progress.completed,1,'single current popup completion independently read back');
  checks.push('single current popup Make current and Mark done with independent API readback');
  await js("document.querySelector('[data-view=settings]').click();document.querySelector('#edit-connection').click()");
  await login('acceptance');await wait("!!document.querySelector('[data-complete]')");
  await js("document.querySelector('#view [data-complete]').click()");await wait("document.querySelector('progress').value===1");
  assert.equal(await js("document.querySelector('#completed').open"),false,'completed disclosure resets on account replacement');
  await js("document.querySelector('[data-undo]').click()");await wait("document.querySelector('progress').value===0");
  checks.push('completed disclosure resets after account switch');
  await js("document.querySelector('#add-task').click();document.querySelector('#title').value='Created in browser';document.querySelector('#task-form').requestSubmit()");
  await wait("document.querySelector('#notice').textContent.includes('Task added')");
  assert.ok((await api('/api/state',undefined,token)).tasks.some(t=>t.title==='Created in browser'));
  checks.push('browser task creation independently read back');
  await js("document.querySelector('[data-view=routines]').click();const row=[...document.querySelectorAll('.task-row')].find(row=>row.textContent.includes('Created in browser'));row.querySelector('[data-menu-trigger]').click();row.querySelector('[data-archive]').click()");
  assert.equal(await js("document.querySelector('#archive-dialog').open"),true);
  await js("document.querySelector('#confirm-archive').click()");await wait("document.querySelector('#notice').textContent.includes('Task archived')");
  assert.ok(!(await api('/api/state',undefined,token)).tasks.some(t=>t.title==='Created in browser'));
  checks.push('per-task archive menu uses existing confirmation and independent deletion readback');
  await js("document.querySelector('[data-view=today]').click()");
  for(const [width,height] of [[320,740],[390,844],[1440,1000]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<760});
    assert.equal(await js('document.documentElement.scrollWidth>innerWidth'),false,`horizontal overflow at ${width}`);
  }
  checks.push('320/390/1440px layouts');
  const screenshot=join(root,'web-acceptance.png');
  await writeFile(screenshot,Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await js("document.querySelector('[data-view=settings]').click()");
  await cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await js("document.querySelector('#sign-out').click()");await wait("document.querySelector('#notice').textContent.includes('revocation could not be confirmed')");
  assert.equal(await js("document.querySelector('#occurrence-title').textContent+document.querySelector('#occurrence-content').textContent"),'','offline sign-out clears hidden popup task data');
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await navigate();
  assert.ok(await js("!!document.querySelector('#auth-form') && !document.querySelector('.focus-card') && localStorage.getItem('daymark-signed-out-v1')==='1'"));
  await login('acceptance');await wait("!!document.querySelector('[data-complete]')");
  assert.ok(await js('localStorage.length===0'));
  await js("document.querySelector('[data-view=settings]').click();document.querySelector('#sign-out').click()");await wait("document.querySelector('#notice').textContent==='Signed out.'");
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.status)"),401);
  assert.equal(await js("document.querySelector('#occurrence-title').textContent+document.querySelector('#occurrence-content').textContent"),'','sign-out clears hidden popup task data');
  checks.push('offline logout survives reload, explicit re-login and server logout revokes cookie');
  assert.deepEqual(runtimeErrors,[],'no uncaught browser exceptions');
  const result={passed:true,scope:'Actual Go HTTP API and real Chromium; isolated accounts/database only',checks,screenshot,currentPopupScreenshot};
  await writeFile(join(root,'web-result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {
  socket?.close();
  for(const process of [chrome,apiProcess]) {
    if(!process || process.exitCode!==null)continue;
    const exited=new Promise(resolve=>process.once('exit',resolve));
    process.kill('SIGTERM');
    await Promise.race([exited,delay(5000)]);
    if(process.exitCode===null)process.kill('SIGKILL');
  }
}
