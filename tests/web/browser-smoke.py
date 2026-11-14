# Browser fixtures only: no real API, authentication, or HTTP integration asserted.
# Run with browser_exec after static-only server on 8791.
import json
origin = 'http://127.0.0.1:8791'
new_tab(origin)
wait_for_load()
assert js("fetch('/api/auth/session').then(r=>r.status)") == 404, 'Requires isolated static-only origin'
fixture = r"""(() => {
  localStorage.setItem('daymark-state-v1','legacy private task');
  localStorage.setItem('daymark-order-2026-11-14','private ids');
  window.fixtureCalls=[]; window.fixtureUser=null; window.fixtureOffline=false; window.confirm=()=>true;
  const realFetch=window.fetch;
  window.fetch=async(path,options={})=>{
    if(!String(path).startsWith('/api/')) return realFetch(path,options);
    window.fixtureCalls.push({path,method:options.method,redirect:options.redirect});
    if(window.fixtureOffline) throw new TypeError('fixture offline');
    if(path==='/api/auth/login') {
      const body=JSON.parse(options.body);
      if(body.password!=='fixture password') return new Response('{}',{status:401});
      window.fixtureUser=body.username;
      return Response.json({username:body.username,expiresAt:'2099-01-01',token:'must-not-persist'});
    }
    if(path==='/api/auth/logout') {window.fixtureUser=null;return new Response(null,{status:204});}
    if(!window.fixtureUser || window.fixtureExpired) return new Response('{}',{status:401});
    if(path==='/api/auth/session') return Response.json({username:window.fixtureUser,expiresAt:'2099-01-01'});
    const d=new Date();const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const tasks=['<img src=x onerror=alert(1)> & title','Second task','Third task'].map((title,i)=>({id:`fixture-${i}`,title,notes:'Readable <script>literal</script>',category:'Fixtures',repeat:'daily',interval:1,startDate:date,priority:0}));
    return Response.json({date,tasks,today:tasks.map(t=>({...t,taskId:t.id,occurrenceId:`${t.id}@${date}`,dueDate:date,completed:false,overdue:false})),upcoming:[],progress:{completed:0,total:3}});
  };
})()"""
identifier=cdp('Page.addScriptToEvaluateOnNewDocument',source=fixture)['identifier']
goto_url(origin);wait_for_load()
assert js("!!document.querySelector('#auth-form')"), 'First login form missing'
assert js("document.querySelector('#server-origin').readOnly && document.querySelector('#server-origin').value===location.origin")
assert js("localStorage.getItem('daymark-state-v1')===null && !Object.keys(localStorage).some(k=>k.startsWith('daymark-order-'))")
js("document.querySelector('#username').value='fixture-user';document.querySelector('#password').value='fixture password';document.querySelector('#auth-form').requestSubmit()")
import time
time.sleep(.4)
assert js("!!document.querySelector('[data-complete]')"), 'Authenticated task view missing'
assert js("!document.querySelector('#view img,#view script') && document.querySelector('.focus-card h2').textContent.startsWith('<img')")
assert js("localStorage.length===0 && sessionStorage.length===0"), 'Data or credentials persisted'
js("document.querySelector('#task-menu-trigger').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
assert js("document.querySelector('#task-menu').hidden && document.activeElement.id==='task-menu-trigger'"), 'Menu Escape focus regression'
js("document.querySelector('#task-menu-trigger').click();document.querySelector('[data-defer]').click()")
assert js("document.querySelector('.focus-card h2').textContent")=='Second task'
js("document.querySelector('[data-pick]').click()")
assert js("document.querySelector('.focus-card h2').textContent")=='Third task'
for width,height in [(320,740),(390,844),(1440,1000)]:
    cdp('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=width<760)
    assert not js('document.documentElement.scrollWidth>innerWidth'), f'Overflow {width}'
    assert js("[...document.querySelectorAll('#navigation button')].every(b=>getComputedStyle(b).fontSize==='16px')"), 'Navigation type too small'
    assert js("getComputedStyle(document.querySelector('.task-notes')).fontSize==='16px' && getComputedStyle(document.querySelector('.row-copy strong')).fontSize==='18px'")
js("document.querySelector('[data-view=settings]').click()")
assert js("document.querySelector('#view').textContent.includes('0.2.0') && !!document.querySelector('a[href=\"https://github.com/everyonesoftware/tasks/releases\"]')")
js("document.querySelector('#edit-connection').click();document.querySelector('#username').value='other';document.querySelector('#password').value='wrong password';document.querySelector('#auth-form').requestSubmit()")
time.sleep(.3)
assert js("document.querySelector('#auth-error').textContent.includes('Invalid') && document.querySelector('#password').value===''")
js("document.querySelector('#cancel-connection').click();document.querySelector('[data-view=today]').click();window.fixtureOffline=true;window.dispatchEvent(new Event('offline'))")
assert js("!document.querySelector('[data-complete]') && !document.querySelector('.focus-card')"), 'Offline tasks leaked'
js("window.fixtureOffline=false;window.fixtureExpired=true;document.querySelector('#retry').click()")
time.sleep(.3)
assert js("!!document.querySelector('#auth-form') && !document.querySelector('.focus-card')"), '401 did not clear tasks'
assert js("window.fixtureCalls.every(c=>c.redirect==='error')"), 'Redirect credentials risk'
js("window.fixtureExpired=false;document.querySelector('#username').value='fixture-user';document.querySelector('#password').value='fixture password';document.querySelector('#auth-form').requestSubmit()")
time.sleep(.3)
js("document.querySelector('[data-view=settings]').click();document.querySelector('#edit-connection').click();document.querySelector('#username').value='other';document.querySelector('#password').value='fixture password';document.querySelector('#auth-form').requestSubmit()")
time.sleep(.3)
assert js("document.querySelector('.focus-card h2').textContent.startsWith('<img')"), 'Account switch retained old focus order'
js("document.querySelector('[data-view=settings]').click()")
assert js("document.querySelector('#view dd:nth-of-type(2)').textContent==='other'"), 'Account switch failed'
js("window.fixtureOffline=true;document.querySelector('#sign-out').click()")
time.sleep(.3)
assert js("!!document.querySelector('#auth-form') && !document.querySelector('.focus-card') && document.querySelector('#notice').textContent.includes('revocation could not be confirmed')"), 'Offline sign-out warning/clearing failed'
js("window.dispatchEvent(new Event('focus'))")
time.sleep(.1)
assert js("!!document.querySelector('#auth-form') && !document.querySelector('.focus-card')"), 'Automatic reconnect bypassed local sign-out'
assert js("Object.keys(localStorage).every(k=>k==='daymark-signed-out-v1') && sessionStorage.length===0"), 'Persisted client data after logout'
cdp('Page.removeScriptToEvaluateOnNewDocument',identifier=identifier)
print('PASS: isolated browser fixtures: first login, cookie-request options, cache purge, XSS, memory-only queue, typography/layout, Settings/About, failed replacement, offline/401 clearing. NOT real HTTP/API evidence.')
