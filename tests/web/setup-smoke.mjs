// Real first-run acceptance: fresh SQLite, startup key, actual API and Chromium.
// All credentials below are disposable fixtures, never a user's account.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'tasks-first-run-'));
const binary = join(root, 'tasks');
const db = join(root, 'fixture.sqlite3');
const username = 'first-owner';
const password = 'first-run-fixture-password';
let server, chrome, socket;
const checks = [], exceptions = [];
const build = spawnSync('go', ['build', '-o', binary, './cmd/tasks'], {cwd:resolve('.'), encoding:'utf8'});
assert.equal(build.status, 0, build.stderr);
let stderr = '';
async function waitFor(fn, label, timeout=20000) {
  const end = Date.now()+timeout;
  while (Date.now()<end) { if (await fn()) return; await delay(80); }
  throw new Error('Timed out: '+label);
}
try {
  server = spawn(binary, ['serve', '--port', '0', '--db', db], {stdio:['ignore','pipe','pipe']});
  let stdout = '';
  server.stdout.on('data', chunk => stdout += chunk);
  server.stderr.on('data', chunk => stderr += chunk);
  await waitFor(()=>/http:\/\/127\.0\.0\.1:\d+/.test(stdout), 'server startup');
  const origin = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const setupStatus = await fetch(origin+'/api/auth/setup');
  assert.equal(setupStatus.status, 200, 'fresh server must expose first-run status before authentication');
  assert.deepEqual(await setupStatus.json(), {setupRequired:true});
  assert.equal(setupStatus.headers.get('cache-control'), 'no-store');
  checks.push('fresh server reports setup required, without credentials or task access');
  await waitFor(()=>/^Setup key: [A-Za-z0-9_-]{43}$/m.test(stderr), 'startup setup key');
  const setupKey = stderr.match(/^Setup key: ([A-Za-z0-9_-]{43})$/m)[1];
  checks.push('startup logs supply the one-time setup key without an administrator command');
  const profile = join(root, 'chromium');
  chrome = spawn('chromium', ['--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'], {stdio:'ignore'});
  let port;
  await waitFor(async()=>{try {port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];return !!port;}catch{return false;}}, 'Chromium startup');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;
  const pending = new Map();
  socket.addEventListener('message', event=>{
    const reply=JSON.parse(event.data);
    if(reply.method==='Runtime.exceptionThrown') exceptions.push(reply.params.exceptionDetails.text);
    const entry=pending.get(reply.id);
    if(!entry)return;
    clearTimeout(entry.timer);pending.delete(reply.id);
    reply.error?entry.reject(new Error(JSON.stringify(reply.error))):entry.resolve(reply.result);
  });
  function cdp(method,params={},sessionId) {
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);
      pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }
  async function js(expression,sessionId) {
    const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
    assert.ok(!result.exceptionDetails, 'Browser evaluation failed');
    return result.result?.value;
  }
  const wait=expression=>waitFor(()=>js(expression),expression);
  async function navigate(selector='#setup-form') {
    await cdp('Page.navigate',{url:origin});
    await wait(`document.readyState==='complete' && !!document.querySelector(${JSON.stringify(selector)})`);
  }
  async function capture(name) {
    const path=join(root,name);
    await writeFile(path, Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    return path;
  }
  async function fillSetup(key) {
    await js(`document.querySelector('#setup-key').value=${JSON.stringify(key)};document.querySelector('#username').value=${JSON.stringify(username)};document.querySelector('#password').value=${JSON.stringify(password)}`);
  }
  async function api(path, body, token) {
    const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error'});
    assert.ok(response.ok, `API ${path}: ${response.status}`);
    return response.status===204?null:response.json();
  }
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate();
  assert.equal(await js("document.querySelectorAll('#setup-form input:not([readonly])').length"),3);
  assert.equal(await js("document.querySelector('#password').autocomplete"),'new-password');
  assert.equal(await js("!!document.querySelector('dialog[open]') || !!document.querySelector('[data-view=today]')"),false);
  assert.ok(await js("document.querySelector('#setup-form button[type=submit]').textContent.includes('Create account')"));
  assert.equal(await js("document.querySelector('#setup-key').value + document.querySelector('#username').value + document.querySelector('#password').value"),'');
  assert.equal(await js("getComputedStyle(document.querySelector('.sidebar')).display"),'none');
  const desktopScreenshot=await capture('welcome-desktop.png');
  for(const [width,height] of [[320,740],[390,844],[1440,1000]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<760});
    assert.equal(await js('document.documentElement.scrollWidth>innerWidth'),false,`welcome overflow at ${width}`);
    assert.ok(await js("parseFloat(getComputedStyle(document.querySelector('#password')).fontSize)>=16"));
    if(width===390)await capture('welcome-phone.png');
  }
  checks.push('single-form welcome, hidden task shell, blank credentials, new-password semantics, 320/390/1440px layouts');
  await fillSetup('invalid-fixture-key');
  await js("document.querySelector('#setup-form').requestSubmit()");
  await wait("!!document.querySelector('#setup-error')?.textContent.trim() && !document.querySelector('#setup-form button[type=submit]').disabled");
  assert.equal(await js("document.querySelector('#username').value"),username);
  assert.deepEqual(await api('/api/auth/setup'),{setupRequired:true});
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.status)"),401);
  checks.push('invalid setup key stays on setup, preserves username, creates no session');
  // Keep a second real tab on setup while the first tab claims the server.
  const competingTarget=await cdp('Target.createTarget',{url:origin});
  const competing=await cdp('Target.attachToTarget',{targetId:competingTarget.targetId,flatten:true});
  await waitFor(()=>js("!!document.querySelector('#setup-form')",competing.sessionId),'competing setup tab');
  // Focus changes and periodic refresh must not erase an in-progress form.
  await fillSetup(setupKey);
  await js("window.dispatchEvent(new Event('focus'))");
  await delay(200);
  assert.equal(await js("document.querySelector('#username').value"),username);
  assert.equal(await js("document.querySelector('#setup-key').value"),setupKey);
  await js("document.querySelector('#setup-form').requestSubmit()");
  await wait("!!document.querySelector('.focus-card')");
  assert.equal(await js("!!document.querySelector('dialog[open]')"),false);
  assert.equal(await js("!!document.querySelector('#setup-key') || !!document.querySelector('#password')"),false);
  assert.deepEqual(await api('/api/auth/setup'),{setupRequired:false});
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.json()).then(x=>x.username)"),username);
  assert.equal(await js("fetch('/api/state').then(r=>r.json()).then(x=>x.tasks.length)"),0);
  assert.equal(await js("document.cookie.includes('daymark_session')"),false);
  assert.equal(await js('localStorage.length+sessionStorage.length'),0);
  const cookies=(await cdp('Network.getCookies',{urls:[origin]})).cookies;
  const sessionCookie=cookies.find(cookie=>cookie.name==='daymark_session');
  assert.ok(sessionCookie?.httpOnly);
  assert.equal(sessionCookie.sameSite,'Strict');
  checks.push('account setup establishes HttpOnly SameSite=Strict session and real empty workspace, without persistent credentials/tasks');
  await js(`document.querySelector('#setup-key').value=${JSON.stringify(setupKey)};document.querySelector('#username').value='competing-owner';document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('#setup-form').requestSubmit()`,competing.sessionId);
  await waitFor(()=>js("!!document.querySelector('#auth-form') && document.querySelector('#auth-error').textContent.includes('already set up')",competing.sessionId),'competing setup conflict');
  assert.equal(await js("!!document.querySelector('#setup-key') || !!document.querySelector('.focus-card') || document.querySelector('#password').value!==''",competing.sessionId),false);
  assert.equal(await js("fetch('/api/auth/session').then(r=>r.json()).then(x=>x.username)"),username);
  await cdp('Target.closeTarget',{targetId:competingTarget.targetId});
  checks.push('competing real browser tab receives setup conflict, clears secrets and offers sign-in without silently opening tasks');
  const token=(await api('/api/auth/login',{username,password})).token;
  await js("document.querySelector('[data-add]').click();document.querySelector('#title').value='First task from welcome';document.querySelector('#task-form').requestSubmit()");
  await wait("document.querySelector('#notice').textContent.includes('Task added')");
  assert.ok((await api('/api/state',undefined,token)).tasks.some(task=>task.title==='First task from welcome'));
  await navigate('.focus-card');
  assert.ok(await js("document.querySelector('.focus-card').textContent.includes('First task from welcome')"));
  checks.push('first task created from empty CTA, independently read back, restored from server on reload');
  const alreadySetup=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setupKey,username:'another-owner',password})});
  assert.equal(alreadySetup.status,409);
  const refusedKey=spawnSync(binary,['setup-key','--db',db],{encoding:'utf8'});
  assert.notEqual(refusedKey.status,0);
  assert.equal(refusedKey.stdout.trim(),'');
  checks.push('setup and key generation disabled after first account exists');
  await js("document.querySelector('[data-view=settings]').click();document.querySelector('#sign-out').click()");
  await wait("!!document.querySelector('#auth-form')");
  assert.equal(await js("!!document.querySelector('#setup-form')"),false);
  await navigate('#auth-form');
  await js(`document.querySelector('#username').value=${JSON.stringify(username)};document.querySelector('#password').value=${JSON.stringify(password)};document.querySelector('#auth-form').requestSubmit()`);
  await wait("!!document.querySelector('.focus-card')");
  checks.push('subsequent sign-out/reload shows sign-in and original account can log back in');
  // Status failure must not be treated as a fresh installation or sign-in state.
  await cdp('Network.setBlockedURLs',{urls:[origin+'/api/auth/setup']});
  await cdp('Page.navigate',{url:origin});
  await wait("document.readyState==='complete' && !!document.querySelector('#retry') && !document.querySelector('#retry').disabled");
  assert.equal(await js("!!document.querySelector('#setup-form') || !!document.querySelector('#auth-form')"),false);
  await cdp('Network.setBlockedURLs',{urls:[]});
  await js("document.querySelector('#retry').click()");
  await wait("!!document.querySelector('.focus-card')");
  checks.push('unavailable setup status fails closed and Retry recovers the authenticated session');
  assert.deepEqual(exceptions,[],'uncaught browser exceptions');
  const result={passed:true,scope:'Actual operator CLI, Go API and Chromium; fresh disposable database only',checks,desktopScreenshot,phoneScreenshot:join(root,'welcome-phone.png')};
  await writeFile(join(root,'setup-result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {
  socket?.close();
  for(const child of [chrome,server]) {
    if(!child||child.exitCode!==null)continue;
    const exited=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');await Promise.race([exited,delay(5000)]);
    if(child.exitCode===null)child.kill('SIGKILL');
  }
}
