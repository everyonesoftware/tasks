"""Real Chromium + Daymark API acceptance, ONLY isolated scratch accounts.
Requires preinstalled websockets and Chromium; never targets a user's database.
Start python3 tests/web/api_fixture.py first on this host.
"""
import base64
from datetime import date
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
from websockets.sync.client import connect

context=json.loads(Path('/opt/data/cache/scratch/daymark-acceptance-context.json').read_text())
assert Path(context['root']).is_relative_to('/opt/data/cache/scratch')
origin=context['origin'];assert origin=='http://127.0.0.1:8793'
password='acceptance-only-password'  # Public, disposable test fixture, NEVER a user credential.

def api(path,body=None,token=None,method=None):
    headers={'Accept':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    if body is not None: headers['Content-Type']='application/json'
    request=urllib.request.Request(origin+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
    with urllib.request.urlopen(request,timeout=15) as response:
        data=response.read()
        return json.loads(data) if data else None

token=api('/api/auth/login',{'username':'acceptance','password':password})['token']
assert api('/api/state',token=token)['tasks']==[], 'Fresh fixture DB required'
for title in ['API acceptance task','Weekly acceptance','<img src=x onerror=window.xss=1>']:
    api('/api/tasks',{'title':title,'notes':'Acceptance fixture only','category':'Testing','repeat':'daily','interval':1,'startDate':date.today().isoformat(),'priority':0},token)

with tempfile.TemporaryDirectory(prefix='daymark-chromium-',dir='/opt/data/cache/scratch',ignore_cleanup_errors=True) as profile:
    chrome=subprocess.Popen(['chromium','--headless','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    ws=None
    try:
        active=Path(profile)/'DevToolsActivePort'
        for _ in range(150):
            if active.exists(): break
            assert chrome.poll() is None,'Chromium exited'
            time.sleep(.1)
        port=active.read_text().splitlines()[0]
        pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list'))
        ws=connect(next(p['webSocketDebuggerUrl'] for p in pages if p['type']=='page'),max_size=20*1024*1024)
        sequence=0
        def cdp(method,**params):
            global sequence
            sequence+=1;seq=sequence;ws.send(json.dumps({'id':seq,'method':method,'params':params}))
            while True:
                response=json.loads(ws.recv(timeout=20))
                if response.get('id')==seq:
                    assert 'error' not in response,response
                    return response.get('result',{})
        def js(code):
            result=cdp('Runtime.evaluate',expression=code,returnByValue=True,awaitPromise=True)
            assert 'exceptionDetails' not in result,result
            return result.get('result',{}).get('value')
        def wait(code,seconds=15):
            deadline=time.monotonic()+seconds
            while time.monotonic()<deadline:
                if js(code): return
                time.sleep(.1)
            raise AssertionError('Timed out: '+code+'; page='+str(js('document.body.innerText')))
        def navigate():
            cdp('Page.navigate',url=origin)
            wait("document.readyState==='complete' && !!document.querySelector('#auth-form,.focus-card')")
        def login(username,passphrase=password):
            js("document.querySelector('#username').value="+json.dumps(username)+";document.querySelector('#password').value="+json.dumps(passphrase)+";document.querySelector('#auth-form').requestSubmit()")
        cdp('Network.enable');navigate()
        assert js("document.querySelector('#password').value==='' && document.querySelector('#server-origin').readOnly")
        login('acceptance');wait("!!document.querySelector('[data-complete]')")
        assert not js("document.querySelector('#view img') || window.xss")
        assert js("fetch('/api/auth/session').then(r=>r.json()).then(x=>x.username)")=='acceptance'
        assert 'daymark_session' not in js('document.cookie'),'Session cookie must be HttpOnly'
        assert js('localStorage.length===0 && sessionStorage.length===0')
        js("document.querySelector('[data-complete]').click()")
        wait("document.querySelector('progress').value===1")
        assert api('/api/state',token=token)['progress']['completed']==1
        js("document.querySelector('[data-undo]').click()")
        wait("document.querySelector('progress').value===0")
        assert api('/api/state',token=token)['progress']['completed']==0
        js("document.querySelector('[data-view=settings]').click()")
        assert js("document.querySelector('#view').textContent.includes('0.2.0')")
        js("document.querySelector('#edit-connection').click()")
        js("window.confirmedSwitches=0;window.confirm=()=>{window.confirmedSwitches++;return true}")
        login('second','intentionally-wrong')
        wait("document.querySelector('#auth-error')?.textContent.includes('Invalid')")
        assert js("fetch('/api/auth/session').then(r=>r.json()).then(x=>x.username)")=='acceptance'
        js("document.querySelector('#cancel-connection').click();document.querySelector('#edit-connection').click();window.confirmedSwitches=0;window.confirm=()=>{window.confirmedSwitches++;return true}")
        login('second');wait("!!document.querySelector('.focus-card')")
        assert js('window.confirmedSwitches')==1
        assert not js("document.querySelector('#view').textContent.includes('API acceptance task')")
        assert js("fetch('/api/state').then(r=>r.json()).then(x=>x.tasks.length)")==0
        js("document.querySelector('[data-view=settings]').click();document.querySelector('#edit-connection').click()")
        login('acceptance');wait("!!document.querySelector('[data-complete]')")
        # Exercise actual browser task form -> POST -> real API read-back.
        js("document.querySelector('#add-task').click();document.querySelector('#title').value='Created in browser';document.querySelector('#task-form').requestSubmit()")
        wait("document.querySelector('#notice').textContent.includes('Task added')")
        assert any(t['title']=='Created in browser' for t in api('/api/state',token=token)['tasks'])
        for width,height in [(320,740),(390,844),(1440,1000)]:
            cdp('Emulation.setDeviceMetricsOverride',width=width,height=height,deviceScaleFactor=1,mobile=width<760)
            assert not js('document.documentElement.scrollWidth>innerWidth'),f'Horizontal overflow: {width}'
        screenshot=Path(context['root'])/'web-acceptance.png'
        screenshot.write_bytes(base64.b64decode(cdp('Page.captureScreenshot',format='png')['data']))
        js("document.querySelector('[data-view=settings]').click()")
        cdp('Network.emulateNetworkConditions',offline=True,latency=0,downloadThroughput=-1,uploadThroughput=-1)
        js("document.querySelector('#sign-out').click()")
        wait("document.querySelector('#notice').textContent.includes('revocation could not be confirmed')")
        cdp('Network.emulateNetworkConditions',offline=False,latency=0,downloadThroughput=-1,uploadThroughput=-1)
        navigate()
        assert js("!!document.querySelector('#auth-form') && !document.querySelector('.focus-card')"),'Reload restored offline-signed-out session'
        assert js("localStorage.getItem('daymark-signed-out-v1')==='1'")
        login('acceptance');wait("!!document.querySelector('[data-complete]')")
        assert js('localStorage.length===0')
        js("document.querySelector('[data-view=settings]').click();document.querySelector('#sign-out').click()")
        wait("document.querySelector('#notice').textContent==='Signed out.'")
        assert js("fetch('/api/auth/session').then(r=>r.status)")==401
        result={'passed':True,'scope':'Actual Python HTTP API, real Chromium cookies, temporary accounts/database only','checks':['first-login','HttpOnly cookie','XSS escaping','completion and undo read-back','failed connection preserves session','confirmed two-account isolation','browser task create read-back','320/390/1440 layout','offline logout survives reload','explicit re-login','server logout revokes cookie'],'screenshot':str(screenshot)}
        (Path(context['root'])/'web-result.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result,indent=2))
    finally:
        if ws:
            try: cdp('Browser.close')
            except Exception: pass
            ws.close()
        try: chrome.wait(timeout=10)
        except subprocess.TimeoutExpired:
            chrome.terminate()
            try: chrome.wait(timeout=5)
            except subprocess.TimeoutExpired: chrome.kill();chrome.wait()
