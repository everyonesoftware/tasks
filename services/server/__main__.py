"""Run with python3 -m services.server; Python standard library only."""
import argparse
import getpass
import signal
import sys
import warnings

from .http import make_server
from .store import Store
from .validation import APIError


def main():
    parser = argparse.ArgumentParser(description='Daymark authenticated private server.',
                                     formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('action', nargs='?', choices=['serve', 'create-user', 'reset-password', 'adopt-legacy'], default='serve')
    parser.add_argument('--host', default='127.0.0.1', help='Bind address')
    parser.add_argument('--port', type=int, default=8787, help='TCP port; 0 selects an ephemeral port')
    parser.add_argument('--db', default='.data/daymark.sqlite3', help='SQLite database file; starts empty')
    parser.add_argument('--allowed-host', action='append', default=[], metavar='HOSTNAME',
                        help='Additional trusted Host name, without scheme or port; repeatable')
    parser.add_argument('--username', help='Account name for administrator actions')
    parser.add_argument('--password-stdin', action='store_true', help='Read a single password line from stdin; never use a command-line password')
    parser.add_argument('--public-origin', help='Explicit HTTPS origin of a trusted TLS proxy on this machine')
    parser.add_argument('--tls-cert', help='TLS certificate chain PEM path')
    parser.add_argument('--tls-key', help='TLS private key PEM path')
    parser.add_argument('--allow-insecure-http', action='store_true', help='DEVELOPMENT ONLY: opt into HTTP on a private encrypted tailnet, never public Internet')
    args = parser.parse_args()
    if args.action != 'serve':
        if not args.username:
            parser.error('--username is required for account administration')
        try:
            store = Store(args.db)
            if args.action == 'adopt-legacy':
                if args.password_stdin:
                    parser.error('adopt-legacy does not take a password')
                count = store.adopt_legacy(args.username)
                print(f'Adopted {count} unassigned legacy tasks.')
            else:
                if args.password_stdin:
                    password = sys.stdin.read(1026)
                    if password.endswith('\n'):
                        password = password[:-1]
                    if '\n' in password:
                        raise APIError('Provide exactly one password line')
                else:
                    with warnings.catch_warnings():
                        warnings.simplefilter('error', getpass.GetPassWarning)
                        password = getpass.getpass('Password: ')
                        if password != getpass.getpass('Confirm password: '):
                            raise APIError('Passwords do not match')
                method = store.create_user if args.action == 'create-user' else store.reset_password
                method(args.username, password)
                print('User created.' if args.action == 'create-user' else 'Password reset; all account sessions revoked.')
        except APIError as error:
            parser.exit(1, str(error) + '\n')
        except (OSError, EOFError, getpass.GetPassWarning):
            parser.exit(1, 'Account operation failed; check database permissions or use --password-stdin.\n')
        return
    if args.password_stdin or args.username:
        parser.error('Account flags require an administrator action')
    try:
        server = make_server(args.host, args.port, args.db, args.allowed_host,
                             public_origin=args.public_origin, allow_insecure_http=args.allow_insecure_http,
                             tls_cert=args.tls_cert, tls_key=args.tls_key)
    except (OSError, ValueError):
        parser.exit(1, 'Unable to start Daymark; check transport settings, bind address, port and database permissions.\n')
    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    scheme = 'https' if server.tls_enabled else 'http'
    print(f'Daymark listening on {scheme}://{args.host}:{server.server_port}', flush=True)
    if args.allow_insecure_http:
        print('WARNING: insecure HTTP development enabled; private encrypted tailnet only, never public Internet.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
