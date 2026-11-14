export function purgeLegacy(storage) {
  try {
    const keys = Array.from({length:storage.length}, (_,i)=>storage.key(i));
    for (const key of keys) if (key === 'daymark-state-v1' || key?.startsWith('daymark-order-')) storage.removeItem(key);
  } catch { /* Unavailable storage cannot be read or used as a task cache. */ }
}

export function createConnection({storage, fetcher=globalThis.fetch, onClear=()=>{}} = {}) {
  purgeLegacy(storage);
  let generation=0;
  const signedOutKey='daymark-signed-out-v1';
  let signedOut=false;
  try { signedOut=storage?.getItem(signedOutKey)==='1'; } catch { /* Storage is optional. */ }
  const acceptSession = body => {
    if (!body || typeof body.username !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(body.username) || (body.expiresAt !== undefined && typeof body.expiresAt !== 'string')) {
      connection.clear(true);
      throw new Error('Connection required. The server returned an invalid session.');
    }
    return {username:body.username,expiresAt:body.expiresAt};
  };
  const connection = {
    session:null,
    connected:false,
    clear(forgetSession=false) {
      generation += 1;
      connection.connected=false;
      if (forgetSession) connection.session=null;
      purgeLegacy(storage); onClear();
    },
    async request(path, options={}) {
      if (!/^\/api\/[a-zA-Z0-9/?=&%_.-]+$/.test(path)) throw new Error('Only this server can be contacted.');
      if (!path.startsWith('/api/auth/') && (!connection.session || !connection.connected)) throw new Error('Sign in and reconnect before accessing tasks.');
      const started=generation;
      let response;
      try {
        response = await fetcher(path, {...options, credentials:'same-origin', redirect:'error', cache:'no-store', headers:{Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {})}, signal:AbortSignal.timeout(12_000)});
      } catch {
        if (started === generation) connection.clear();
        throw new Error('Connection required. Reconnect to verify any change before retrying.');
      }
      if (started !== generation) throw new Error('Connection changed. Retry using the current session.');
      if (!response.ok) {
        if (response.status >= 500) { connection.clear(); throw new Error('Connection required. The server is unavailable; reconnect to verify your tasks.'); }
        if (response.status === 401) {
          if (path === '/api/auth/login') throw new Error('Invalid username or password. Check your credentials.');
          connection.clear(true); throw new Error('Sign in again. Your session has expired or is unavailable.');
        }
        throw new Error(response.status === 429 ? 'Too many attempts. Wait before trying again.' : `Request failed (${response.status}). Please try again.`);
      }
      let body;
      try { body = response.status === 204 ? null : await response.json(); }
      catch {
        if (started === generation) connection.clear();
        throw new Error('Connection required. The server response could not be read.');
      }
      if (started !== generation) throw new Error('Connection changed. Retry using the current session.');
      return body;
    },
    async login(username, password) {
      const body = await connection.request('/api/auth/login', {method:'POST',body:JSON.stringify({username,password})});
      connection.clear(true);
      connection.session = acceptSession(body);
      connection.connected = true;
      signedOut=false;
      try { storage?.removeItem(signedOutKey); } catch { /* A retained marker fails closed on reload. */ }
      return connection.session;
    },
    async logout() {
      signedOut=true;
      try { storage?.setItem(signedOutKey,'1'); } catch { /* In-memory sign-out still applies. */ }
      connection.clear(true);
      try { await connection.request('/api/auth/logout', {method:'POST'}); return 'Signed out.'; }
      catch { return 'Signed out locally. Server session revocation could not be confirmed. Reconnect and sign out again to revoke it on this browser.'; }
      finally { connection.clear(true); }
    },
    async check() {
      if (signedOut) throw new Error('You signed out. Sign in to reconnect.');
      const body = await connection.request('/api/auth/session');
      connection.session = acceptSession(body);
      connection.connected = true;
      return connection.session;
    }
  };
  return connection;
}
