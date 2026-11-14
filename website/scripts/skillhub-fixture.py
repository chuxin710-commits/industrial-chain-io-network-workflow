"""Temporary isolated API for browser tests; no production data or credentials."""
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from app import Handler
from library import LibraryStore

with tempfile.TemporaryDirectory() as folder:
    library = LibraryStore(folder)
    library.provision_shared_account('skilltest', 'synthetic-skill-password')
    with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        server.library = library
        server.database = Path(folder) / 'missing-test-mrio.sqlite3'
        server.topology = None
        print(server.server_port, flush=True)
        server.serve_forever()
