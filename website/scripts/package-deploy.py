"""Package the built website and server code, never source tables or credentials."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tarfile


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=root / '.artifacts' / 'deployment')
    parser.add_argument('--incremental', action='store_true', help='Reuse the active database and media on the server')
    parser.add_argument('--include-media', action='append', default=[], help='Media-relative file to include in an incremental release')
    args = parser.parse_args()
    if not (root / 'dist/index.html').is_file() or not (root / 'server/app.py').is_file():
        raise SystemExit('Build the website and database API before packaging.')
    args.output.mkdir(parents=True, exist_ok=True)
    release = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    archive = args.output / f'chainlab-{release}.tar.gz'
    files = []
    for folder, target in [('dist', 'public'), ('server', 'server'), ('deploy', 'deploy')]:
        for path in sorted((root / folder).rglob('*')):
            if not path.is_file() or '__pycache__' in path.parts:
                continue
            if args.incremental and folder == 'dist' and path.relative_to(root / folder).parts[0] == 'media':
                if path.relative_to(root / folder / 'media').as_posix() not in args.include_media:
                    continue
            if folder == 'server' and path.suffix not in {'.py', '.md', '.txt'} and path.name != 'method_catalog.json':
                continue
            relative = Path(target) / path.relative_to(root / folder)
            files.append((path, relative.as_posix()))
    kernel = root.parent / 'src' / 'ionet'
    for path in sorted(kernel.rglob('*.py')):
        if '__pycache__' not in path.parts:
            files.append((path, 'server/vendor/ionet/' + path.relative_to(kernel).as_posix()))
    files.append((root.parent / 'LICENSE', 'server/vendor/IONET_LICENSE.txt'))
    with tarfile.open(archive, 'w:gz', compresslevel=4) as bundle:
        for path, relative in files:
            info = bundle.gettarinfo(str(path), arcname=relative)
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mode = 0o644
            with path.open('rb') as handle:
                bundle.addfile(info, handle)
    database = root / 'var/mrio.sqlite3'
    manifest = {
        'release': release, 'archive': archive.name, 'sha256': digest(archive),
        'kind': 'feature_increment' if args.incremental else 'full',
        'bytes': archive.stat().st_size,
        'files': [{'path': relative, 'bytes': path.stat().st_size, 'sha256': digest(path)} for path, relative in files],
        'database': {'file': 'mrio.sqlite3', 'bytes': database.stat().st_size, 'sha256': digest(database)} if database.exists() else None,
    }
    receipt = args.output / f'chainlab-{release}.manifest.json'
    receipt.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'archive': str(archive), 'manifest': str(receipt), 'bytes': manifest['bytes'], 'sha256': manifest['sha256']}, indent=2))


if __name__ == '__main__':
    main()
