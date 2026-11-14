"""Validate deployment configuration using the real Docker Compose parser."""
import json
import os
from pathlib import Path
import shutil
import select
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ComposeTests(unittest.TestCase):
    def test_secure_persistent_deployment(self):
        binary = os.environ.get('COMPOSE_BINARY')
        command = [binary] if binary else ['docker', 'compose']
        if not shutil.which(command[0]):
            self.skipTest('Docker Compose is required; alternatively set COMPOSE_BINARY')
        result = subprocess.run(
            command + ['-f', str(ROOT / 'docker-compose.yml'), 'config', '--format', 'json'],
            cwd=ROOT, env={**os.environ, 'DAYMARK_HOST': 'tasks.example.test',
                           'DAYMARK_PORT': '9443', 'DAYMARK_CERT_DIR': '/fixture/certs'},
            capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        service = config['services']['tasks']
        self.assertEqual(service['build']['dockerfile'], 'Dockerfile')
        self.assertTrue(service['read_only'])
        self.assertEqual(service['cap_drop'], ['ALL'])
        self.assertIn('no-new-privileges:true', service['security_opt'])
        self.assertEqual(service['restart'], 'unless-stopped')
        self.assertEqual(service['environment']['DAYMARK_HOST'], 'tasks.example.test')
        args = service['command']
        self.assertNotIn('--allow-insecure-http', args)
        self.assertEqual(args[args.index('--db') + 1], '/data/daymark.sqlite3')
        self.assertEqual(args[args.index('--public-origin') + 1], 'https://tasks.example.test:9443')
        self.assertEqual(args[args.index('--tls-cert') + 1], '/certs/fullchain.pem')
        self.assertEqual(args[args.index('--tls-key') + 1], '/certs/privkey.pem')
        self.assertEqual(service['ports'][0]['target'], 8787)
        self.assertEqual(str(service['ports'][0]['published']), '9443')
        mounts = {mount['target']: mount for mount in service['volumes']}
        self.assertEqual(set(mounts), {'/data', '/certs'})
        self.assertEqual(mounts['/data']['type'], 'volume')
        self.assertIn(mounts['/data']['source'], config['volumes'])
        self.assertEqual(mounts['/certs']['source'], '/fixture/certs')
        self.assertTrue(mounts['/certs']['read_only'])
        self.assertFalse(mounts['/certs'].get('bind', {}).get('create_host_path', False))
        self.assertEqual(service['healthcheck']['test'][0], 'CMD')
        dockerfile = (ROOT / 'Dockerfile').read_text()
        self.assertIn('USER 10001:10001', dockerfile)
        self.assertIn('COPY services/server/ ./services/server/', dockerfile)
        self.assertIn('COPY apps/web/ ./apps/web/', dockerfile)
        self.assertNotIn('COPY . ', dockerfile)
        ignore = (ROOT / '.dockerignore').read_text().splitlines()
        self.assertEqual(ignore[0], '**')
        self.assertNotIn('!.data/', ignore)
        self.assertNotIn('!certs/', ignore)

    def test_configured_https_healthcheck_uses_system_trust(self):
        binary = os.environ.get('COMPOSE_BINARY')
        command = [binary] if binary else ['docker', 'compose']
        if not shutil.which(command[0]) or not shutil.which('openssl'):
            self.skipTest('Docker Compose and openssl required')
        config = subprocess.run(
            command + ['-f', str(ROOT / 'docker-compose.yml'), 'config', '--format', 'json'],
            cwd=ROOT, env={**os.environ, 'DAYMARK_HOST': 'localhost'},
            capture_output=True, text=True, check=True, timeout=30)
        service = json.loads(config.stdout)['services']['tasks']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def openssl(*args):
                subprocess.run(['openssl', *args], cwd=root, check=True,
                               capture_output=True, timeout=20)
            openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-subj', '/CN=Deployment Fixture CA', '-keyout', 'ca.key', '-out', 'ca.pem',
                    '-addext', 'basicConstraints=critical,CA:TRUE',
                    '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
            openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost',
                    '-keyout', 'privkey.pem', '-out', 'server.csr')
            (root / 'extensions').write_text(
                'subjectAltName=DNS:localhost\nbasicConstraints=critical,CA:FALSE\n'
                'keyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n'
                'authorityKeyIdentifier=keyid,issuer\nsubjectKeyIdentifier=hash\n')
            openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key',
                    '-CAcreateserial', '-days', '1', '-out', 'fullchain.pem',
                    '-extfile', 'extensions')
            args = list(service['command'])
            for flag, value in (
                    ('--host', '127.0.0.1'), ('--port', '0'),
                    ('--db', str(root / 'daymark.sqlite3')),
                    ('--tls-cert', str(root / 'fullchain.pem')),
                    ('--tls-key', str(root / 'privkey.pem'))):
                args[args.index(flag) + 1] = value
            process = subprocess.Popen([sys.executable, '-m', 'services.server', *args],
                                       cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       text=True)
            try:
                assert process.stdout is not None
                self.assertTrue(select.select([process.stdout], [], [], 10)[0])
                line = process.stdout.readline().strip()
                self.assertIn('https://127.0.0.1:', line)
                port = int(line.rsplit(':', 1)[1])
                script = service['healthcheck']['test'][-1]
                script = script.replace('/certs/fullchain.pem', str(root / 'fullchain.pem'))
                script = script.replace("('127.0.0.1', 8787)", f"('127.0.0.1', {port})")
                env = {**os.environ, 'DAYMARK_HOST': 'localhost',
                       'SSL_CERT_FILE': str(root / 'ca.pem'), 'SSL_CERT_DIR': str(root / 'empty')}
                result = subprocess.run([sys.executable, '-c', script], env=env,
                                        capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                # The healthcheck must reject a hostname not covered by the certificate.
                result = subprocess.run([sys.executable, '-c', script],
                                        env={**env, 'DAYMARK_HOST': 'wrong.example.test'},
                                        capture_output=True, text=True, timeout=15)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('CERTIFICATE_VERIFY_FAILED', result.stderr)
            finally:
                process.terminate()
                process.communicate(timeout=10)
