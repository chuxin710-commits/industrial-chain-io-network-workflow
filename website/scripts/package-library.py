"""Package source documents only: never credentials, sessions, or team notes."""
import hashlib
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile

root = Path(__file__).resolve().parents[1]
source = root / 'var/library'
output = root / '.artifacts/deployment'
output.mkdir(parents=True, exist_ok=True)
archive = output / 'chainlab-library.tar.gz'
with tempfile.TemporaryDirectory() as temporary:
    database = Path(temporary) / 'import.sqlite3'
    with closing(sqlite3.connect(source / 'library.sqlite3')) as src, closing(sqlite3.connect(database)) as dest, dest:
        dest.execute('CREATE TABLE documents AS SELECT NULL AS id,NULL AS metadata WHERE 0')
        dest.executemany('INSERT INTO documents VALUES(?,?)',src.execute('SELECT id,metadata FROM documents'))
        columns = ['id','document_id','kind','page','color','body','quote','anchor','origin','created','updated']
        dest.execute('CREATE TABLE annotations('+','.join(c+' '+('REAL' if c in ('created','updated') else 'INTEGER' if c=='page' else 'TEXT') for c in columns)+')')
        dest.executemany('INSERT INTO annotations VALUES('+','.join('?' for _ in columns)+')',src.execute('SELECT '+','.join(columns)+" FROM annotations WHERE origin IN ('pdf','rdf')"))
    files=[(database,'import.sqlite3'),(source/'import-manifest.json','import-manifest.json')]
    for folder in ('pdfs','covers'):
        files.extend((p,p.relative_to(source).as_posix()) for p in sorted((source/folder).iterdir()) if p.is_file())
    entries=[]
    with tarfile.open(archive,'w:gz',compresslevel=2) as bundle:
        for path,name in files:
            entries.append({'path':name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size})
            bundle.add(path,arcname=name)
    result={'archive':archive.name,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'files':entries}
    (output/'chainlab-library.manifest.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':result['sha256'],'files':len(files)}))
