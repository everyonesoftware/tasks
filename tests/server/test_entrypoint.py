import http.client
import json
from pathlib import Path
import re
import select
import subprocess
import sys
import tempfile
import unittest


class EntrypointTests(unittest.TestCase):
    def test_account_cli_stdin_reset_adoption_without_secret_output(self):
        from services.server.store import Store
        from services.server.validation import APIError
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / 'cli.sqlite3')
            def cli(action, username='Alice', password=' fixture-password '):
                command = [sys.executable, '-m', 'services.server', action, '--db', db, '--username', username]
                if action != 'adopt-legacy':
                    command.append('--password-stdin')
                result = subprocess.run(command, input=password+'\n', text=True, capture_output=True,
                                        cwd=Path(__file__).resolve().parents[2], timeout=10)
                self.assertNotIn(password, result.stdout + result.stderr)
                return result
            result = cli('create-user')
            self.assertEqual(result.returncode, 0, result.stderr)
            store = Store(db)
            login = store.login('alice', ' fixture-password ')
            self.assertNotIn(login['token'], result.stdout + result.stderr)
            self.assertNotEqual(cli('create-user', 'ALICE').returncode, 0)
            self.assertEqual(cli('reset-password', password='new-fixture-password').returncode, 0)
            with self.assertRaises(APIError):
                store.session(login['token'])
            store.login('Alice', 'new-fixture-password')
            self.assertEqual(cli('adopt-legacy').returncode, 0)
            self.assertNotEqual(cli('create-user', 'invalid name').returncode, 0)
            self.assertNotEqual(cli('create-user', 'short', 'short').returncode, 0)

    def test_tls_cli_real_verified_https_login_and_origin(self):
        import ssl
        from services.server.store import Store
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cert, key, db = root/'cert.pem', root/'key.pem', root/'tls.sqlite3'
            generated = subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                '-keyout', str(key), '-out', str(cert), '-days', '1', '-subj', '/CN=localhost',
                '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], capture_output=True, timeout=15)
            self.assertEqual(generated.returncode, 0)
            Store(db).create_user('TLSFixture', 'tls-fixture-password')
            command = [sys.executable, '-m', 'services.server', '--port', '0', '--db', str(db),
                       '--tls-cert', str(cert), '--tls-key', str(key)]
            process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[2],
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                ready, _, _ = select.select([process.stdout], [], [], 5)
                self.assertTrue(ready)
                line = process.stdout.readline()
                match = re.search(r'https://127\.0\.0\.1:(\d+)', line)
                self.assertIsNotNone(match, line)
                port = int(match.group(1))
                context = ssl.create_default_context(cafile=str(cert))
                conn = http.client.HTTPSConnection('127.0.0.1', port, context=context, timeout=5)
                try:
                    data = json.dumps({'username':'TLSFixture','password':'tls-fixture-password'})
                    conn.request('POST','/api/auth/login',data, {'Content-Type':'application/json', 'Origin':f'https://127.0.0.1:{port}'})
                    response = conn.getresponse()
                    self.assertEqual(response.status, 200, response.read())
                    self.assertIn('; Secure', response.getheader('Set-Cookie'))
                finally:
                    conn.close()
                # A TCP peer that never handshakes must not block the accept loop.
                import socket
                with socket.create_connection(('127.0.0.1', port), timeout=2):
                    healthy = http.client.HTTPSConnection('127.0.0.1', port, context=context, timeout=2)
                    try:
                        healthy.request('GET', '/health')
                        response = healthy.getresponse()
                        self.assertEqual(response.status, 200)
                        response.read()
                    finally:
                        healthy.close()
            finally:
                process.terminate()
                output, _ = process.communicate(timeout=5)
                self.assertNotIn('tls-fixture-password', output)

    def test_module_starts_on_ephemeral_port_with_isolated_database(self):
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / 'entry.sqlite3')
            command = [sys.executable, '-m', 'services.server', '--host', '0.0.0.0', '--port', '0', '--db', db,
                       '--allowed-host', 'example.test', '--allow-insecure-http']
            process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[2],
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                ready, _, _ = select.select([process.stdout], [], [], 5)
                self.assertTrue(ready, 'Server did not announce startup')
                line = process.stdout.readline()
                match = re.search(r'http://0\.0\.0\.0:(\d+)', line)
                self.assertIsNotNone(match, line)
                conn = http.client.HTTPConnection('127.0.0.1', int(match.group(1)), timeout=5)
                try:
                    conn.request('GET', '/health', headers={'Host':'example.test'})
                    response = conn.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read())['status'], 'ok')
                finally:
                    conn.close()
                self.assertTrue(Path(db).is_file())
            finally:
                process.terminate()
                process.communicate(timeout=5)
