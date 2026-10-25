"""Merge a verified source library without overwriting accounts or shared notes."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from library import LibraryStore

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--archive',required=True,type=Path);p.add_argument('--manifest',required=True,type=Path)
p.add_argument('--root',type=Path,default=Path('/var/lib/chainlab/library'))
a=p.parse_args();manifest=json.loads(a.manifest.read_text())
def digest(path):
    result=hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda:handle.read(1048576),b''):result.update(chunk)
    return result.hexdigest()
assert digest(a.archive)==manifest['sha256'],'Library archive checksum mismatch'
a.root.mkdir(parents=True,exist_ok=True)
if (a.root/'library.sqlite3').exists():
    backup=Path('/var/backups/chainlab');backup.mkdir(parents=True,exist_ok=True)
    name=backup/('library-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.sqlite3')
    with closing(sqlite3.connect(a.root/'library.sqlite3')) as src,closing(sqlite3.connect(name)) as dst:src.backup(dst)
    name.chmod(0o600)
store=LibraryStore(a.root)
expected={r['path']:r for r in manifest['files']}
with tempfile.TemporaryDirectory(dir=a.root) as directory:
    stage=Path(directory)
    with tarfile.open(a.archive) as bundle:
        seen=set()
        for entry in bundle:
            path=PurePosixPath(entry.name)
            if not entry.isfile() or path.is_absolute() or '..' in path.parts or entry.name not in expected or entry.name in seen:
                raise ValueError('Unexpected library archive entry')
            seen.add(entry.name);target=stage.joinpath(*path.parts);target.parent.mkdir(parents=True,exist_ok=True)
            with bundle.extractfile(entry) as src,target.open('wb') as dst:shutil.copyfileobj(src,dst)
            assert target.stat().st_size==expected[entry.name]['bytes'] and digest(target)==expected[entry.name]['sha256']
        assert seen==set(expected)
    for folder in ('pdfs','covers'):
        (a.root/folder).mkdir(exist_ok=True)
        for source in (stage/folder).iterdir():
            target=a.root/folder/source.name
            if target.exists():assert digest(target)==digest(source),'Immutable document mismatch'
            else:os.replace(source,target)
    with closing(sqlite3.connect(stage/'import.sqlite3')) as src,closing(store.connect()) as dst,dst:
        dst.execute('BEGIN IMMEDIATE')
        dst.executemany('INSERT INTO documents VALUES(?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata',src.execute('SELECT id,metadata FROM documents'))
        for row in src.execute('SELECT * FROM annotations'):
            if row[8] not in ('pdf','rdf'):raise ValueError('Source package contains non-source records')
            changed=dst.execute('INSERT OR IGNORE INTO annotations(id,document_id,kind,page,color,body,quote,anchor,origin,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)',row).rowcount
            if changed:dst.execute('INSERT INTO events(document_id,annotation_id,operation,snapshot,created) VALUES(?,?,?,?,?)',(row[1],row[0],'import','{}',time.time()))
    os.replace(stage/'import-manifest.json',a.root/'import-manifest.json')
for path in a.root.rglob('*'):
    if path.is_file():path.chmod(0o640)
    elif path.is_dir():path.chmod(0o750)
print(json.dumps({k:v for k,v in store.catalog().items() if k!='documents'}))
