"""Build a small, traceable UI-only increment without retransferring MRIO or films."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tarfile


def main():
    root = Path(__file__).resolve().parents[1]
    output = root / '.artifacts/deployment'
    output.mkdir(parents=True, exist_ok=True)
    release = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    archive = output / f'chainlab-ui-{release}.tar.gz'
    files = [(p, 'public/' + p.relative_to(root / 'dist').as_posix())
             for p in sorted((root / 'dist').rglob('*'))
             if p.is_file() and p.relative_to(root / 'dist').parts[0] != 'media']
    installer = root / 'deploy/update-ui.py'
    files.append((installer, 'deploy/update-ui.py'))
    with tarfile.open(archive, 'w:gz', compresslevel=6) as bundle:
        for path, name in files:
            bundle.add(path, arcname=name, recursive=False)
    manifest = {'release': release, 'archive': archive.name,
                'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                'files': [{'path': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                           'bytes': path.stat().st_size} for path, name in files]}
    receipt = output / f'chainlab-ui-{release}.manifest.json'
    receipt.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'archive': str(archive), 'manifest': str(receipt),
                      'bytes': archive.stat().st_size, 'release': release}, indent=2))


if __name__ == '__main__':
    main()
