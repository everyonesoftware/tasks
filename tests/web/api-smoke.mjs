// Real Chromium + Go API acceptance. All accounts and data are disposable.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'daymark-go-acceptance-'));
const binary = join(root, 'daymark');
const db = join(root, 'fixture.sqlite3');
const password = 'acceptance-only-password'; // Public test credential, never a user DB.
let apiProcess, chrome, socket;
const checks = [];
const build = spawnSync('go', ['build', '-o', binary, './cmd/daymark'], {cwd:resolve('.'), encoding:'utf8'});
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
  const pending=new Map();
  socket.addEventListener('message',event=>{
    const reply=JSON.parse(event.data);
    const entry=pending.get(reply.id);
    if(!entry)return;
    clearTimeout(entry.timer);pending.delete(reply.id);
    reply.error?entry.reject(new Error(JSON.stringify(reply.error))):entry.resolve(reply.result);
  });
  function cdp(method,params={}) {
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);
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
  await cdp('Network.enable');await navigate();
  assert.ok(await js("document.querySelector('#password').value==='' && document.querySelector('#server-origin').readOnly"));
  checks.push('first-login and current origin');
  await login('acceptance');await wait("!!document.querySelector('[data-complete]')");
  assert.equal(await js("!!document.querySelector('#view img') || !!window.xss"),false);
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.json()).then(x=>x.username)"),'acceptance');
  assert.ok(!(await js('document.cookie')).includes('daymark_session'));
  assert.ok(await js('localStorage.length===0 && sessionStorage.length===0'));
  checks.push('HttpOnly cookie, XSS escaping and no browser task/credential storage');
  await js("document.querySelector('[data-complete]').click()");await wait("document.querySelector('progress').value===1");
  assert.equal((await api('/api/state',undefined,token)).progress.completed,1);
  await js("document.querySelector('[data-undo]').click()");await wait("document.querySelector('progress').value===0");
  assert.equal((await api('/api/state',undefined,token)).progress.completed,0);
  checks.push('completion and undo independently read back');
  await js("document.querySelector('[data-view=settings]').click();document.querySelector('#edit-connection').click();window.confirm=()=>true");
  await login('second','intentionally-wrong');await wait("document.querySelector('#auth-error')?.textContent.includes('Invalid')");
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.json()).then(x=>x.username)"),'acceptance');
  await js("document.querySelector('#cancel-connection').click();document.querySelector('#edit-connection').click();window.confirmedSwitches=0;window.confirm=()=>{window.confirmedSwitches++;return true}");
  await login('second');await wait("!!document.querySelector('.focus-card')");
  assert.equal(await js('window.confirmedSwitches'),1);
  assert.equal(await js("fetch('/api/state').then(r=>r.json()).then(x=>x.tasks.length)"),0);
  checks.push('failed credentials preserve session and confirmed account switch isolates data');
  await js("document.querySelector('[data-view=settings]').click();document.querySelector('#edit-connection').click()");
  await login('acceptance');await wait("!!document.querySelector('[data-complete]')");
  await js("document.querySelector('#add-task').click();document.querySelector('#title').value='Created in browser';document.querySelector('#task-form').requestSubmit()");
  await wait("document.querySelector('#notice').textContent.includes('Task added')");
  assert.ok((await api('/api/state',undefined,token)).tasks.some(t=>t.title==='Created in browser'));
  checks.push('browser task creation independently read back');
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
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await navigate();
  assert.ok(await js("!!document.querySelector('#auth-form') && !document.querySelector('.focus-card') && localStorage.getItem('daymark-signed-out-v1')==='1'"));
  await login('acceptance');await wait("!!document.querySelector('[data-complete]')");
  assert.ok(await js('localStorage.length===0'));
  await js("document.querySelector('[data-view=settings]').click();document.querySelector('#sign-out').click()");await wait("document.querySelector('#notice').textContent==='Signed out.'");
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.status)"),401);
  checks.push('offline logout survives reload, explicit re-login and server logout revokes cookie');
  const result={passed:true,scope:'Actual Go HTTP API and real Chromium; isolated accounts/database only',checks,screenshot};
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
