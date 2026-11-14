"""Local administrator provisioning and hashed, revocable sessions."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import re
import secrets
import sqlite3
import math
import threading
import time
from uuid import uuid4

from .validation import APIError

ITERATIONS = 600_000
AUTH_SCHEMA = '''
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 salt BLOB NOT NULL, passwordHash BLOB NOT NULL, iterations INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id),
 expiresAt TEXT NOT NULL
);
'''
DUMMY_SALT = secrets.token_bytes(32)


class LoginLimiter:
    """Per socket peer, never untrusted forwarded headers; bounded memory."""
    def __init__(self):
        self.clock = time.monotonic
        self.lock = threading.Lock()
        self.peers = {}

    def begin(self, peer):
        with self.lock:
            now = self.clock()
            self.peers = {key: value for key, value in self.peers.items() if value[0] > now or value[2]}
            if peer not in self.peers and len(self.peers) >= 4096:
                return 60
            entry = self.peers.setdefault(peer, [now + 60, 0, 0])
            if entry[1] + entry[2] >= 5:
                return max(1, math.ceil(entry[0] - now))
            entry[2] += 1
            return 0

    def finish(self, peer, failed):
        with self.lock:
            entry = self.peers[peer]
            entry[2] -= 1
            entry[1] += int(failed)


def password_hash(password, salt, iterations=ITERATIONS):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)


def valid_password(password):
    if not isinstance(password, str) or not 8 <= len(password) <= 1024:
        return False
    try:
        password.encode('utf-8')
        return True
    except UnicodeEncodeError:
        return False


def validate_account(username, password):
    if not isinstance(username, str) or re.fullmatch(r'[A-Za-z0-9._-]{1,64}', username) is None:
        raise APIError('Username must be 1..64 ASCII letters, digits, dot, underscore or hyphen')
    if not valid_password(password):
        raise APIError('Password must be 8..1024 characters')


def token_hash(token):
    if not isinstance(token, str) or not 1 <= len(token) <= 256 or not token.isascii():
        raise APIError('Authentication required', 401)
    return hashlib.sha256(token.encode()).hexdigest()


class AuthMixin:
    def create_user(self, username, password):
        validate_account(username, password)
        uid, salt = str(uuid4()), secrets.token_bytes(32)
        digest = password_hash(password, salt)
        try:
            with self.connection(write=True) as db:
                db.execute('INSERT INTO users VALUES (?, ?, ?, ?, ?)', (uid, username, salt, digest, ITERATIONS))
        except sqlite3.IntegrityError:
            raise APIError('Username already exists') from None
        return uid

    def login(self, username, password):
        valid = isinstance(username, str) and re.fullmatch(r'[A-Za-z0-9._-]{1,64}', username)
        valid = valid and valid_password(password)
        with self.connection() as db:
            user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone() if valid else None
        digest = password_hash(password if valid else '', user['salt'] if user else DUMMY_SALT,
                               user['iterations'] if user else ITERATIONS)
        if not hmac.compare_digest(digest, user['passwordHash'] if user else bytes(32)) or user is None:
            raise APIError('Invalid username or password', 401)
        token = secrets.token_urlsafe(32)
        expiry = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat().replace('+00:00', 'Z')
        with self.connection(write=True) as db:
            # Compare the verified credential version under the same write lock as issuance.
            # A concurrent password reset must not mint a new old-password session.
            inserted = db.execute('INSERT INTO sessions SELECT ?, id, ? FROM users WHERE id=? AND passwordHash=? AND salt=?',
                                  (token_hash(token), expiry, user['id'], user['passwordHash'], user['salt']))
            if not inserted.rowcount:
                raise APIError('Invalid username or password', 401)
        return {'token': token, 'username': user['username'], 'expiresAt': expiry}

    def logout(self, token):
        with self.connection(write=True) as db:
            db.execute('DELETE FROM sessions WHERE tokenHash=?', (token_hash(token),))

    def reset_password(self, username, password):
        validate_account(username, password)
        salt = secrets.token_bytes(32)
        digest = password_hash(password, salt)
        with self.connection(write=True) as db:
            user = db.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone()
            if user is None:
                raise APIError('User not found', 404)
            db.execute('UPDATE users SET salt=?, passwordHash=?, iterations=? WHERE id=?',
                       (salt, digest, ITERATIONS, user['id']))
            db.execute('DELETE FROM sessions WHERE userId=?', (user['id'],))

    def session(self, token):
        with self.connection() as db:
            row = db.execute('SELECT userId, username, expiresAt FROM sessions JOIN users ON users.id=sessions.userId WHERE tokenHash=?', (token_hash(token),)).fetchone()
        if row is None or row['expiresAt'] <= datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'):
            raise APIError('Authentication required', 401)
        return dict(row)
