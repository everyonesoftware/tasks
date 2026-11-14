import hashlib
from pathlib import Path
import tempfile
import unittest

from services.server.store import Store


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'auth.sqlite3')

    def test_owner_scopes_every_operation(self):
        from services.server.validation import APIError
        alice = self.store.create_user('Alice', 'fixture-password')
        bob = self.store.create_user('Bob', 'fixture-password')
        with self.assertRaises(APIError) as denied:
            self.store.state('2026-11-14')
        self.assertEqual(denied.exception.status, 401)
        a, b = self.store.for_user(alice), self.store.for_user(bob)
        task = a.create({'title': 'Private', 'startDate': '2026-11-14'})
        self.assertNotIn('ownerId', task)
        data = {'taskId': task['id'], 'dueDate': '2026-11-14', 'date': '2026-11-14'}
        a.complete(data)
        self.assertEqual(b.state('2026-11-14')['tasks'], [])
        self.assertEqual(b.export(), {'schemaVersion': 1, 'tasks': [], 'completions': []})
        for action in [lambda: b.update(task['id'], {'title':'Stolen', 'startDate':'2026-11-14'}),
                       lambda: b.archive(task['id']), lambda: b.complete(data), lambda: b.undo(data)]:
            with self.assertRaises(APIError) as caught:
                action()
            self.assertEqual(caught.exception.status, 404)
        self.assertEqual(a.state('2026-11-14')['progress']['completed'], 1)
        self.assertEqual(len(a.export()['completions']), 1)
        self.assertNotIn('ownerId', a.export()['tasks'][0])
        self.assertEqual(set(a.export()), {'schemaVersion', 'tasks', 'completions'})

    def test_legacy_migration_never_silently_assigns_and_explicit_adoption(self):
        import sqlite3
        from services.server.store import SCHEMA
        from services.server.validation import APIError
        path = Path(self.temp.name) / 'legacy.sqlite3'
        from contextlib import closing
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript(SCHEMA)
            db.execute("INSERT INTO tasks VALUES ('legacy', 'Old', '', 'Personal', 'once', 1, '2026-11-14', 0, '2026-11-14T00:00:00Z', 1)")
            db.execute("INSERT INTO completions VALUES ('legacy', '2026-11-14', '2026-11-14', '2026-11-14T01:00:00Z')")
        migrated = Store(path)
        uid = migrated.create_user('Alice', 'fixture-password')
        self.assertEqual(migrated.for_user(uid).export()['tasks'], [])
        self.assertTrue(hasattr(migrated, 'adopt_legacy'), 'Explicit adoption required')
        with self.assertRaises(APIError):
            migrated.adopt_legacy('missing')
        self.assertEqual(migrated.adopt_legacy('ALICE'), 1)
        result = Store(path).for_user(uid).export()
        self.assertEqual(result['tasks'][0]['id'], 'legacy')
        self.assertEqual(result['tasks'][0]['archived'], 1)
        self.assertEqual(len(result['completions']), 1)
        self.assertEqual(migrated.adopt_legacy('Alice'), 0)

    def test_password_reset_during_login_cannot_mint_an_old_password_session(self):
        from unittest.mock import patch
        from services.server.auth import password_hash
        from services.server.validation import APIError
        self.store.create_user('Alice', 'old-fixture-password')
        def reset_after_hash(password, salt, iterations=600000):
            result = password_hash(password, salt, iterations)
            if password == 'old-fixture-password':
                self.store.reset_password('Alice', 'new-fixture-password')
            return result
        with patch('services.server.auth.password_hash', side_effect=reset_after_hash):
            with self.assertRaises(APIError) as caught:
                self.store.login('Alice', 'old-fixture-password')
        self.assertEqual(caught.exception.status, 401)
        with self.store.connection() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0], 0)

    def test_password_and_username_validation_including_invalid_unicode(self):
        from services.server.validation import APIError
        for name, password in [('bad name','long-password'), ('é','long-password'), ('a'*65,'long-password'),
                               ('Good',None), ('Good','short'), ('Good','x'*1025), ('Good','\ud800'*8)]:
            with self.subTest(name=name), self.assertRaises(APIError):
                self.store.create_user(name, password)
        self.store.create_user('Valid._-123', ' '*8)
        self.store.login('valid._-123', ' '*8)
        for password in ['\ud800'*8, None, [], 'x'*1025]:
            with self.assertRaises(APIError) as caught:
                self.store.login('Valid._-123', password)
            self.assertEqual((caught.exception.status, str(caught.exception)), (401, 'Invalid username or password'))

    def test_provision_hash_login_session(self):
        self.assertTrue(hasattr(self.store, 'create_user'), 'Provisioning must exist')
        uid = self.store.create_user('Alice', ' fixture password ')
        other = self.store.create_user('Bob', ' fixture password ')
        with self.store.connection() as db:
            a, b = db.execute('SELECT * FROM users ORDER BY username').fetchall()
            self.assertGreaterEqual(a['iterations'], 600000)
            self.assertNotEqual(a['salt'], b['salt'])
            self.assertNotEqual(a['passwordHash'], ' fixture password ')
        login = self.store.login('ALICE', ' fixture password ')
        self.assertEqual(login['username'], 'Alice')
        self.assertGreaterEqual(len(login['token']), 43)
        session = self.store.session(login['token'])
        self.assertEqual(session['userId'], uid)
        with self.store.connection() as db:
            row = db.execute('SELECT * FROM sessions').fetchone()
            self.assertEqual(row['tokenHash'], hashlib.sha256(login['token'].encode()).hexdigest())
            self.assertNotIn(login['token'], str(tuple(row)))
        self.assertNotEqual(uid, other)

    def test_session_revocation_expiry_reset_and_generic_failure(self):
        from services.server.validation import APIError
        from unittest.mock import patch
        from services.server.auth import password_hash
        self.store.create_user('Alice', 'fixture-password')
        for username, password in [('Alice', 'bad'), ('missing', 'bad'), ('?', []), ('Alice', 'fixture-password ')]:
            with patch('services.server.auth.password_hash', wraps=password_hash) as hashed:
                with self.assertRaises(APIError) as caught:
                    self.store.login(username, password)
                self.assertEqual((caught.exception.status, str(caught.exception)), (401, 'Invalid username or password'))
                hashed.assert_called_once()
                self.assertEqual(hashed.call_args.args[-1], 600000)
        login = self.store.login('alice', 'fixture-password')
        self.assertTrue(hasattr(self.store, 'logout'), 'Logout revocation required')
        self.store.logout(login['token'])
        with self.assertRaises(APIError):
            self.store.session(login['token'])
        login = self.store.login('Alice', 'fixture-password')
        with self.store.connection(write=True) as db:
            db.execute("UPDATE sessions SET expiresAt='2000-01-01T00:00:00Z'")
        with self.assertRaises(APIError):
            self.store.session(login['token'])
        active = self.store.login('Alice', 'fixture-password')
        self.store.reset_password('aLiCe', 'replacement-password')
        with self.assertRaises(APIError):
            self.store.session(active['token'])
        self.store.login('Alice', 'replacement-password')
