"""Package only upstream runtime resources, built frontend, and integration adapters."""
import hashlib
import json
from pathlib import Path
import tarfile
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[2]
source = root / '.artifacts/toolbench-build'
assert (source / 'frontend/dist/index.html').is_file(), 'Build the Newman frontend first'
release = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
archive = root / '.artifacts' / f'toolbench-{release}.tar.gz'
included = ['backend', 'frontend/dist', 'skills', 'plugins', 'version.json', 'LICENSE', 'chainlab_app.py', 'newman.yaml', 'CHAINLAB_UPSTREAM.json', 'requirements.lock']
with tarfile.open(archive, 'w:gz') as bundle:
    for item in included:
        target = source / item
        paths = sorted(target.rglob('*')) if target.is_dir() else [target]
        for file in paths:
            if not file.is_file() or set(file.parts) & {'__pycache__', '.pytest_cache', 'node_modules', '.git'}:
                continue
            bundle.add(file, arcname=file.relative_to(source).as_posix(), recursive=False)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
print(json.dumps({'release': release, 'archive': str(archive), 'sha256': digest, 'bytes': archive.stat().st_size}))
