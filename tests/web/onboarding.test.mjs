import test from 'node:test';
import assert from 'node:assert/strict';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
let sequence=0;
// Deliberately small DOM seam: actual auth/render code runs; Chromium verifies layout.
async function browser(fetcher) {
  const nodes=new Map(), events=new Map(), windowEvents=new Map();
  const dynamic=new Set();
  class Element {
    constructor(id='',tag='div') { this.id=id;this.tag=tag;this.value='';this.hidden=false;this.disabled=false;this.dataset={};this._html='';this.textContent='';this.classList={toggle(){}}; }
    set innerHTML(html) {
      this._html=html;
      if(this.id!=='view') return;
      for(const id of dynamic) nodes.delete(id);dynamic.clear();
      for(const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const node=new Element(match[3],match[1]);node.value=match[2].match(/\bvalue="([^"]*)"/)?.[1]||'';
        node.hidden=/\bhidden\b/.test(match[2]);nodes.set(node.id,node);dynamic.add(node.id);
      }
      const button=new Element('submit','button');button.type='submit';nodes.set('submit',button);dynamic.add('submit');
    }
    get innerHTML(){return this._html;}
    replaceChildren(){this.innerHTML='';}
    setAttribute(name,value){this[name]=value;}
    querySelectorAll(){return [...dynamic].map(id=>nodes.get(id)).filter(node=>['input','button'].includes(node.tag));}
    querySelector(){return nodes.get('submit');}
    addEventListener(){}
    reset(){}
    focus(){}
    closest(){return this;}
  }
  for(const id of ['view','navigation','add-task','connection','notice','task-form','archive-copy','repeat','content','shell','sidebar','app-top']) nodes.set(id,new Element(id));
  globalThis.document={querySelector:s=>nodes.get(s.replace(/^[#.]/,''))||null,querySelectorAll:()=>[],addEventListener:(name,fn)=>events.set(name,fn),activeElement:null,hidden:false,body:new Element('body')};
  globalThis.window={addEventListener:(name,fn)=>windowEvents.set(name,fn),confirm:()=>true};
  globalThis.location={origin:'http://localhost'};
  globalThis.localStorage={length:0,getItem:()=>null,removeItem(){},setItem(){throw new Error('No persistence expected');}};
  const calls=[];
  globalThis.fetch=async(path,options)=>{if(path==='/health')return response({version:'test'});calls.push(path);return fetcher(path,options);};
  const interval=globalThis.setInterval;globalThis.setInterval=()=>0;
  try { await import(`../../apps/web/app.mjs?test=${sequence++}`);await settle(); } finally {globalThis.setInterval=interval;}
  return {nodes,calls,windowEvents,submit:()=>events.get('submit')({target:nodes.get('setup-form'),preventDefault(){}}),click:id=>events.get('click')({target:nodes.get(id)}),settle};
}

test('initial setup detection precedes session/tasks and setup typing survives focus refresh',async()=>{
  const b=await browser(async path=>path==='/api/auth/setup'?response({setupRequired:true}):response({},401));
  assert.deepEqual(b.calls,['/api/auth/setup']);
  assert.ok(b.nodes.has('setup-form'));
  b.nodes.get('username').value='typed-name';b.nodes.get('setup-key').value='typed-key';
  const form=b.nodes.get('setup-form');
  await b.windowEvents.get('focus')();
  assert.equal(b.nodes.get('setup-form'),form);assert.equal(b.nodes.get('username').value,'typed-name');
  assert.equal(b.nodes.get('setup-key').value,'typed-key');assert.deepEqual(b.calls,['/api/auth/setup']);
});
test('setup submission blocks duplicate writes and opens the real empty Focus state after session acceptance',async()=>{
  let finish,submitted;
  const b=await browser(async(path,options)=>{
    if(path==='/api/auth/setup' && options?.method==='POST') {submitted=JSON.parse(options.body);return new Promise(resolve=>{finish=resolve});}
    if(path==='/api/auth/setup')return response({setupRequired:true});
    if(path==='/api/auth/session')return response({username:'dan'});
    if(path.startsWith('/api/state'))return response({date:new URL(path,'http://localhost').searchParams.get('date'),tasks:[],today:[],upcoming:[],progress:{completed:0,total:0}});
    throw new Error('unexpected request');
  });
  b.nodes.get('setup-key').value='test-key';b.nodes.get('username').value='dan';b.nodes.get('password').value='test-password';
  const key=b.nodes.get('setup-key'),password=b.nodes.get('password');
  const pending=b.submit();await settle();
  assert.deepEqual(submitted,{setupKey:'test-key',username:'dan',password:'test-password'});
  assert.equal(b.nodes.get('submit').disabled,true);await b.submit();
  assert.equal(b.calls.filter(path=>path==='/api/auth/setup').length,2);
  finish(response({username:'dan',expiresAt:'later',token:'do-not-retain'},201));await pending;
  assert.equal(key.value,'');assert.equal(password.value,'');
  assert.equal(b.nodes.has('setup-form'),false);assert.equal(b.nodes.has('password'),false);
  assert.match(b.nodes.get('view').innerHTML,/focus-card/);assert.match(b.nodes.get('view').innerHTML,/data-add/);
  assert.match(b.nodes.get('view').innerHTML,/Your first task goes here/);
  assert.match(b.nodes.get('view').innerHTML,/Waiting tasks/);
  assert.match(b.nodes.get('view').innerHTML,/No tasks yet/);
  assert.ok(b.calls.some(path=>path.startsWith('/api/state')));
});
test('setup rejection keeps useful fields and conflict moves to sign-in with explanation and no secrets',async()=>{
  let status=401;
  const b=await browser(async(path,options)=>response(options?.method==='POST'?{}:{setupRequired:true},options?.method==='POST'?status:200));
  b.nodes.get('setup-key').value='test-key';b.nodes.get('username').value='dan';b.nodes.get('password').value='test-password';
  const key=b.nodes.get('setup-key'),form=b.nodes.get('setup-form');
  await b.submit();
  assert.equal(b.nodes.get('setup-form'),form);assert.equal(b.nodes.get('username').value,'dan');
  assert.equal(key.value,'test-key');assert.equal(b.nodes.get('password').value,'');
  assert.match(b.nodes.get('setup-error').textContent,/key.*invalid or expired/i);
  assert.equal(b.nodes.get('submit').disabled,false);
  status=409;b.nodes.get('password').value='test-password';await b.submit();
  assert.equal(b.nodes.has('setup-form'),false);assert.equal(b.nodes.has('setup-key'),false);
  assert.ok(b.nodes.has('auth-form'));assert.match(b.nodes.get('auth-error').textContent,/already set up/i);
  assert.equal(key.value,'');assert.equal(b.nodes.get('password').value,'');
  assert.equal(b.calls.filter(path=>path==='/api/auth/session').length,0);
});
test('failed or malformed detection closes access and one visible Retry recovers without guessing setup',async()=>{
  for(const failure of [new Error('offline'),response({}),response({},503)]) {
    let fail=true;
    const b=await browser(async()=>{if(!fail)return response({setupRequired:true});if(failure instanceof Error)throw failure;return failure;});
    assert.deepEqual(b.calls,['/api/auth/setup']);
    assert.equal(b.nodes.has('setup-form'),false);assert.equal(b.nodes.has('auth-form'),false);
    assert.match(b.nodes.get('view').innerHTML,/couldn’t check this server/);
    assert.doesNotMatch(b.nodes.get('connection').innerHTML,/id="retry"/,'hidden task banner must not shadow the visible Retry ID');
    fail=false;b.click('retry');await settle();
    assert.ok(b.nodes.has('setup-form'));assert.deepEqual(b.calls,['/api/auth/setup','/api/auth/setup']);
  }
});
