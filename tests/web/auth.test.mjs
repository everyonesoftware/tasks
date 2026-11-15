import test from 'node:test';
import assert from 'node:assert/strict';
const auth = await import('../../apps/web/auth.mjs').catch(()=>({}));
test('setup status is strictly validated and fetched without restoring a cookie session', async()=>{
  let result=response({setupRequired:true}), sent;
  const c=auth.createConnection({fetcher:async(path,options)=>{sent=[path,options];if(result instanceof Error) throw result;return result;}});
  assert.equal(typeof c.setupStatus,'function');
  assert.equal(await c.setupStatus(),true);
  assert.equal(sent[0],'/api/auth/setup');
  assert.equal(sent[1].credentials,'same-origin');
  assert.equal(sent[1].redirect,'error');assert.equal(sent[1].cache,'no-store');
  assert.equal(c.session,null);assert.equal(c.connected,false);
  result=response({setupRequired:false});assert.equal(await c.setupStatus(),false);
  for (const malformed of [{},null,{setupRequired:'false'},{setupRequired:0}]) {
    result=response(malformed);await assert.rejects(c.setupStatus(),/setup status/i);
  }
  result=response({},503);await assert.rejects(c.setupStatus(),/unavailable/i);
  result=new Error('offline');await assert.rejects(c.setupStatus(),/Connection required/);
  result={ok:true,status:200,json:async()=>{throw new Error('invalid JSON')}};
  await assert.rejects(c.setupStatus(),/could not be read/i);
});
test('setup accepts a verified session using only the cookie and exact ephemeral credentials', async()=>{
  const items=new Map([['daymark-signed-out-v1','1']]);
  const storage={get length(){return items.size},key:i=>[...items.keys()][i],getItem:k=>items.get(k),removeItem:k=>items.delete(k),setItem:(k,v)=>items.set(k,v)};
  let sent;
  const c=auth.createConnection({storage,fetcher:async(path,options)=>{sent=[path,options];return response({username:'dan',expiresAt:'later',token:'never-retain-token'},201);}});
  assert.equal(typeof c.setup,'function');
  await c.setup('one-time-key','dan',' untrimmed password ');
  assert.deepEqual(JSON.parse(sent[1].body),{setupKey:'one-time-key',username:'dan',password:' untrimmed password '});
  assert.equal(sent[0],'/api/auth/setup');assert.equal(sent[1].method,'POST');
  assert.equal(sent[1].credentials,'same-origin');assert.equal(sent[1].redirect,'error');assert.equal(sent[1].cache,'no-store');
  assert.deepEqual(c.session,{username:'dan',expiresAt:'later'});assert.equal(c.connected,true);
  assert.equal(items.size,0);assert.doesNotMatch(JSON.stringify(c),/one-time-key|password|never-retain-token/);
});
test('bad proposed setup or login session does not replace a working account', async()=>{
  let result=response({username:'old'}),clears=0;
  const c=auth.createConnection({onClear:()=>clears++,fetcher:async()=>result});
  await c.check();const old=c.session;
  result=response({username:'<invalid>'},201);
  assert.equal(typeof c.setup,'function');
  await assert.rejects(c.setup('key','new','password'),/invalid session/);
  assert.equal(c.session,old);assert.equal(c.connected,true);assert.equal(clears,0);
  await assert.rejects(c.login('new','password'),/invalid session/);
  assert.equal(c.session,old);assert.equal(c.connected,true);assert.equal(clears,0);
});
test('setup errors explain key, validation, conflict and rate limiting without expiring a session', async()=>{
  let result=response({username:'old'});
  const c=auth.createConnection({fetcher:async()=>result});await c.check();const old=c.session;
  for (const [status,message] of [[401,/setup key.*invalid or expired/i],[400,/username.*password/i],[409,/already set up/i],[429,/30 seconds/i]]) {
    result={...response({},status),headers:{get:name=>name==='Retry-After'?'30':null}};
    await assert.rejects(c.setup('key','new','password'),error=>error.status===status && message.test(error.message));
    assert.equal(c.session,old);assert.equal(c.connected,true);
  }
});
test('task access requires authentication; 401 and network loss erase memory', async()=>{
  let clears=0, result=response({username:'dan'}), calls=0;
  const c=auth.createConnection({onClear:()=>clears++,fetcher:async()=>{calls++;if(result instanceof Error) throw result;return result;}});
  await assert.rejects(c.request('/api/tasks',{method:'POST',body:'{}'}), /Sign in/);
  assert.equal(calls,0);
  await c.check();
  result=response({},401);
  await assert.rejects(c.request('/api/state'), /Sign in/);
  assert.equal(c.session,null); assert.equal(c.connected,false); assert.equal(clears,1);
  result=response({username:'dan'}); await c.check();
  result=new Error('network');
  await assert.rejects(c.request('/api/state'), /Connection required/);
  assert.equal(c.connected,false); assert.equal(clears,2);
});
test('credential replacement uses a cookie, keeps old session on invalid credentials and never retains token/password', async()=>{
  let result=response({username:'old',token:'secret'}), sent;
  let clears=0;
  const c=auth.createConnection({onClear:()=>clears++,fetcher:async(path,options)=>{sent=[path,options];return result}});
  await c.check(); const old=c.session;
  result=response({},401);
  await assert.rejects(c.login('new',' bad password '), /credentials/);
  assert.equal(c.session,old);assert.equal(c.connected,true);assert.equal(clears,0);
  result=response({username:'new',expiresAt:'later',token:'secret'});
  await c.login('new',' untrimmed password ');
  assert.deepEqual(c.session,{username:'new',expiresAt:'later'});
  assert.equal(clears,1);
  assert.equal(JSON.parse(sent[1].body).password,' untrimmed password ');
  assert.equal(sent[1].redirect,'error');
  assert.doesNotMatch(JSON.stringify(c), /secret|password/);
  await assert.rejects(c.request('https://evil.example/api/auth/login'), /Only this server/);
});
test('logout clears memory even if remote revocation cannot be confirmed', async()=>{
  let fail=false, clears=0;
  const c=auth.createConnection({onClear:()=>clears++,fetcher:async()=>{if(fail) throw new Error('offline');return response({username:'dan'})}});
  await c.check();fail=true;
  const message=await c.logout();
  assert.equal(c.session,null); assert.equal(c.connected,false);assert.ok(clears);
  assert.match(message,/revocation could not be confirmed/);
});
test('late responses cannot resurrect a signed-out session or old account data', async()=>{
  let deliver;
  const c=auth.createConnection({fetcher:()=>new Promise(resolve=>{deliver=resolve})});
  const pending=c.check();
  c.clear(true);
  deliver(response({username:'old'}));
  await assert.rejects(pending,/Connection changed/);
  assert.equal(c.session,null);assert.equal(c.connected,false);
});
test('session logout during JSON parsing cannot restore the account', async()=>{
  let deliver;
  const c=auth.createConnection({fetcher:async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{deliver=resolve})})});
  const pending=c.check();
  await new Promise(resolve=>setImmediate(resolve));
  c.clear(true); deliver({username:'old'});
  await assert.rejects(pending,/Connection changed/);
  assert.equal(c.session,null);
});
test('late failed requests cannot disconnect a replacement session', async()=>{
  let rejectOld, calls=0;
  const c=auth.createConnection({fetcher:async()=>{calls++; if(calls===1) return new Promise((_,reject)=>{rejectOld=reject});return response({username:'new'});}});
  const pending=c.check();c.clear(true);await c.check();
  rejectOld(new Error('late offline'));await assert.rejects(pending);
  assert.equal(c.session.username,'new');assert.equal(c.connected,true);
});
test('malformed session responses clear task access rather than treating the browser as authenticated', async()=>{
  let result=response({username:'dan'}),clears=0;
  const c=auth.createConnection({onClear:()=>clears++,fetcher:async()=>result});
  await c.check();result=response({username:'<img src=x>'});
  await assert.rejects(c.check(),/invalid session/);
  assert.equal(c.session,null);assert.equal(c.connected,false);assert.equal(clears,1);
});
test('server failures require reconnection and purge task access', async()=>{
  let result=response({username:'dan'}),clears=0;
  const c=auth.createConnection({onClear:()=>clears++,fetcher:async()=>result});
  await c.check();result=response({},503);
  await assert.rejects(c.request('/api/state'),/Connection required/);
  assert.equal(c.connected,false);assert.equal(clears,1);
});
const response = (body, status=200) => ({ok:status<400,status,json:async()=>body});
test('offline logout survives reload and blocks automatic cookie restoration until explicit login', async()=>{
  const items = new Map();
  const storage = {get length(){return items.size},key:i=>[...items.keys()][i],getItem:k=>items.get(k)??null,setItem:(k,v)=>items.set(k,String(v)),removeItem:k=>items.delete(k)};
  let offline=false,invalid=false,calls=0;
  const fetcher=async()=>{calls++;if(offline) throw new Error('offline');return invalid ? response({},401) : response({username:'dan'});};
  const original=auth.createConnection({storage,fetcher});
  await original.check();offline=true;await original.logout();offline=false;
  const reloaded=auth.createConnection({storage,fetcher});
  const before=calls;
  await assert.rejects(reloaded.check(),/sign in/i);
  assert.equal(calls,before,'a signed-out browser must not ask the surviving cookie to restore access');
  assert.equal(reloaded.session,null);
  invalid=true;
  await assert.rejects(reloaded.login('dan','wrong-test-only-password'),/credentials/i);
  const afterFailure=auth.createConnection({storage,fetcher});
  const failedCalls=calls;
  await assert.rejects(afterFailure.check(),/sign in/i);
  assert.equal(calls,failedCalls,'failed explicit login must retain reload suppression');
  assert.equal(items.get('daymark-signed-out-v1'),'1');
  invalid=false;
  await reloaded.login('dan','test-only-password');
  await reloaded.check();assert.equal(reloaded.session.username,'dan');
  const signedBackIn=auth.createConnection({storage,fetcher});
  await signedBackIn.check();assert.equal(signedBackIn.session.username,'dan');
  assert.ok([...items].every(([key,value])=>!/(password|token|tasks)/i.test(key+value)));
});
test('startup purges legacy task payload and order caches before checking cookie session', async()=>{
  assert.equal(typeof auth.createConnection,'function');
  const items = new Map([['daymark-state-v1','secret tasks'],['daymark-order-2026-11-14','ids'],['unrelated','keep']]);
  const storage = {get length(){return items.size},key:i=>[...items.keys()][i],removeItem:k=>items.delete(k)};
  const calls=[];
  const connection=auth.createConnection({storage,fetcher:async(path,options)=>{calls.push([path,options]);return response({username:'dan',expiresAt:'later'})}});
  assert.deepEqual([...items.keys()],['unrelated']);
  assert.equal(connection.session,null);
  await connection.check();
  assert.equal(connection.session.username,'dan');
  assert.equal(calls[0][0],'/api/auth/session');
  assert.equal(calls[0][1].credentials,'same-origin');
  assert.equal(calls[0][1].redirect,'error');
});
