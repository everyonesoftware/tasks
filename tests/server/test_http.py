import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest


class HTTPTests(unittest.TestCase):
    def setUp(self):
        from services.server.http import make_server
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / 'http.sqlite3'
        self.server = make_server('127.0.0.1', 0, self.db)
        self.user_id = self.server.store.create_user('Fixture', 'fixture-password')
        self.token = self.server.store.login('Fixture', 'fixture-password')['token']
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, data=None, headers=None, raw=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        body = raw if raw is not None else json.dumps(data).encode() if data is not None else None
        headers = {'Content-Type': 'application/json', 'Authorization':'Bearer ' + self.token, **(headers or {})}
        headers = {key: value for key, value in headers.items() if value is not None}
        try:
            conn.request(method, path, body, headers)
            response = conn.getresponse()
            result = response.read()
            return response.status, dict(response.getheaders()), result
        finally:
            conn.close()

    def json_request(self, method, path, data=None, expected=200, headers=None):
        status, response_headers, body = self.request(method, path, data, headers)
        self.assertEqual(status, expected, body)
        self.assertIn('application/json', response_headers['Content-Type'])
        return json.loads(body)

    def test_http_validation_errors_and_body_limit(self):
        cases = [
            ('POST', '/api/tasks', b'{broken', {}, 400),
            ('POST', '/api/tasks', b'[]', {}, 400),
            ('POST', '/api/tasks', b'{"title":true,"startDate":"2026-11-14"}', {}, 400),
            ('GET', '/api/state?date=2026-02-30', None, {}, 400),
            ('GET', '/api/missing', None, {}, 404),
            ('PUT', '/api/tasks/missing', b'{"title":"x","startDate":"2026-11-14"}', {}, 404),
            ('POST', '/api/tasks', b'{"title":"large","startDate":"2026-11-14"}' + b' ' * 65537, {}, 400),
            ('POST', '/api/tasks', b'{}', {'Content-Length':'-1'}, 400),
            ('POST', '/api/tasks', b'{}', {'Content-Length':'no'}, 400),
            ('POST', '/api/tasks', b'{}', {'Transfer-Encoding':'chunked'}, 400),
            ('POST', '/api/tasks', b'{}', {'Content-Type':'text/plain'}, 400),
        ]
        for method, path, raw, headers, expected in cases:
            with self.subTest(method=method, path=path, headers=headers, size=len(raw or b'')):
                status, response_headers, body = self.request(method, path, headers=headers, raw=raw)
                self.assertEqual(status, expected, body)
                error = json.loads(body)['error']
                self.assertNotIn(str(self.db), error)
                self.assertNotIn('Traceback', error)
                self.assertNotIn('Access-Control-Allow-Origin', response_headers)

    def test_host_and_same_origin_mutation_guards(self):
        body = {'title':'safe', 'startDate':'2026-11-14'}
        host = '127.0.0.1:' + str(self.server.server_port)
        for headers in ({'Host':'evil.example'}, {'Host':'localhost.evil.example'},
                        {'Origin':'https://evil.example'}, {'Origin':'null'},
                        {'Origin':'http://localhost'}, {'Sec-Fetch-Site':'cross-site'},
                        {'Referer':'https://evil.example/form'}):
            with self.subTest(headers=headers):
                self.json_request('POST', '/api/tasks', body, 400, headers)
        self.assertEqual(self.json_request('GET', '/api/state?date=2026-11-14')['tasks'], [])
        self.json_request('POST', '/api/tasks', body, 201, {'Origin':'http://' + host, 'Sec-Fetch-Site':'same-origin'})
        for allowed in ('localhost', '127.0.0.1', '10.0.2.2', '100.101.102.103', 'hermesdan.tail1a7c8f.ts.net'):
            self.json_request('GET', '/health', headers={'Host':allowed + ':8787'})
        self.server.allowed_hosts.add('custom.example')
        self.json_request('GET', '/health', headers={'Host':'custom.example:8787'})

    def test_static_serves_web_only_and_rejects_traversal(self):
        web = Path(__file__).resolve().parents[2] / 'apps' / 'web'
        status, headers, body = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertEqual(body, (web / 'index.html').read_bytes())
        self.assertIn('text/html', headers['Content-Type'])
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        for path in ('/../contracts/api.md', '/%2e%2e/contracts/api.md', '/%2e%2e%2f.data/daymark.sqlite3',
                     '/.data/daymark.sqlite3', '/services/server/store.py', '/mockups/daymark-focus-v8.html',
                     '/.env', '/%00', '/..%5cservices%5cserver%5cstore.py', '/missing.txt'):
            with self.subTest(path=path):
                status, _, data = self.request('GET', path)
                self.assertEqual(status, 404, data)
        fixture = Path(self.temp.name) / 'web'
        fixture.mkdir()
        (fixture / 'escape.txt').symlink_to(self.db)
        self.server.web_root = fixture.resolve()
        self.assertEqual(self.request('GET', '/escape.txt')[0], 404)

    def test_protocol_errors_are_json_and_never_leak_internal_details(self):
        for method in ('PATCH', 'OPTIONS'):
            self.json_request(method, '/api/state', expected=404)
        self.json_request('GET', '/api/state?date=2026-11-14&date=2026-11-15', expected=400)
        for path in ('/health', '/api/state'):
            status, _, body = self.request('GET', path, raw=b'x' * 65537)
            self.assertEqual(status, 400, body)
        from unittest.mock import patch
        with patch('services.server.store.Store.state', side_effect=RuntimeError(str(self.db))):
            error = self.json_request('GET', '/api/state', expected=500)
            self.assertEqual(error, {'error':'Internal server error'})

    def test_live_crud_completion_undo_archive_and_restart(self):
        from services.server.store import Store
        self.assertEqual(self.json_request('GET', '/health'), {'status':'ok', 'version':'0.2.0'})
        self.assertEqual(self.json_request('GET', '/api/state?date=2026-11-14')['tasks'], [])
        task = self.json_request('POST', '/api/tasks', {'title':'HTTP task', 'startDate':'2026-11-14'}, 201)
        self.assertEqual(Store(self.db).for_user(self.user_id).state('2026-11-14')['tasks'], [task])
        task_path = '/api/tasks/' + task['id']
        edited = self.json_request('PUT', task_path, {'title':'Edited', 'startDate':'2026-11-14'})
        self.assertEqual(edited['id'], task['id'])
        data = {'taskId':task['id'], 'dueDate':'2026-11-14', 'date':'2026-11-14'}
        completed = self.json_request('POST', '/api/occurrences/complete', data)
        self.assertEqual(completed['progress'], {'completed':1, 'total':1})
        self.assertEqual(self.json_request('POST', '/api/occurrences/complete', data), completed)
        undone = self.json_request('POST', '/api/occurrences/undo', data)
        self.assertEqual(undone['progress'], {'completed':0, 'total':1})
        self.json_request('POST', '/api/occurrences/complete', data)
        status, _, body = self.request('DELETE', task_path)
        self.assertEqual((status, body), (204, b''))
        self.assertEqual(self.json_request('GET', '/api/state?date=2026-11-14')['tasks'], [])
        export = self.json_request('GET', '/api/export')
        self.assertEqual(export['tasks'][0]['archived'], 1)
        self.assertEqual(len(export['completions']), 1)
        self.assertEqual(Store(self.db).for_user(self.user_id).export(), export)
