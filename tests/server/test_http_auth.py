import json
from pathlib import Path
import unittest

import test_http


class HTTPAuthTests(unittest.TestCase):
    setUp = test_http.HTTPTests.setUp
    stop = test_http.HTTPTests.stop
    request = test_http.HTTPTests.request
    json_request = test_http.HTTPTests.json_request

    def test_generic_login_failures_are_rate_limited_and_retry_expires(self):
        from unittest.mock import patch
        from services.server.auth import password_hash
        failures = []
        for data in [{'username':'missing','password':'wrong-password'}, {'username':'Fixture','password':'wrong-password'},
                     {}, {'username': [], 'password': []}, {'username':'Fixture','password':'wrong-password'}]:
            with patch('services.server.auth.password_hash', wraps=password_hash) as hashed:
                status, headers, body = self.request('POST','/api/auth/login',data)
                self.assertEqual(status, 401, body)
                failures.append(body)
                hashed.assert_called_once()
        self.assertEqual(len(set(failures)), 1)
        status, headers, body = self.request('POST','/api/auth/login',{'username':'changed','password':'wrong-password'},
                                             headers={'X-Forwarded-For':'203.0.113.99'})
        self.assertEqual(status, 429, body)
        self.assertGreater(int(headers['Retry-After']), 0)
        self.server.login_limiter.clock = lambda: 10**12
        self.json_request('POST','/api/auth/login',{'username':'Fixture','password':'fixture-password'})

    def test_transport_refuses_remote_http_and_ignores_forwarded_headers(self):
        from services.server.http import make_server
        with self.assertRaises(ValueError):
            make_server('0.0.0.0', 0, self.db)
        data = {'username':'Fixture', 'password':'fixture-password'}
        self.json_request('POST','/api/auth/login',data,403, {'Host':'hermesdan.tail1a7c8f.ts.net', 'X-Forwarded-Proto':'https'})
        self.server.allow_insecure_http = True
        self.json_request('POST','/api/auth/login',data, headers={'Host':'hermesdan.tail1a7c8f.ts.net'})

    def test_public_https_origin_supports_csrf_and_secure_cookie(self):
        from services.server.http import make_server
        for origin in ['http://example.com', 'https://user@example.com', 'https://example.com/path',
                       'https://example.com?x=1', 'https://example.com/#x']:
            with self.assertRaises(ValueError):
                make_server('127.0.0.1', 0, self.db, public_origin=origin)
        proxy = make_server('127.0.0.1', 0, self.db, public_origin='https://public.example:8443')
        self.addCleanup(proxy.server_close)
        self.server.public_origin = proxy.public_origin
        self.server.secure_cookies = proxy.secure_cookies
        self.server.allowed_hosts.add('public.example')
        data = {'username':'Fixture', 'password':'fixture-password'}
        status, headers, raw = self.request('POST','/api/auth/login',data,
                    headers={'Host':'public.example:8443', 'Origin':'https://public.example:8443'})
        self.assertEqual(status, 200, raw)
        self.assertIn('; Secure', headers['Set-Cookie'])
        self.json_request('POST','/api/auth/login', data, 400,
                    {'Host':'public.example:8443', 'Origin':'http://public.example:8443'})
        self.json_request('POST','/api/auth/login', data, 400,
                    {'Host':'public.example:8443', 'Origin':'https://evil.example', 'X-Forwarded-Host':'evil.example'})

    def test_configured_database_is_not_static_even_when_inside_web_root(self):
        self.server.web_root = self.db.parent.resolve()
        for suffix in ('', '-wal', '-shm'):
            target = Path(str(self.db) + suffix)
            if not target.exists():
                target.write_bytes(b'private fixture')
            status, _, _ = self.request('GET', '/' + target.name)
            self.assertEqual(status, 404, 'Configured database and SQLite sidecars must never be downloadable')

    def test_live_two_user_isolation_for_all_task_routes_and_export(self):
        self.server.store.create_user('Other', 'other-fixture-password')
        login = self.json_request('POST', '/api/auth/login', {'username':'other', 'password':'other-fixture-password'})
        other = {'Authorization':'Bearer '+login['token']}
        task_a = self.json_request('POST', '/api/tasks', {'title':'A private','startDate':'2026-11-14'},201)
        task_b = self.json_request('POST', '/api/tasks', {'title':'B private','startDate':'2026-11-14'},201,other)
        for task, owner, intruder in [(task_a, {}, other), (task_b, other, {})]:
            task_path = '/api/tasks/'+task['id']
            data = {'taskId':task['id'],'dueDate':'2026-11-14','date':'2026-11-14'}
            for method, path, body in [('PUT',task_path,{'title':'Stolen','startDate':'2026-11-14'}),
                ('DELETE',task_path,None), ('POST','/api/occurrences/complete',data), ('POST','/api/occurrences/undo',data)]:
                self.json_request(method,path,body,404,intruder)
            self.json_request('PUT',task_path,{'title':task['title']+' edited','startDate':'2026-11-14'},headers=owner)
            self.assertEqual(self.json_request('POST','/api/occurrences/complete',data,headers=owner)['progress'], {'completed':1,'total':1})
            self.assertEqual(self.json_request('POST','/api/occurrences/undo',data,headers=owner)['progress'], {'completed':0,'total':1})
            self.json_request('POST','/api/occurrences/complete',data,headers=owner)
            state = self.json_request('GET','/api/state?date=2026-11-14',headers=owner)
            self.assertEqual([row['id'] for row in state['tasks']], [task['id']])
            exported = self.json_request('GET','/api/export',headers=owner)
            self.assertEqual([row['id'] for row in exported['tasks']], [task['id']])
            self.assertEqual([row['taskId'] for row in exported['completions']], [task['id']])
            self.assertEqual(set(exported), {'schemaVersion','tasks','completions'})
            self.assertEqual(self.request('DELETE',task_path,headers=owner)[0],204)
            self.assertEqual(self.json_request('GET','/api/state',headers=owner)['tasks'],[])
            self.assertEqual(self.json_request('GET','/api/export',headers=owner)['tasks'][0]['archived'],1)
        with self.server.store.connection(write=True) as db:
            db.execute("UPDATE sessions SET expiresAt='2000-01-01T00:00:00Z'")
        self.json_request('GET','/api/auth/session',expected=401,headers=other)
        self.json_request('GET','/api/export',expected=401)
        self.json_request('POST','/api/tasks',{'title':'expired','startDate':'2026-11-14'},401)

    def test_partial_body_has_finite_read_deadline(self):
        import socket
        self.server.request_timeout = 0.1
        with socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2) as conn:
            conn.sendall((f'POST /api/tasks HTTP/1.0\r\nHost: 127.0.0.1:{self.server.server_port}\r\n'
                          f'Authorization: Bearer {self.token}\r\nContent-Type: application/json\r\n'
                          'Content-Length: 100\r\n\r\n{').encode())
            response = b''
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                response += chunk
            self.assertIn(b' 400 ', response.split(b'\r\n')[0])
            self.assertIn(b'Invalid JSON request body', response)
        self.json_request('GET','/health')

    def test_head_semantics_and_unsupported_methods_are_controlled(self):
        status, headers, body = self.request('HEAD', '/api/state', headers={'Authorization':None})
        self.assertEqual(status, 401)
        self.assertIn('application/json', headers['Content-Type'])
        self.assertEqual(body, b'')
        status, headers, body = self.request('HEAD', '/api/state')
        self.assertEqual(status, 200)
        self.assertGreater(int(headers['Content-Length']), 0)
        self.assertEqual(body, b'')
        for method in ('TRACE','CONNECT','UNSUPPORTED'):
            self.json_request(method, '/api/state', expected=405)
            self.json_request(method, '/api/state', expected=401, headers={'Authorization':None})
        self.assertEqual(self.request('HEAD','/')[::2], (200,b''))

    def test_invalid_unicode_api_input_is_rejected_before_sqlite(self):
        for field in ('title','notes','category','startDate','repeat'):
            data = {'title':'Valid','startDate':'2026-11-14',field:'\ud800'}
            self.json_request('POST','/api/tasks',data,400)
        for path in ('complete','undo'):
            self.json_request('POST','/api/occurrences/'+path,
                    {'taskId':'\ud800','dueDate':'2026-11-14','date':'2026-11-14'},400)
        for field in ('username','password'):
            data = {'username':'Fixture','password':'fixture-password',field:'\ud800'*8}
            self.json_request('POST','/api/auth/login',data,401)

    def test_login_cookie_bearer_logout_and_all_anonymous_api_denied(self):
        for method, path in [('GET','/api/state'), ('GET','/api/export'), ('GET','/api/auth/session'),
                             ('POST','/api/tasks'), ('PUT','/api/tasks/id'), ('DELETE','/api/tasks/id'),
                             ('POST','/api/occurrences/complete'), ('POST','/api/occurrences/undo'),
                             ('POST','/api/auth/logout')]:
            self.json_request(method, path, expected=401, headers={'Authorization': None})
        status, headers, raw = self.request('POST', '/api/auth/login', {'username':'Fixture', 'password':'fixture-password'}, headers={'Authorization': None})
        self.assertEqual(status, 200, raw)
        login = json.loads(raw)
        self.assertEqual(set(login), {'token', 'username', 'expiresAt'})
        cookie = headers['Set-Cookie']
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)
        self.assertNotIn('Secure', cookie)
        for auth in ({'Authorization':'Bearer ' + login['token']}, {'Authorization':None, 'Cookie':cookie.split(';')[0]}):
            session = self.json_request('GET','/api/auth/session', headers=auth)
            self.assertEqual(session, {key: login[key] for key in ('username','expiresAt')})
        status, headers, body = self.request('POST', '/api/auth/logout', headers={'Authorization':'Bearer ' + login['token']})
        self.assertEqual((status, body), (204, b''))
        self.assertIn('Max-Age=0', headers['Set-Cookie'])
        self.json_request('GET','/api/auth/session', expected=401, headers={'Authorization':'Bearer ' + login['token']})
