"""Start a disposable, loopback-only API for api-smoke.py.

Public test credentials and sample tasks must NEVER enter a user database.
This module always creates its own fresh database under the scratch directory.
"""
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from services.server.http import make_server

root=Path(tempfile.mkdtemp(prefix='daymark-acceptance-',dir='/opt/data/cache/scratch'))
server=make_server('127.0.0.1',8793,root/'fixture.sqlite3')
for username in ['acceptance','second']:
    server.store.create_user(username,'acceptance-only-password')
context=Path('/opt/data/cache/scratch/daymark-acceptance-context.json')
context.write_text(json.dumps({'root':str(root),'origin':'http://127.0.0.1:8793','port':8793}))
os.chmod(context,0o600)
print('Isolated loopback fixture ready on 8793; database: '+str(root),flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
