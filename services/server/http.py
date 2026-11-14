"""Authenticated, owner-scoped JSON API with explicit transport policy."""
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie, CookieError
from ipaddress import ip_address, ip_network
import json
import mimetypes
import ssl
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from .store import Store
from .validation import APIError
from .auth import LoginLimiter


def loopback(host):
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return host.lower() == 'localhost'


def origin_tuple(value):
    parsed = urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or
            parsed.password or parsed.path or parsed.query or parsed.fragment or
            any(char.isspace() for char in value) or '\\' in value):
        raise ValueError('Expected an origin without credentials, path, query or fragment')
    return parsed.scheme, parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == 'https' else 80)


class Handler(BaseHTTPRequestHandler):
    server_version = 'Daymark/0.2.0'
    sys_version = ''

    def setup(self):
        self.request.settimeout(self.server.request_timeout)
        super().setup()

    def handle(self):
        try:
            super().handle()
        except (ssl.SSLError, ConnectionError, TimeoutError):
            pass  # Unfinished handshakes/disconnected peers are not application errors.

    def log_message(self, format, *args):
        pass  # Do not log task data or export URLs.

    def __getattr__(self, name):
        # BaseHTTPRequestHandler otherwise emits an HTML 501 before our guards.
        if name.startswith('do_'):
            return self.dispatch
        raise AttributeError(name)

    def respond(self, status, data=None, headers=None):
        payload = b'' if status == 204 else json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(payload)

    def read_json(self):
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
            raise APIError('A valid Content-Length is required; chunked bodies are not supported')
        length = int(lengths[0])
        if not 0 < length <= 65536:
            raise APIError('JSON request body must be between 1 byte and 64 KiB')
        if self.headers.get_content_type() != 'application/json':
            raise APIError('Content-Type must be application/json')
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise APIError('Incomplete JSON request body')
            return json.loads(body.decode('utf-8'))
        except (ValueError, UnicodeDecodeError, TimeoutError, RecursionError):
            raise APIError('Invalid JSON request body') from None

    def static(self, path):
        path = unquote(path)
        parts = path.split('/')
        if '\\' in path or '\x00' in path or any(part.startswith('.') for part in parts if part):
            raise APIError('Not found', 404)
        root = self.server.web_root
        target = (root / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
        database = Path(self.server.store.path).resolve()
        private_files = {Path(str(database) + suffix) for suffix in ('', '-wal', '-shm', '-journal')}
        if target in private_files or not target.is_relative_to(root) or not target.is_file():
            raise APIError('Not found', 404)
        body = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def check_security(self):
        if self.headers.get('Transfer-Encoding'):
            raise APIError('Chunked request bodies are not supported')
        lengths = self.headers.get_all('Content-Length', [])
        if lengths and (len(lengths) != 1 or len(lengths[0]) > 6 or not lengths[0].isascii() or
                        not lengths[0].isdigit() or int(lengths[0]) > 65536):
            raise APIError('Invalid Content-Length or request body exceeds 64 KiB')
        hosts = self.headers.get_all('Host', [])
        if len(hosts) != 1:
            raise APIError('A single allowed Host is required')
        host = hosts[0]
        try:
            parsed = urlsplit('http://' + host)
            hostname = parsed.hostname
            scheme = 'https' if self.server.tls_enabled else 'http'
            port = parsed.port or (443 if scheme == 'https' else 80)
            if not hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
                raise ValueError()
            allowed = hostname.lower() in self.server.allowed_hosts
            try:
                address = ip_address(hostname)
                allowed = allowed or address in ip_network('100.64.0.0/10') or address in ip_network('fd7a:115c:a1e0::/48')
            except ValueError:
                pass
            if not allowed:
                raise ValueError()
        except ValueError:
            raise APIError('Host is not allowed') from None
        if urlsplit(self.path).path.startswith('/api'):
            if not (self.server.tls_enabled or self.server.allow_insecure_http or
                    (self.server.public_origin and loopback(self.client_address[0])) or
                    (self.server.loopback_bind and loopback(self.client_address[0]) and loopback(hostname))):
                raise APIError('HTTPS is required for authentication and API data', 403)
        if self.command in ('POST', 'PUT', 'DELETE', 'PATCH'):
            if self.headers.get('Sec-Fetch-Site') in ('cross-site', 'same-site'):
                raise APIError('Cross-origin browser writes are not allowed')
            for name in ('Origin', 'Referer'):
                values = self.headers.get_all(name, [])
                if len(values) > 1:
                    raise APIError('Invalid browser origin')
                if values:
                    try:
                        origin = urlsplit(values[0])
                        expected = self.server.public_origin or (scheme, hostname.lower(), port)
                        if ((origin.scheme, origin.hostname.lower() if origin.hostname else None,
                                origin.port or (443 if origin.scheme == 'https' else 80)) != expected or origin.username or origin.password or
                                (name == 'Origin' and (origin.path or origin.query or origin.fragment))):
                            raise ValueError()
                    except ValueError:
                        raise APIError('Cross-origin browser writes are not allowed') from None

    def session_token(self):
        values = self.headers.get_all('Authorization', [])
        if values:
            if len(values) != 1 or not values[0].startswith('Bearer ') or not values[0][7:]:
                raise APIError('Authentication required', 401)
            return values[0][7:]
        cookies = self.headers.get_all('Cookie', [])
        try:
            if len(cookies) != 1:
                raise ValueError()
            if sum(part.strip().split('=', 1)[0] == 'daymark_session' for part in cookies[0].split(';')) != 1:
                raise ValueError()
            cookie = SimpleCookie()
            cookie.load(cookies[0])
            return cookie['daymark_session'].value
        except (ValueError, KeyError, CookieError):
            raise APIError('Authentication required', 401) from None

    def session_cookie(self, token='', expire=False):
        cookie = 'daymark_session=' + token + '; Path=/; HttpOnly; SameSite=Strict'
        cookie += '; Max-Age=' + ('0' if expire else '2592000')
        if getattr(self.server, 'secure_cookies', False):
            cookie += '; Secure'
        return cookie

    def dispatch(self):
        try:
            self.check_security()
            parsed = urlsplit(self.path)
            path = parsed.path
            store = self.server.store
            if self.command == 'POST' and path == '/api/auth/login':
                peer = self.client_address[0]
                retry = self.server.login_limiter.begin(peer)
                if retry:
                    return self.respond(429, {'error': 'Too many login attempts'}, {'Retry-After': str(retry)})
                failed = True
                try:
                    data = self.read_json()
                    valid = isinstance(data, dict) and set(data) == {'username', 'password'}
                    login = store.login(data['username'] if valid else None, data['password'] if valid else None)
                    failed = False
                finally:
                    self.server.login_limiter.finish(peer, failed)
                return self.respond(200, login, {'Set-Cookie': self.session_cookie(login['token'])})
            if path.startswith('/api/') or path == '/api':
                token = self.session_token()
                session = store.session(token)
                if self.command in ('GET', 'HEAD') and path == '/api/auth/session':
                    return self.respond(200, {key: session[key] for key in ('username', 'expiresAt')})
                if self.command == 'POST' and path == '/api/auth/logout':
                    store.logout(token)
                    return self.respond(204, headers={'Set-Cookie': self.session_cookie(expire=True)})
                store = store.for_user(session['userId'])
            if self.command in ('GET', 'HEAD'):
                if path == '/health':
                    return self.respond(200, {'status': 'ok', 'version': '0.2.0'})
                if path == '/api/state':
                    query = parse_qs(parsed.query, keep_blank_values=True)
                    if len(query.get('date', [])) > 1:
                        raise APIError('Supply only one date')
                    on = query.get('date', [date.today().isoformat()])[0]
                    return self.respond(200, store.state(on))
                if path == '/api/export':
                    return self.respond(200, store.export(), {'Content-Disposition': 'attachment; filename="daymark-backup.json"'})
                if not path.startswith('/api/') and path != '/api':
                    return self.static(path)
            if self.command == 'POST' and path == '/api/tasks':
                return self.respond(201, store.create(self.read_json()))
            if self.command in ('PUT', 'DELETE') and path.startswith('/api/tasks/') and path.count('/') == 3:
                task_id = path.rsplit('/', 1)[1]
                if self.command == 'PUT':
                    return self.respond(200, store.update(task_id, self.read_json()))
                store.archive(task_id)
                return self.respond(204)
            if self.command == 'POST' and path in ('/api/occurrences/complete', '/api/occurrences/undo'):
                method = store.complete if path.endswith('/complete') else store.undo
                return self.respond(200, method(self.read_json()))
            if self.command not in ('GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'):
                raise APIError('Method not allowed', 405)
            raise APIError('Not found', 404)
        except APIError as error:
            self.respond(error.status, {'error': str(error)})
        except Exception:
            self.respond(500, {'error': 'Internal server error'})

    do_GET = dispatch
    do_POST = dispatch
    do_PUT = dispatch
    do_DELETE = dispatch
    do_PATCH = dispatch
    do_OPTIONS = dispatch


def make_server(host, port, db, allowed_hosts=(), *, public_origin=None, allow_insecure_http=False,
                tls_cert=None, tls_key=None):
    if bool(tls_cert) != bool(tls_key):
        raise ValueError('TLS requires both certificate and private key')
    context = None
    if tls_cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(tls_cert, tls_key)
    public = origin_tuple(public_origin) if public_origin else None
    if public and public[0] != 'https':
        raise ValueError('Public origin must be HTTPS')
    if not loopback(host) and not allow_insecure_http and not context:
        raise ValueError('HTTP must bind loopback; use TLS or explicit encrypted-tailnet development opt-in')
    server = ThreadingHTTPServer((host, port), Handler)
    server.request_timeout = 10
    server.loopback_bind = loopback(host)
    server.allow_insecure_http = allow_insecure_http
    server.public_origin = public
    server.tls_enabled = bool(context)
    server.secure_cookies = bool(public or context)
    server.allowed_hosts = {'localhost', '127.0.0.1', '::1', '10.0.2.2', 'hermesdan.tail1a7c8f.ts.net',
                            *(value.lower() for value in allowed_hosts)}
    if public:
        server.allowed_hosts.add(public[1])
    server.web_root = (Path(__file__).resolve().parents[2] / 'apps' / 'web').resolve()
    try:
        server.store = Store(db)
        if context:
            server.socket = context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
    except BaseException:
        server.server_close()
        raise
    server.login_limiter = LoginLimiter()
    return server
